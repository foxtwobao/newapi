package service

import (
	"errors"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const compositeReservationKey = "newapi.composite.reservation_before_group"

// PrepareSelectedGroupBilling keeps native expression reservations intact and
// adds the legacy-price reservation needed by composite member retries.
func PrepareSelectedGroupBilling(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	snapshot := info.TieredBillingSnapshot
	if info.PriceData.GroupRatioInfo.Composite != nil && (snapshot == nil || snapshot.BillingMode != "tiered_expr") {
		return reserveCompositeRetry(c, info)
	}
	return PrepareTieredBillingForSelectedGroup(c, info)
}

func SetCompositeReservation(c *gin.Context, beforeGroup float64) {
	c.Set(compositeReservationKey, beforeGroup)
}

func reserveCompositeRetry(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if info.PriceData.GroupRatioInfo.Composite == nil {
		return nil
	}
	reservation, exists := c.Get(compositeReservationKey)
	beforeGroup, valid := reservation.(float64)
	if !exists || !valid {
		return types.NewError(errors.New("composite reservation is missing"), types.ErrorCodeModelPriceError, types.ErrOptionWithSkipRetry())
	}
	quota, err := common.QuotaFromFloatStrict(beforeGroup * info.PriceData.GroupRatioInfo.GroupRatio)
	if err != nil {
		return types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithSkipRetry())
	}
	if info.PriceData.GroupRatioInfo.GroupRatio == 0 {
		return nil
	}
	info.PriceData.FreeModel = false
	if info.Billing == nil {
		return PreConsumeBilling(c, quota, info)
	}
	if err := info.Billing.Reserve(quota); err != nil {
		return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
	}
	info.FinalPreConsumedQuota = info.Billing.GetPreConsumedQuota()
	return nil
}

func AppendCompositeBilling(other *model.LogOther, billing *hosttypes.CompositeBilling) {
	if billing != nil {
		// The caller's own price path; channel identifiers stay admin-only.
		other.SetPublic("composite", billing)
	}
}
