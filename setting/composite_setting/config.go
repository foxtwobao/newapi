package composite_setting

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"sync/atomic"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/shopspring/decimal"
)

const OptionKey = "composite_setting.groups"
const MaxMembers = 32
const MaxRatio = 1000.0

type Definition struct {
	Enabled         bool     `json:"enabled"`
	Members         []string `json:"members"`
	CrossGroupRetry bool     `json:"cross_group_retry"`
}

type Config struct {
	Groups  map[string]Definition `json:"groups"`
	Ratios  map[string]float64    `json:"group_ratios"`
	Version string                `json:"version"`
}

type Snapshot struct {
	Name    string
	Version string
	Definition
	Ratio  float64
	Ratios map[string]float64
}

type identityIndex struct {
	groups  map[string]Definition
	invalid bool
}

var identities atomic.Pointer[identityIndex]

// The index is only for option/token editors. Relay authorization and prices
// read the database together on every request, never this eventual cache.
func UpdateIdentityIndex(raw string) error {
	var groups map[string]Definition
	err := common.UnmarshalJsonStr(raw, &groups)
	if err == nil && groups == nil {
		err = errors.New("composite groups must be an object")
	}
	identities.Store(&identityIndex{groups: groups, invalid: err != nil})
	return err
}

func IsComposite(name string) bool {
	index := identities.Load()
	if index == nil {
		return false
	}
	_, found := index.groups[name]
	return found || index.invalid
}

func ValidRatio(ratio float64) bool {
	return !math.IsNaN(ratio) && !math.IsInf(ratio, 0) && ratio >= 0 && ratio <= MaxRatio
}

func Normalize(name string, def Definition) (Definition, error) {
	if name == "" || name == "auto" || len(name) > 64 || strings.TrimSpace(name) != name || strings.ContainsAny(name, ",/\\") || strings.ContainsFunc(name, unicode.IsControl) {
		return def, errors.New("invalid composite name")
	}
	members := make([]string, 0, len(def.Members))
	for _, member := range def.Members {
		if !slices.Contains(members, member) {
			members = append(members, member)
		}
	}
	if len(members) == 0 || len(members) > MaxMembers {
		return def, fmt.Errorf("composite requires 1 to %d members", MaxMembers)
	}
	def.Members = members
	return def, nil
}

func (cfg *Config) Snapshot(name string) (*Snapshot, error) {
	def, found := cfg.Groups[name]
	if !found {
		return nil, nil
	}
	if !def.Enabled {
		return nil, errors.New("composite is disabled")
	}
	if err := cfg.Validate(name); err != nil {
		return nil, err
	}
	ratios := make(map[string]float64, len(def.Members))
	for _, member := range def.Members {
		ratios[member] = cfg.Ratios[member]
	}
	def.Members = slices.Clone(def.Members)
	return &Snapshot{Name: name, Version: cfg.Version, Definition: def, Ratio: cfg.Ratios[name], Ratios: ratios}, nil
}

func (cfg *Config) Validate(name string) error {
	def := cfg.Groups[name]
	normalized, err := Normalize(name, def)
	if err != nil {
		return err
	}
	if !slices.Equal(normalized.Members, def.Members) {
		return errors.New("duplicate composite members")
	}
	if ratio, ok := cfg.Ratios[name]; !ok || !ValidRatio(ratio) {
		return errors.New("composite base ratio is missing or invalid")
	}
	for _, member := range def.Members {
		_, nested := cfg.Groups[member]
		if member == "" || member == "auto" || member == name || nested {
			return errors.New("composite members must be ordinary groups")
		}
		if ratio, ok := cfg.Ratios[member]; !ok || !ValidRatio(ratio) {
			return fmt.Errorf("member %s base ratio is missing or invalid", member)
		}
	}
	return nil
}

func (s *Snapshot) Billing(member string) (*types.CompositeBilling, error) {
	ratio, ok := s.Ratios[member]
	if !ok || !slices.Contains(s.Members, member) {
		return nil, errors.New("selected group is outside composite members")
	}
	finalRatio, _ := decimal.NewFromFloat(s.Ratio).Mul(decimal.NewFromFloat(ratio)).Float64()
	return &types.CompositeBilling{Name: s.Name, Version: s.Version, Member: member, CompositeRatio: s.Ratio, MemberRatio: ratio, FinalRatio: finalRatio}, nil
}
