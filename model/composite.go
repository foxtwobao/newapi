package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"maps"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/composite_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrCompositeConflict = errors.New("composite configuration changed; reload before saving")
var compositeMutationMu sync.Mutex

func validateCompositeOption(key, value string) error {
	if key == composite_setting.OptionKey {
		return errors.New("use the versioned composite API to change composite definitions")
	}
	if key == "AutoGroups" {
		var groups []string
		if err := common.UnmarshalJsonStr(value, &groups); err != nil {
			return err
		}
		return ValidateAutoGroupMembers(groups)
	}
	return nil
}

// normalizeGroupRatioOptions gives atomic writes a single price source without
// mutating the caller's draft or accepting conflicting aliases.
func normalizeGroupRatioOptions(values map[string]string) (map[string]string, error) {
	alias, exists := values["group_ratio_setting.group_ratio"]
	if !exists {
		return values, nil
	}
	if canonical, exists := values["GroupRatio"]; exists && canonical != alias {
		return nil, errors.New("conflicting group ratio options")
	}
	values = maps.Clone(values)
	values["GroupRatio"] = alias
	delete(values, "group_ratio_setting.group_ratio")
	return values, nil
}

func ValidateAutoGroupMembers(groups []string) error {
	if len(groups) == 0 {
		return nil
	}
	cfg, err := ReadCompositeConfig(DB)
	if err != nil {
		return err
	}
	for _, group := range groups {
		if _, composite := cfg.Groups[group]; composite {
			return errors.New("AUTO cannot contain composite groups")
		}
	}
	return nil
}

func CompositeHasChannelBindings(db *gorm.DB, name string) (bool, error) {
	var count int64
	err := ApplyChannelGroupFilter(db.Model(&Channel{}), name).Count(&count).Error
	return count > 0, err
}

// ReadCompositeConfig uses one SELECT for the type registry and GroupRatio.
// This is the request's consistency boundary, including on other instances.
func ReadCompositeConfig(db *gorm.DB) (*composite_setting.Config, error) {
	var rows []Option
	if err := db.Where(clause.IN{Column: clause.Column{Name: "key"}, Values: []any{composite_setting.OptionKey, "GroupRatio"}}).Find(&rows).Error; err != nil {
		return nil, err
	}
	cfg := &composite_setting.Config{Groups: map[string]composite_setting.Definition{}, Ratios: ratio_setting.GetGroupRatioCopy()}
	values := map[string]string{}
	for _, row := range rows {
		if _, duplicate := values[row.Key]; duplicate {
			return nil, errors.New("duplicate composite option rows")
		}
		values[row.Key] = row.Value
		if row.Key == composite_setting.OptionKey {
			if err := common.UnmarshalJsonStr(row.Value, &cfg.Groups); err != nil || cfg.Groups == nil {
				return nil, errors.New("invalid composite configuration")
			}
		} else {
			cfg.Ratios = nil
			if err := common.UnmarshalJsonStr(row.Value, &cfg.Ratios); err != nil || cfg.Ratios == nil {
				return nil, errors.New("invalid group ratios")
			}
		}
	}
	if len(cfg.Groups) > 0 && values["GroupRatio"] == "" {
		return nil, errors.New("composite base ratios are missing")
	}
	encoded, err := common.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	cfg.Version = fmt.Sprintf("%x", sha256.Sum256(encoded))
	return cfg, nil
}

type CompositeChange struct {
	ExpectedVersion string                       `json:"expected_version"`
	Definition      composite_setting.Definition `json:"definition"`
	Ratio           *float64                     `json:"ratio"`
}

// UpdateComposite retains type records permanently. Disabling is reversible;
// deleting a type would silently reinterpret existing keys as ordinary groups.
func UpdateComposite(name string, change CompositeChange, validateOnly bool) (*composite_setting.Config, error) {
	def, err := composite_setting.Normalize(name, change.Definition)
	if err != nil {
		return nil, err
	}
	if change.Ratio == nil || !composite_setting.ValidRatio(*change.Ratio) {
		return nil, errors.New("a finite non-negative composite ratio up to 1000 is required")
	}
	compositeMutationMu.Lock()
	defer compositeMutationMu.Unlock()
	var committed *composite_setting.Config
	err = DB.Transaction(func(tx *gorm.DB) error {
		// Start the write transaction before reading the version. In SQLite,
		// even an ignored INSERT acquires the writer reservation; a deferred
		// read followed by a write could otherwise race another process.
		if !validateOnly {
			row := Option{Key: composite_setting.OptionKey, Value: "{}"}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
				return err
			}
		}
		cfg, err := ReadCompositeConfig(lockForUpdate(tx))
		if err != nil {
			return err
		}
		if change.ExpectedVersion == "" || cfg.Version != change.ExpectedVersion {
			return ErrCompositeConflict
		}
		if _, exists := cfg.Groups[name]; !exists {
			if _, ordinary := cfg.Ratios[name]; ordinary {
				return errors.New("cannot convert an existing ordinary group to composite")
			}
		}
		cfg.Groups[name] = def
		cfg.Ratios[name] = *change.Ratio
		// Disabled records may retain broken references for recovery, but no
		// enabled definition may refer to a composite (including this new one).
		for group, definition := range cfg.Groups {
			if definition.Enabled {
				if err := cfg.Validate(group); err != nil {
					return err
				}
			}
		}
		var channelGroups []string
		if err := tx.Model(&Channel{}).Distinct("group").Pluck("group", &channelGroups).Error; err != nil {
			return err
		}
		for _, groups := range channelGroups {
			for group := range strings.SplitSeq(groups, ",") {
				if definition, composite := cfg.Groups[group]; composite && definition.Enabled {
					return errors.New("channels cannot bind directly to composite groups")
				}
			}
		}
		committed = cfg
		if validateOnly {
			return nil
		}
		for _, entry := range []struct {
			key   string
			value any
		}{{"GroupRatio", cfg.Ratios}, {composite_setting.OptionKey, cfg.Groups}} {
			encoded, err := common.Marshal(entry.value)
			if err != nil {
				return err
			}
			row := Option{Key: entry.key, Value: string(encoded)}
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value"})}).Create(&row).Error; err != nil {
				return err
			}
		}
		return tx.Where(clause.Eq{Column: clause.Column{Name: "key"}, Value: "group_ratio_setting.group_ratio"}).Delete(&Option{}).Error
	})
	if err != nil || validateOnly {
		return committed, err
	}
	for _, entry := range []struct {
		key   string
		value any
	}{{"GroupRatio", committed.Ratios}, {composite_setting.OptionKey, committed.Groups}} {
		encoded, _ := common.Marshal(entry.value)
		if err := updateOptionMap(entry.key, string(encoded)); err != nil {
			return nil, err
		}
	}
	RefreshPricing()
	return ReadCompositeConfig(DB)
}
