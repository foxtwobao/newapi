package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

func setCompositeRouter(api *gin.RouterGroup) {
	self := api.Group("/composite/self", middleware.UserAuth(), middleware.DisableCache())
	self.Use(func(c *gin.Context) { c.Set("composite_self", true); c.Next() })
	self.GET("", controller.GetComposites)
	self.GET("/:name", controller.GetComposites)
	admin := api.Group("/composite", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("", controller.GetComposites)
	admin.GET("/:name", controller.GetComposites)
	admin.PUT("/:name", controller.PutComposite)
}
