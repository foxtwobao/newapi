package helper

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

// ResolveRequestGroupRatio adds snapshot pricing for supported composite
// requests while keeping the native HandleGroupRatio contract unchanged.
func ResolveRequestGroupRatio(c *gin.Context, info *relaycommon.RelayInfo) (types.GroupRatioInfo, error) {
	snapshot := service.RequestComposite(c)
	if snapshot == nil {
		return HandleGroupRatio(c, info), nil
	}
	if autoGroup, exists := c.Get("auto_group"); exists {
		logger.LogDebug(c, "final group: %s", autoGroup)
		info.UsingGroup = autoGroup.(string)
	}
	billing, err := snapshot.Billing(info.UsingGroup)
	if err != nil {
		return types.GroupRatioInfo{}, err
	}
	return types.GroupRatioInfo{GroupRatio: billing.FinalRatio, GroupSpecialRatio: -1, Composite: billing}, nil
}

func captureCompositeReservation(c *gin.Context, info *relaycommon.RelayInfo, promptTokens int) error {
	if info.PriceData.GroupRatioInfo.Composite == nil {
		return nil
	}
	price := info.PriceData
	beforeGroup := price.ModelPrice * common.QuotaPerUnit
	if !price.UsePrice {
		multiplier, err := operation_setting.InputPreConsumeMultiplier()
		if err != nil {
			return err
		}
		beforeGroup = float64(promptTokens) * multiplier * price.ModelRatio
	}
	service.SetCompositeReservation(c, price.ApplyOtherRatiosToFloat(beforeGroup))
	return nil
}
