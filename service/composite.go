package service

import (
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/composite_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

const compositeContextKey = "newapi.composite.snapshot"
const compositeConfigContextKey = "newapi.composite.config"
const compositeSelectedKey = "newapi.composite.selected"
const compositeRetryKey = "newapi.composite.retry"

func IsUserSelectableAutoGroup(userGroup, groupName string) bool {
	return !composite_setting.IsComposite(groupName) && IsUserSelectableGroup(userGroup, groupName)
}

// validateCompositePlayground prevents session-authenticated requests from
// interpreting a composite name as an ordinary group, even with bad bindings.
func validateCompositePlayground(c *gin.Context, group string) *ChannelSelectError {
	if c.Request == nil || !strings.HasPrefix(c.Request.URL.Path, "/pg/") {
		return nil
	}
	cfg, err := model.ReadCompositeConfig(model.DB)
	if err != nil {
		return &ChannelSelectError{StatusCode: http.StatusServiceUnavailable, Message: "group configuration is unavailable"}
	}
	if _, composite := cfg.Groups[group]; composite {
		return &ChannelSelectError{StatusCode: http.StatusForbidden, Message: "composite requires a supported token endpoint"}
	}
	return nil
}

func selectCompositeChannelForRequest(param *RetryParam) (*model.Channel, string, *ChannelSelectError) {
	channel, group, err := selectCompositeChannel(param)
	if err != nil {
		return nil, group, &ChannelSelectError{StatusCode: http.StatusForbidden, Message: err.Error()}
	}
	if channel == nil {
		return nil, group, &ChannelSelectError{StatusCode: http.StatusServiceUnavailable, Message: "no available channel in composite members"}
	}
	return channel, group, nil
}

func RequestComposite(c *gin.Context) *composite_setting.Snapshot {
	if c == nil {
		return nil
	}
	value, _ := c.Get(compositeContextKey)
	snapshot, _ := value.(*composite_setting.Snapshot)
	return snapshot
}

// PrepareCompositeRequest runs only after native token validation, retaining
// the token's stored group and all native model/IP/quota/expiry restrictions.
func PrepareCompositeRequest(c *gin.Context) error {
	cfg, err := model.ReadCompositeConfig(model.DB)
	if err != nil {
		return errors.New("group configuration is unavailable")
	}
	c.Set(compositeConfigContextKey, cfg)
	name := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	snapshot, err := cfg.Snapshot(name)
	if err != nil || snapshot == nil {
		return err
	}
	if bound, err := model.CompositeHasChannelBindings(model.DB, name); err != nil || bound {
		return errors.New("composite has invalid channel bindings")
	}
	if !GroupInUserUsableGroups(common.GetContextKeyString(c, constant.ContextKeyUserGroup), name) {
		return errors.New("composite access denied")
	}
	// Endpoint support belongs to the selected member channel and its plugin.
	// Keep composite routing independent of host and plugin route names.
	c.Set(compositeContextKey, snapshot)
	common.SetContextKey(c, constant.ContextKeyTokenGroup, "auto")
	common.SetContextKey(c, constant.ContextKeyUsingGroup, "auto")
	common.SetContextKey(c, constant.ContextKeyTokenCrossGroupRetry, snapshot.CrossGroupRetry)
	return nil
}

func ordinaryAutoGroups(c *gin.Context, groups []string) []string {
	value, _ := c.Get(compositeConfigContextKey)
	cfg, _ := value.(*composite_setting.Config)
	result := make([]string, 0, len(groups))
	for _, group := range groups {
		if cfg != nil {
			if _, composite := cfg.Groups[group]; composite {
				continue
			}
		} else if composite_setting.IsComposite(group) {
			continue
		}
		result = append(result, group)
	}
	return result
}

// selectCompositeChannel only owns member ordering. Native selection still
// owns protocol filters, priorities, weights and channel health within a group.
// Cross-group retries advance on a failed attempt and retain the native total
// retry budget. Missing models during initial selection do not spend retries.
func selectCompositeChannel(param *RetryParam) (*model.Channel, string, error) {
	c := param.Ctx
	snapshot := RequestComposite(c)
	selected := c.GetString(compositeSelectedKey)
	start := 0
	if selected != "" {
		start = slices.Index(snapshot.Members, selected)
		if start < 0 {
			return nil, "", errors.New("invalid composite route state")
		}
		if snapshot.CrossGroupRetry && param.GetRetry() > c.GetInt(compositeRetryKey) {
			start++
		}
	}
	constraints := GetChannelConstraints(c)
	for index := start; index < len(snapshot.Members); index++ {
		group := snapshot.Members[index]
		priorityRetry := param.GetRetry()
		if selected != group {
			priorityRetry = 0
		}
		channel, err := model.GetRandomSatisfiedChannel(group, param.ModelName, priorityRetry, constraints.Filters)
		if err != nil {
			return nil, group, err
		}
		if channel == nil {
			if selected != "" && !snapshot.CrossGroupRetry {
				return nil, group, nil
			}
			continue
		}
		// Pins cannot choose a later member or bypass the token model limit.
		if pin, found, _ := constraints.ResolvedPin(); found {
			pinned, err := model.CacheGetChannel(pin.ChannelId)
			if err != nil || pinned == nil || pinned.Status != common.ChannelStatusEnabled || !model.IsChannelEnabledForGroupModel(group, param.ModelName, pin.ChannelId) {
				return nil, group, errors.New("pinned channel is outside the selected composite member")
			}
			if ok, _ := model.ChannelSatisfiesFilters(pinned, param.ModelName, constraints.Filters); !ok {
				return nil, group, errors.New("pinned channel does not support this request")
			}
			channel = pinned
		} else if param.GetRetry() == 0 {
			if id, found := GetPreferredChannelByAffinity(c, param.ModelName, snapshot.Name); found {
				preferred, err := model.CacheGetChannel(id)
				usable := err == nil && preferred != nil && preferred.Status == common.ChannelStatusEnabled && model.IsChannelEnabledForGroupModel(group, param.ModelName, id)
				if usable {
					usable, _ = model.ChannelSatisfiesFilters(preferred, param.ModelName, constraints.Filters)
				}
				if usable {
					channel = preferred
					MarkChannelAffinityUsed(c, group, id)
				} else if RequestPolicy(c).SessionMode == "strict" {
					return nil, group, errors.New("strict_session_binding_unavailable")
				}
			}
		}
		if common.GetContextKeyBool(c, constant.ContextKeyTokenModelLimitEnabled) {
			limits, _ := common.GetContextKeyType[map[string]bool](c, constant.ContextKeyTokenModelLimit)
			if !limits[param.ModelName] && !limits[ratio_setting.FormatMatchingModelName(param.ModelName)] && !limits[ratio_setting.RoutingMatchModelName(param.ModelName)] {
				return nil, group, errors.New("token has no access to this model")
			}
		}
		c.Set(compositeSelectedKey, group)
		c.Set(compositeRetryKey, param.GetRetry())
		common.SetContextKey(c, constant.ContextKeyAutoGroup, group)
		return channel, group, nil
	}
	return nil, "", nil
}
