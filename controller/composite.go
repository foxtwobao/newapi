package controller

import (
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/composite_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

func setCompositeGroupMetadata(name string, metadata map[string]any) {
	if composite_setting.IsComposite(name) {
		metadata["ratio"] = "COMPOSITE"
		metadata["type"] = "composite"
		metadata["composite_ratio"] = ratio_setting.GetGroupRatio(name)
	}
}

// compositePricing separates route-dependent prices from ordinary group prices.
func compositePricing(usable map[string]string, ratios map[string]float64) ([]compositeView, error) {
	cfg, err := model.ReadCompositeConfig(model.DB)
	if err != nil {
		return nil, err
	}
	views := compositeViews(cfg, usable)
	for name := range cfg.Groups {
		delete(ratios, name)
		delete(usable, name)
	}
	return views, nil
}

type compositeModelPath struct {
	ModelName string                    `json:"model_name"`
	Paths     []*types.CompositeBilling `json:"paths"`
	Pricing   *model.Pricing            `json:"pricing,omitempty"`
}

type compositeView struct {
	Name       string                       `json:"name"`
	Definition composite_setting.Definition `json:"definition"`
	Ratio      *float64                     `json:"ratio"`
	Version    string                       `json:"version"`
	Error      string                       `json:"error,omitempty"`
	Models     []compositeModelPath         `json:"models"`
}

// compositeViews exposes only authorized composites and their billable paths,
// never credentials, channel identities or unrelated groups.
func compositeViews(cfg *composite_setting.Config, usable map[string]string) []compositeView {
	views := make([]compositeView, 0)
	prices := map[string]model.Pricing{}
	for _, price := range model.GetPricing() {
		price.EnableGroup = nil
		prices[price.ModelName] = price
	}
	for name, definition := range cfg.Groups {
		if usable != nil {
			if _, allowed := usable[name]; !allowed {
				continue
			}
		}
		view := compositeView{Name: name, Definition: definition, Version: cfg.Version, Models: []compositeModelPath{}}
		if ratio, exists := cfg.Ratios[name]; exists {
			view.Ratio = &ratio
		}
		snapshot, err := cfg.Snapshot(name)
		if bound, bindingErr := model.CompositeHasChannelBindings(model.DB, name); bindingErr != nil || bound {
			err = errors.New("composite has invalid channel bindings")
		}
		if err != nil {
			view.Error = err.Error()
		} else {
			paths := map[string][]*types.CompositeBilling{}
			for _, member := range snapshot.Members {
				billing, _ := snapshot.Billing(member)
				for _, modelName := range model.GetGroupEnabledModels(member) {
					paths[modelName] = append(paths[modelName], billing)
				}
			}
			for name, path := range paths {
				entry := compositeModelPath{ModelName: name, Paths: path}
				if price, exists := prices[name]; exists {
					entry.Pricing = &price
				}
				view.Models = append(view.Models, entry)
			}
			slices.SortFunc(view.Models, func(a, b compositeModelPath) int { return strings.Compare(a.ModelName, b.ModelName) })
		}
		views = append(views, view)
	}
	slices.SortFunc(views, func(a, b compositeView) int { return strings.Compare(a.Name, b.Name) })
	return views
}

func GetComposites(c *gin.Context) {
	cfg, err := model.ReadCompositeConfig(model.DB)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "group configuration is unavailable"})
		return
	}
	var usable map[string]string
	if c.GetBool("composite_self") {
		group, err := model.GetUserGroup(c.GetInt("id"), false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		usable = service.GetUserUsableGroups(group)
	}
	views := compositeViews(cfg, usable)
	if name := c.Param("name"); name != "" {
		for _, view := range views {
			if view.Name == name {
				common.ApiSuccess(c, view)
				return
			}
		}
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "composite not found"})
		return
	}
	common.ApiSuccess(c, gin.H{"version": cfg.Version, "groups": views, "max_members": composite_setting.MaxMembers})
}

func PutComposite(c *gin.Context) {
	var change model.CompositeChange
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
	if err := common.DecodeJson(c.Request.Body, &change); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid composite request"})
		return
	}
	cfg, err := model.UpdateComposite(c.Param("name"), change, c.Query("validate_only") == "true")
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, model.ErrCompositeConflict) {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"success": false, "message": err.Error()})
		return
	}
	common.ApiSuccess(c, gin.H{"version": cfg.Version})
}

func validateTokenGroup(c *gin.Context, group string) bool {
	if group == "" || group == "auto" {
		return true
	}
	userGroup, err := getTokenRequestUserGroup(c)
	if err != nil {
		common.ApiError(c, err)
		return false
	}
	if !service.IsUserSelectableGroup(userGroup, group) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "group access denied"})
		return false
	}
	return true
}
