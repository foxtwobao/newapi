package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func prepareCompositeRequest(c *gin.Context) bool {
	if err := service.PrepareCompositeRequest(c); err != nil {
		abortWithOpenAiMessage(c, http.StatusForbidden, err.Error())
		return false
	}
	return true
}
