package controller

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/composite_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newCompositeFixture(t *testing.T) (*gin.Engine, *model.User, *model.Token) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())
	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldStreamingTimeout })
	user, token := setupResponsesWSRequestTest(t)
	db := model.DB
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = oldOptions })
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.Channel{}, &model.Ability{}, &model.UserSubscription{}, &model.Model{}, &model.Vendor{}))
	require.NoError(t, model.LOG_DB.AutoMigrate(&model.Log{}))
	t.Cleanup(func() {
		require.NoError(t, model.LOG_DB.Where("user_id = ?", user.Id).Delete(&model.Log{}).Error)
		require.NoError(t, db.Where(map[string]any{"key": "GroupRatio"}).Or(map[string]any{"key": composite_setting.OptionKey}).Delete(&model.Option{}).Error)
	})
	oldRatios, oldPrices := ratio_setting.GroupRatio2JSONString(), ratio_setting.ModelPrice2JSONString()
	oldUsable, oldAuto := setting.UserUsableGroups2JSONString(), setting.AutoGroups2JsonString()
	oldBatch, oldLog := common.BatchUpdateEnabled, common.LogConsumeEnabled
	oldMax := setting.GetMaxTokenAutoGroups()
	require.NoError(t, setting.UpdateMaxTokenAutoGroups("1"))
	common.BatchUpdateEnabled, common.LogConsumeEnabled = false, true
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldRatios))
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(oldPrices))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(oldUsable))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(oldAuto))
		require.NoError(t, composite_setting.UpdateIdentityIndex(`{}`))
		common.BatchUpdateEnabled, common.LogConsumeEnabled = oldBatch, oldLog
		require.NoError(t, setting.UpdateMaxTokenAutoGroups(fmt.Sprint(oldMax)))
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","auto":"Auto","PPTONE":"PPT","AGENTONE":"Agent"}`))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["default"]`))
	require.NoError(t, model.UpdateOption("GroupRatio", `{"default":1,"GPT":0.4,"IMAGE":0.8}`))
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"gpt-5.6":0.01,"gpt-image-2":0.01}`))
	require.NoError(t, db.Model(user).Update("quota", 1_000_000).Error)
	require.NoError(t, db.Model(token).Updates(map[string]any{"group": "PPTONE", "remain_quota": 1_000_000, "auto_groups": `["default"]`}).Error)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "fail") {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":{"message":"mock upstream failure","type":"server_error"}}`))
			return
		}
		var request map[string]any
		_ = common.DecodeJson(r.Body, &request)
		if strings.Contains(r.URL.Path, "images") {
			_, _ = w.Write([]byte(`{"created":1,"data":[{"b64_json":"aW1hZ2U="}],"usage":{"input_tokens":1000,"output_tokens":100,"total_tokens":1100,"input_tokens_details":{"cached_tokens":300}}}`))
			return
		}
		if strings.Contains(r.URL.Path, "responses") {
			response := `{"id":"resp_test","object":"response","status":"completed","model":"gpt-5.6","output":[{"type":"message","id":"msg_test","role":"assistant","status":"completed","content":[{"type":"output_text","text":"ok","annotations":[]}]}],"usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}`
			if request["stream"] == true {
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = fmt.Fprintf(w, "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":%s}\n\n", response)
			} else {
				_, _ = w.Write([]byte(response))
			}
			return
		}
		if request["stream"] == true {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("data: {\"id\":\"chat-test\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-5.6\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\ndata: {\"id\":\"chat-test\",\"object\":\"chat.completion.chunk\",\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2,\"total_tokens\":12}}\n\ndata: [DONE]\n\n"))
			return
		}
		_, _ = w.Write([]byte(`{"id":"chat-test","object":"chat.completion","model":"gpt-5.6","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}`))
	}))
	t.Cleanup(upstream.Close)
	for _, entry := range []struct{ group, model string }{{"GPT", "gpt-5.6"}, {"IMAGE", "gpt-image-2"}} {
		channel := &model.Channel{Type: constant.ChannelTypeOpenAI, Key: "mock-secret", Status: common.ChannelStatusEnabled, Name: entry.group, Group: entry.group, Models: entry.model, BaseURL: common.GetPointer(upstream.URL)}
		require.NoError(t, db.Create(channel).Error)
		require.NoError(t, db.Create(&model.Ability{Group: entry.group, Model: entry.model, ChannelId: channel.Id, Enabled: true}).Error)
		t.Cleanup(func() {
			require.NoError(t, db.Where("channel_id = ?", channel.Id).Delete(&model.Ability{}).Error)
			require.NoError(t, db.Delete(channel).Error)
		})
	}
	cfg, err := model.ReadCompositeConfig(db)
	require.NoError(t, err)
	_, err = model.UpdateComposite("PPTONE", model.CompositeChange{ExpectedVersion: cfg.Version, Definition: composite_setting.Definition{Enabled: true, Members: []string{"GPT", "IMAGE"}}, Ratio: common.GetPointer(0.8)}, false)
	require.NoError(t, err)
	engine := gin.New()
	engine.Use(middleware.BodyStorageCleanup())
	engine.GET("/v1/models", middleware.TokenAuth(), func(c *gin.Context) { ListModels(c, constant.ChannelTypeOpenAI) })
	engine.POST("/v1/chat/completions", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAI) })
	engine.POST("/v1/images/generations", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAIImage) })
	engine.POST("/v1/images/edits", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAIImage) })
	engine.POST("/v1/responses", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAIResponses) })
	engine.GET("/v1/responses", middleware.TokenAuth(), func(c *gin.Context) { c.Status(http.StatusOK) })
	engine.GET("/v1/realtime", middleware.TokenAuth(), func(c *gin.Context) { c.Status(http.StatusOK) })
	engine.POST("/pg/chat/completions", func(c *gin.Context) {
		common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
		common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
	}, middleware.Distribute(), func(c *gin.Context) { c.Status(http.StatusOK) })
	return engine, user, token
}

func TestCompositeInvalidStateAndExplicitFree(t *testing.T) {
	engine, user, token := newCompositeFixture(t)
	for _, tc := range []struct{ name, key, value string }{
		{"missing ratio", "GroupRatio", `{"default":1,"IMAGE":0.8,"PPTONE":0.8}`},
		{"broken registry", composite_setting.OptionKey, `{`},
		{"nested member", composite_setting.OptionKey, `{"PPTONE":{"enabled":true,"members":["PPTONE"]}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var original model.Option
			require.NoError(t, model.DB.Where(map[string]any{"key": tc.key}).First(&original).Error)
			previous := original.Value
			// Simulate a different process or an unsupported raw database edit:
			// the local option cache deliberately retains the previous values.
			require.NoError(t, model.DB.Model(&original).Update("value", tc.value).Error)
			assert.Equal(t, http.StatusForbidden, compositeRequest(engine, token, http.MethodGet, "/v1/models", "").Code)
			require.NoError(t, model.DB.Model(&original).Update("value", previous).Error)
		})
	}
	var channel model.Channel
	require.NoError(t, model.DB.Where("name = ?", "GPT").First(&channel).Error)
	require.NoError(t, model.DB.Model(&channel).Update("group", "GPT,PPTONE").Error)
	assert.Equal(t, http.StatusForbidden, compositeRequest(engine, token, http.MethodGet, "/v1/models", "").Code)
	require.NoError(t, model.DB.Model(&channel).Update("group", "GPT").Error)
	cfg, err := model.ReadCompositeConfig(model.DB)
	require.NoError(t, err)
	_, err = model.UpdateComposite("PPTONE", model.CompositeChange{ExpectedVersion: cfg.Version, Definition: cfg.Groups["PPTONE"], Ratio: common.GetPointer(0.0)}, false)
	require.NoError(t, err)
	response := compositeRequest(engine, token, http.MethodPost, "/v1/chat/completions", `{"model":"gpt-5.6","messages":[{"role":"user","content":"hi"}]}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var log model.Log
	require.NoError(t, model.LOG_DB.Where("user_id = ?", user.Id).Order("id DESC").First(&log).Error)
	assert.Zero(t, log.Quota)
	require.NoError(t, model.DB.First(user, user.Id).Error)
	require.NoError(t, model.DB.First(token, token.Id).Error)
	assert.Equal(t, 1_000_000, user.Quota)
	assert.Equal(t, 1_000_000, token.RemainQuota)
}

func TestCompositeTaskSnapshotSurvivesRequest(t *testing.T) {
	for _, scenario := range []string{"image/immediate", "image/SUCCESS", "image/FAILURE", "video/immediate", "video/SUCCESS", "video/FAILURE", "native/SUCCESS"} {
		t.Run(scenario, func(t *testing.T) {
			kind, terminal, _ := strings.Cut(scenario, "/")
			path := "/v1/images/generations"
			if kind == "video" {
				path = "/v1/videos"
			} else if kind == "native" {
				path = "/composite-fixture/jobs"
			}
			_, user, token := newCompositeFixture(t)
			require.NoError(t, model.DB.AutoMigrate(&model.Task{}))
			t.Cleanup(func() { require.NoError(t, model.DB.Where("user_id = ?", user.Id).Delete(&model.Task{}).Error) })
			oldRegistry, oldFactory := pluginruntime.DefaultRegistry, service.GetTaskAdaptorFunc
			oldLimit := constant.TaskQueryLimit
			constant.TaskQueryLimit = 100
			t.Cleanup(func() { constant.TaskQueryLimit = oldLimit })
			pluginruntime.DefaultRegistry = pluginruntime.NewRegistry()
			pluginruntime.DefaultRegistry.SetEnabled(true)
			service.GetTaskAdaptorFunc = func(platform constant.TaskPlatform) service.TaskPollingAdaptor { return relay.GetTaskAdaptor(platform) }
			t.Cleanup(func() { pluginruntime.DefaultRegistry, service.GetTaskAdaptorFunc = oldRegistry, oldFactory })
			source := `
export const meta={apiVersion:1,key:"composite-image",name:"Composite image fixture",version:"1.0.0",author:{name:"Test"},models:["gpt-image-2"],fetchMode:"per_task",protocols:["openai_image"],usageSchema:{image_count:{type:"number",unit:"count",description:{en:"Image generation unit price",zh:"图片生成单价"}}}};
export function buildSubmitRequest(ctx){return {url:ctx.baseUrl+"/submit",body:ctx.requestBody};}
export function parseSubmitResponse(ctx,resp){return {taskId:"vendor-image",taskData:resp.body,immediate:resp.body.immediate ? {status:"SUCCESS"}:undefined};}
export function buildQueryRequest(ctx){return {url:ctx.baseUrl+"/query"};}
export function parseTaskResult(ctx,body){return {status:body.status,reason:"mock failure",progress:"100%"};}
export function extractUsage(){return {image_count:4};}
export function extractUsageOnComplete(ctx,result,body){return {image_count:body.count};}
export const protocols={openai_image:{decodeRequest:function(ctx){return {kind:"submit",model:ctx.model,requestBody:ctx.body.value};},render:function(ctx,task){return {data:[{b64_json:"aW1hZ2U="}]};}}};
`
			expression := `tier("images", u("image_count") * 0.01)`
			if kind == "video" {
				source = strings.NewReplacer(
					"openai_image", "openai_video", "image_count", "seconds",
					`unit:"count"`, `unit:"second"`,
					"Image generation unit price", "Video generation unit price",
					"图片生成单价", "视频生成单价",
					`return {data:[{b64_json:"aW1hZ2U="}]}`, `return {}`,
				).Replace(source)
				source += `
export function listArtifacts(){return [];}
export function buildContentRequest(ctx){return {url:ctx.baseUrl+"/content"};}
`
				expression = `tier("video", u("seconds") * 0.01)`
			}
			if kind == "native" {
				source = strings.Replace(source, `protocols:["openai_image"],`, `protocols:["openai_image"],routes:[{method:"POST",path:"/composite-fixture/jobs",type:"submit",decode:"create",render:"created"}],`, 1)
				source += `
export const native={create:function(ctx){return {kind:"submit",model:ctx.body.value.model,requestBody:ctx.body.value};},created:function(ctx,task){return {id:task.task_id};}};
`
			}
			plugin, err := pluginruntime.DefaultRegistry.Register(source, pluginruntime.Options{})
			require.NoError(t, err)
			withTieredBillingConfig(t, map[string]string{"gpt-image-2": "tiered_expr"}, map[string]string{"gpt-image-2": expression})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(w, `{"count":2,"status":%q,"immediate":%t}`, terminal, terminal == "immediate")
			}))
			t.Cleanup(server.Close)
			var channel model.Channel
			require.NoError(t, model.DB.Where("name = ?", "IMAGE").First(&channel).Error)
			require.NoError(t, model.DB.Model(&channel).Updates(map[string]any{"type": constant.ChannelTypeTaskPlugin, "setting": `{"task_plugin_key":"composite-image"}`, "base_url": server.URL}).Error)
			engine := gin.New()
			engine.Use(middleware.BodyStorageCleanup())
			prepare := []gin.HandlerFunc{middleware.TokenAuth(), middleware.PinTaskPluginEndpoint(), middleware.PrepareTaskPluginEndpoint(), middleware.Distribute()}
			if kind == "native" {
				prepare = []gin.HandlerFunc{func(c *gin.Context) {
					c.Set(pluginruntime.ContextKeyPinnedRoute, pluginruntime.PinnedRoute{Plugin: plugin, Route: plugin.Meta.Routes[0]})
				}, middleware.TokenAuth(), middleware.PrepareTaskPluginRoute(), middleware.Distribute()}
			}
			engine.POST(path, append(prepare, func(c *gin.Context) {
				if kind == "native" {
					RelayTask(c)
					return
				}
				if kind == "video" {
					RelayTaskPluginEndpoint(c, RelayTask)
					return
				}
				if terminal == "immediate" {
					RelayTaskPluginEndpoint(c, func(c *gin.Context) { t.Error("plugin claim fell back to native relay") })
					return
				}
				info, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
				require.NoError(t, err)
				outcome, taskErr := executeTaskSubmission(c, info)
				require.Nil(t, taskErr)
				require.NotNil(t, outcome)
				c.Status(http.StatusOK)
			})...)
			engine.GET("/v1/videos/:task_id", middleware.TokenAuth(), middleware.Distribute(), RelayTaskFetch)
			engine.GET("/v1/videos/:task_id/content", middleware.TokenAuth(), VideoProxy)
			engine.HEAD("/v1/videos/:task_id/content", middleware.TokenAuth(), VideoProxy)
			response := compositeRequest(engine, token, http.MethodPost, path, `{"model":"gpt-image-2","prompt":"test","n":4,"seconds":4}`)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var stored model.Task
			require.NoError(t, model.DB.Where("user_id = ?", user.Id).First(&stored).Error)
			require.NotNil(t, stored.PrivateData.BillingContext)
			require.NotNil(t, stored.PrivateData.BillingContext.Composite)
			assert.Equal(t, 0.64, stored.PrivateData.BillingContext.Composite.FinalRatio)
			if terminal != "immediate" {
				assert.Equal(t, 12800, stored.Quota)
				require.NoError(t, model.UpdateOption("GroupRatio", `{"default":1,"GPT":2,"IMAGE":3,"PPTONE":4}`))
				// The request and its Gin context have ended. A fresh background
				// poll reloads the JSON snapshot and settles with the old price.
				service.RunTaskPollingOnce(context.Background(), nil)
				service.RunTaskPollingOnce(context.Background(), nil)
			}
			want := 6400
			if terminal == "FAILURE" {
				want = 0
			}
			require.NoError(t, model.DB.First(&stored, stored.ID).Error)
			assert.Equal(t, want, stored.Quota)
			assert.Contains(t, []model.TaskStatus{model.TaskStatusSuccess, model.TaskStatusFailure}, stored.Status)
			require.NoError(t, model.DB.First(user, user.Id).Error)
			require.NoError(t, model.DB.First(token, token.Id).Error)
			assert.Equal(t, 1_000_000-want, user.Quota)
			assert.Equal(t, 1_000_000-want, token.RemainQuota)
			var logs []model.Log
			require.NoError(t, model.LOG_DB.Where("user_id = ?", user.Id).Find(&logs).Error)
			total := 0
			for _, log := range logs {
				if log.Type == model.LogTypeRefund {
					total -= log.Quota
				} else {
					total += log.Quota
				}
				assert.Contains(t, log.Other, `"final_ratio":0.64`)
			}
			assert.Equal(t, want, total)
			if kind == "video" {
				videoPath := "/v1/videos/" + stored.TaskID
				response := compositeRequest(engine, token, http.MethodGet, videoPath, "")
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				assert.Contains(t, response.Body.String(), stored.TaskID)
				if terminal != "FAILURE" {
					stored.PrivateData.ResultURL = "data:video/mp4;base64,dmlkZW8="
					require.NoError(t, model.DB.Model(&stored).Update("private_data", stored.PrivateData).Error)
					for _, method := range []string{http.MethodGet, http.MethodHead} {
						response := compositeRequest(engine, token, method, videoPath+"/content", "")
						require.Equal(t, http.StatusOK, response.Code, response.Body.String())
					}
				}
				// Task identifiers never grant access to another user's result.
				require.NoError(t, model.DB.Model(&stored).Update("user_id", user.Id+1).Error)
				for _, suffix := range []string{"", "/content"} {
					response := compositeRequest(engine, token, http.MethodGet, videoPath+suffix, "")
					assert.GreaterOrEqual(t, response.Code, 400, response.Body.String())
					assert.NotContains(t, response.Body.String(), "dmlkZW8=")
				}
				require.NoError(t, model.DB.Model(&stored).Update("user_id", user.Id).Error)
			}
		})
	}
}

func TestCompositeAuthorizationAndNativeControls(t *testing.T) {
	engine, user, token := newCompositeFixture(t)
	engine.POST("/v1/videos", middleware.TokenAuth(), middleware.Distribute(), RelayTask)
	models := compositeRequest(engine, token, http.MethodGet, "/v1/models", "")
	require.Equal(t, http.StatusOK, models.Code, models.Body.String())
	assert.Contains(t, models.Body.String(), `"gpt-5.6"`)
	assert.Contains(t, models.Body.String(), `"gpt-image-2"`)
	for _, path := range []string{"/v1/responses", "/v1/realtime"} {
		assert.Equal(t, http.StatusOK, compositeRequest(engine, token, http.MethodGet, path, "").Code)
	}
	assert.Equal(t, http.StatusForbidden, compositeRequest(engine, token, http.MethodPost, "/pg/chat/completions", `{"model":"gpt-5.6","group":"PPTONE"}`).Code)
	engine.POST("/api/token", func(c *gin.Context) { c.Set("id", user.Id) }, AddToken)
	deniedCreate := compositeRequest(engine, token, http.MethodPost, "/api/token", `{"name":"direct","group":"GPT","expired_time":-1,"remain_quota":10}`)
	assert.Equal(t, http.StatusForbidden, deniedCreate.Code)
	for _, change := range []struct {
		name   string
		fields map[string]any
		status int
	}{
		{"direct group", map[string]any{"group": "GPT"}, http.StatusForbidden},
		{"disabled key", map[string]any{"status": common.TokenStatusDisabled}, http.StatusUnauthorized},
		{"expired key", map[string]any{"expired_time": 1}, http.StatusUnauthorized},
		{"exhausted key", map[string]any{"remain_quota": 0}, http.StatusUnauthorized},
		{"IP restriction", map[string]any{"allow_ips": "198.51.100.5"}, http.StatusForbidden},
		{"model restriction", map[string]any{"model_limits_enabled": true, "model_limits": "gpt-image-2"}, http.StatusForbidden},
	} {
		t.Run(change.name, func(t *testing.T) {
			require.NoError(t, model.DB.Model(token).Updates(map[string]any{"group": "PPTONE", "status": common.TokenStatusEnabled, "expired_time": -1, "remain_quota": 1_000_000, "allow_ips": "", "model_limits_enabled": false}).Error)
			require.NoError(t, model.DB.Model(token).Updates(change.fields).Error)
			for _, path := range []string{"/v1/chat/completions", "/v1/videos"} {
				response := compositeRequest(engine, token, http.MethodPost, path, `{"model":"gpt-5.6","messages":[{"role":"user","content":"hi"}]}`)
				assert.Equal(t, change.status, response.Code, response.Body.String())
			}
		})
	}
	require.Error(t, model.UpdateOption("AutoGroups", `["PPTONE"]`))
}

func TestCompositeManagementAndRoutingIsolation(t *testing.T) {
	engine, user, token := newCompositeFixture(t)
	require.NoError(t, model.LOG_DB.AutoMigrate(&model.AuditLog{}))
	t.Cleanup(func() { require.NoError(t, model.LOG_DB.Where("user_id = ?", user.Id).Delete(&model.AuditLog{}).Error) })
	require.NoError(t, model.DB.AutoMigrate(&model.UserAccessToken{}))
	t.Cleanup(func() {
		require.NoError(t, model.DB.Where("user_id = ?", user.Id).Delete(&model.UserAccessToken{}).Error)
	})
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleCommonUser).Error)
	credential, _ := createScopedAccessToken(t, user.Id, time.Now().Add(time.Hour).Unix(), "profile:read")
	engine.GET("/api/composite/self", middleware.UserAuth(), func(c *gin.Context) { c.Set("composite_self", true) }, GetComposites)
	engine.GET("/api/composite", middleware.RootAuth(), GetComposites)
	engine.PUT("/api/composite/:name", middleware.RootAuth(), PutComposite)
	engine.GET("/api/pricing", middleware.UserAuth(), GetPricing)
	apiRequest := func(method, path, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+credential)
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		return recorder
	}
	assert.Equal(t, http.StatusForbidden, apiRequest(http.MethodPut, "/api/composite/PPTONE", `{}`).Code)
	response := apiRequest(http.MethodGet, "/api/composite/self", "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	assert.Contains(t, response.Body.String(), `"final_ratio":0.32`)
	assert.NotContains(t, response.Body.String(), "mock-secret")
	response = apiRequest(http.MethodGet, "/api/pricing", "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var pricePayload struct {
		CompositeGroups []compositeView    `json:"composite_groups"`
		GroupRatio      map[string]float64 `json:"group_ratio"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &pricePayload))
	require.Len(t, pricePayload.CompositeGroups, 1)
	assert.NotContains(t, pricePayload.GroupRatio, "PPTONE")
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleRootUser).Error)
	assert.Equal(t, http.StatusForbidden, apiRequest(http.MethodGet, "/api/composite", "").Code)
	assert.Equal(t, http.StatusForbidden, apiRequest(http.MethodPut, "/api/composite/PPTONE", `{}`).Code)
	credential, _ = createScopedAccessToken(t, user.Id, time.Now().Add(time.Hour).Unix(), "profile:read", "option:read", "option:write")
	assert.Equal(t, http.StatusOK, apiRequest(http.MethodGet, "/api/composite", "").Code)
	cfg, err := model.ReadCompositeConfig(model.DB)
	require.NoError(t, err)
	body, err := common.Marshal(model.CompositeChange{ExpectedVersion: cfg.Version, Definition: composite_setting.Definition{Enabled: true, Members: []string{"IMAGE"}}, Ratio: common.GetPointer(0.9)})
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, apiRequest(http.MethodPut, "/api/composite/AGENTONE?validate_only=true", string(body)).Code)
	unchanged, err := model.ReadCompositeConfig(model.DB)
	require.NoError(t, err)
	assert.Equal(t, cfg.Version, unchanged.Version)
	assert.Equal(t, http.StatusOK, apiRequest(http.MethodPut, "/api/composite/AGENTONE", string(body)).Code)
	assert.Equal(t, http.StatusConflict, apiRequest(http.MethodPut, "/api/composite/AGENTONE", string(body)).Code)

	var first, later model.Channel
	require.NoError(t, model.DB.Where("name = ?", "GPT").First(&first).Error)
	require.NoError(t, model.DB.Where("name = ?", "IMAGE").First(&later).Error)
	require.NoError(t, model.DB.Model(&later).Update("models", "gpt-image-2,gpt-5.6").Error)
	require.NoError(t, model.DB.Create(&model.Ability{Group: "IMAGE", Model: "gpt-5.6", ChannelId: later.Id, Enabled: true}).Error)
	pinned := *token
	pinned.Key += fmt.Sprintf("-%d", later.Id)
	assert.Equal(t, http.StatusForbidden, compositeRequest(engine, &pinned, http.MethodPost, "/v1/chat/completions", `{"model":"gpt-5.6","messages":[{"role":"user","content":"hi"}]}`).Code)
	pinned.Key = token.Key + fmt.Sprintf("-%d", first.Id)
	assert.Equal(t, http.StatusOK, compositeRequest(engine, &pinned, http.MethodPost, "/v1/chat/completions", `{"model":"gpt-5.6","messages":[{"role":"user","content":"hi"}]}`).Code)

	affinity := operation_setting.GetChannelAffinitySetting()
	previousAffinity := *affinity
	t.Cleanup(func() { *affinity = previousAffinity; service.ClearChannelAffinityCacheAll() })
	affinity.Enabled = true
	affinity.Rules = []operation_setting.ChannelAffinityRule{{Name: "composite-test", ModelRegex: []string{"^gpt-5.6$"}, KeySources: []operation_setting.ChannelAffinityKeySource{{Type: "request_header", Key: "X-Affinity-Key"}}, IncludeRuleName: true, IncludeUsingGroup: true}}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Affinity-Key", "composite-test-session")
	service.GetPreferredChannelByAffinity(ctx, "gpt-5.6", "PPTONE")
	service.RecordChannelAffinity(ctx, later.Id)
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-5.6","group":"IMAGE","auto_groups":["IMAGE"],"messages":[{"role":"user","content":"hi"}]}`))
	request.Header.Set("Authorization", "Bearer sk-"+token.Key)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Affinity-Key", "composite-test-session")
	request.Header.Set("X-Composite-Group", "AGENTONE")
	response = httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var log model.Log
	require.NoError(t, model.LOG_DB.Where("user_id = ?", user.Id).Order("id DESC").First(&log).Error)
	assert.Equal(t, "GPT", log.Group)
	assert.Equal(t, 1600, log.Quota)
	// AUTO validation must use the database and return the same rejection
	// whether the editor cache knows the composite or has not seen it yet.
	registry, err := common.Marshal(cfg.Groups)
	require.NoError(t, err)
	for _, cachedRegistry := range []string{string(registry), `{}`} {
		require.NoError(t, composite_setting.UpdateIdentityIndex(cachedRegistry))
		recorder := httptest.NewRecorder()
		validationContext, _ := gin.CreateTestContext(recorder)
		validationContext.Set("group", "default")
		previousAutoGroups := token.AutoGroups
		assert.False(t, setTokenAutoGroups(validationContext, token, []string{"PPTONE"}))
		assert.Equal(t, http.StatusOK, recorder.Code)
		assert.JSONEq(t, `{"success":false,"message":"AUTO cannot contain composite groups"}`, recorder.Body.String())
		assert.Equal(t, previousAutoGroups, token.AutoGroups)
	}
}

func TestCompositeConfigAndFrozenPrice(t *testing.T) {
	engine, user, token := newCompositeFixture(t)
	cfg, err := model.ReadCompositeConfig(model.DB)
	require.NoError(t, err)
	for _, tc := range []struct {
		name    string
		members []string
		ratio   float64
	}{
		{"auto", []string{"GPT"}, 0.8}, {"NESTED", []string{"PPTONE"}, 0.8}, {"SELF", []string{"SELF"}, 0.8}, {"MISSING", []string{"missing"}, 0.8},
		{"NEGATIVE", []string{"GPT"}, -1}, {"NAN", []string{"GPT"}, math.NaN()}, {"INFINITY", []string{"GPT"}, math.Inf(1)}, {"TOO_LARGE", []string{"GPT"}, 1001},
	} {
		_, err := model.UpdateComposite(tc.name, model.CompositeChange{ExpectedVersion: cfg.Version, Definition: composite_setting.Definition{Enabled: true, Members: tc.members}, Ratio: &tc.ratio}, false)
		assert.Error(t, err, tc.name)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, name := range []string{"AGENTONE", "OTHER"} {
		wg.Go(func() {
			_, err := model.UpdateComposite(name, model.CompositeChange{ExpectedVersion: cfg.Version, Definition: composite_setting.Definition{Enabled: true, Members: []string{"GPT", "GPT", "IMAGE"}}, Ratio: common.GetPointer(0.9)}, false)
			results <- err
		})
	}
	wg.Wait()
	close(results)
	succeeded, conflicted := 0, 0
	for err := range results {
		if err == nil {
			succeeded++
		} else {
			assert.ErrorIs(t, err, model.ErrCompositeConflict)
			conflicted++
		}
	}
	assert.Equal(t, 1, succeeded)
	assert.Equal(t, 1, conflicted)
	require.Error(t, model.UpdateOption(composite_setting.OptionKey, `{}`))
	require.Error(t, model.UpdateOption("AutoGroups", `["PPTONE"]`))
	var frozen *gin.Context
	capture := gin.New()
	capture.POST("/v1/chat/completions", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { frozen = c.Copy() })
	response := compositeRequest(capture, token, http.MethodPost, "/v1/chat/completions", `{"model":"gpt-5.6"}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.NotNil(t, frozen)
	cfg, err = model.ReadCompositeConfig(model.DB)
	require.NoError(t, err)
	_, err = model.UpdateComposite("PPTONE", model.CompositeChange{ExpectedVersion: cfg.Version, Definition: composite_setting.Definition{Enabled: true, Members: []string{"IMAGE", "GPT"}}, Ratio: common.GetPointer(0.5)}, false)
	require.NoError(t, err)
	price, err := helper.ResolveRequestGroupRatio(frozen, &relaycommon.RelayInfo{UserGroup: "default", UsingGroup: "GPT"})
	require.NoError(t, err)
	assert.Equal(t, 0.32, price.GroupRatio)
	assert.Equal(t, []string{"GPT", "IMAGE"}, service.GetRequestAutoGroups(frozen, "default"))
	response = compositeRequest(engine, token, http.MethodPost, "/v1/chat/completions", `{"model":"gpt-5.6","messages":[{"role":"user","content":"hi"}]}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var log model.Log
	require.NoError(t, model.LOG_DB.Where("user_id = ?", user.Id).Order("id DESC").First(&log).Error)
	assert.Equal(t, 1000, log.Quota)
	cfg, err = model.ReadCompositeConfig(model.DB)
	require.NoError(t, err)
	_, err = model.UpdateComposite("PPTONE", model.CompositeChange{ExpectedVersion: cfg.Version, Definition: composite_setting.Definition{Enabled: false, Members: []string{"GPT", "IMAGE"}}, Ratio: common.GetPointer(0.8)}, false)
	require.NoError(t, err)
	assert.Equal(t, http.StatusForbidden, compositeRequest(engine, token, http.MethodGet, "/v1/models", "").Code)
	price, err = helper.ResolveRequestGroupRatio(frozen, &relaycommon.RelayInfo{UserGroup: "default", UsingGroup: "GPT"})
	require.NoError(t, err)
	assert.Equal(t, 0.32, price.GroupRatio)
}

func TestCompositeGroupRatioOptionAliases(t *testing.T) {
	for _, tc := range []struct {
		name     string
		single   bool
		both     bool
		conflict bool
	}{
		{name: "single legacy alias", single: true},
		{name: "bulk legacy alias"},
		{name: "matching aliases", both: true},
		{name: "conflicting aliases", both: true, conflict: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			newCompositeFixture(t)
			cfg, err := model.ReadCompositeConfig(model.DB)
			require.NoError(t, err)
			previousVersion := cfg.Version
			alias := "group_ratio_setting.group_ratio"
			require.NoError(t, model.DB.Create(&model.Option{Key: alias, Value: `{"GPT":9}`}).Error)
			t.Cleanup(func() {
				require.NoError(t, model.DB.Where(map[string]any{"key": alias}).Delete(&model.Option{}).Error)
			})
			cfg.Ratios["GPT"] = 0.6
			encoded, err := common.Marshal(cfg.Ratios)
			require.NoError(t, err)
			values := map[string]string{alias: string(encoded)}
			if tc.both {
				values["GroupRatio"] = string(encoded)
				if tc.conflict {
					values["GroupRatio"] = `{"GPT":2}`
				}
			}
			if tc.single {
				err = model.UpdateOption(alias, string(encoded))
			} else {
				err = model.UpdateOptionsBulk(values)
			}
			assert.Equal(t, string(encoded), values[alias], "the caller's settings draft must remain intact")
			if tc.conflict {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			current, readErr := model.ReadCompositeConfig(model.DB)
			require.NoError(t, readErr)
			var aliasRows int64
			require.NoError(t, model.DB.Model(&model.Option{}).Where(map[string]any{"key": alias}).Count(&aliasRows).Error)
			if tc.conflict {
				assert.Equal(t, previousVersion, current.Version)
				assert.EqualValues(t, 1, aliasRows)
				return
			}
			assert.Zero(t, aliasRows)
			assert.Equal(t, 0.6, current.Ratios["GPT"])
			assert.Equal(t, 0.6, ratio_setting.GetGroupRatio("GPT"))
			snapshot, snapshotErr := current.Snapshot("PPTONE")
			require.NoError(t, snapshotErr)
			price, priceErr := snapshot.Billing("GPT")
			require.NoError(t, priceErr)
			assert.Equal(t, 0.48, price.FinalRatio)
		})
	}
}

func TestCompositeConcurrentProcesses(t *testing.T) {
	if name := os.Getenv("NEWAPI_COMPOSITE_WRITER"); name != "" {
		common.IsMasterNode = false
		common.SQLitePath = os.Getenv("NEWAPI_COMPOSITE_SQLITE")
		common.OptionMap = map[string]string{}
		require.NoError(t, model.InitDB())
		db, err := model.DB.DB()
		require.NoError(t, err)
		defer db.Close()
		_, err = model.UpdateComposite(name, model.CompositeChange{ExpectedVersion: os.Getenv("NEWAPI_COMPOSITE_VERSION"), Definition: composite_setting.Definition{Enabled: true, Members: []string{"GPT"}}, Ratio: common.GetPointer(0.9)}, false)
		if errors.Is(err, model.ErrCompositeConflict) {
			fmt.Println("COMPOSITE_RESULT=conflict")
			return
		}
		require.NoError(t, err)
		fmt.Println("COMPOSITE_RESULT=saved")
		return
	}
	newCompositeFixture(t)
	cfg, err := model.ReadCompositeConfig(model.DB)
	require.NoError(t, err)
	var wg sync.WaitGroup
	results := make(chan string, 2)
	for _, name := range []string{"AGENTONE", "OTHER"} {
		wg.Go(func() {
			cmd := exec.Command(os.Args[0], "-test.run=^TestCompositeConcurrentProcesses$", "-test.v")
			cmd.Env = append(os.Environ(), "NEWAPI_COMPOSITE_WRITER="+name, "NEWAPI_COMPOSITE_SQLITE="+common.SQLitePath, "NEWAPI_COMPOSITE_VERSION="+cfg.Version)
			output, err := cmd.CombinedOutput()
			if !assert.NoError(t, err, string(output)) {
				results <- "error"
				return
			}
			if strings.Contains(string(output), "COMPOSITE_RESULT=saved") {
				results <- "saved"
			} else if strings.Contains(string(output), "COMPOSITE_RESULT=conflict") {
				results <- "conflict"
			} else {
				results <- string(output)
			}
		})
	}
	wg.Wait()
	assert.ElementsMatch(t, []string{"saved", "conflict"}, []string{<-results, <-results})
}

func TestCompositeExpressionProtocolsAndNativeSpecialRatio(t *testing.T) {
	engine, user, token := newCompositeFixture(t)
	withTieredBillingConfig(t, map[string]string{"gpt-5.6": "tiered_expr", "gpt-image-2": "tiered_expr"}, map[string]string{
		"gpt-5.6":     `len <= 272000 ? tier("0_272k", p * 4 + cr * 0.4 + cc * 5 + c * 20) : tier("272k_plus", p * 8 + cr * 0.8 + cc * 10 + c * 30)`,
		"gpt-image-2": `tier("standard", p * 5 + cr * 1.25 + c * 30)`,
	})
	for _, tc := range []struct {
		name, path, body string
		want             int
	}{
		{"chat HTTP", "/v1/chat/completions", `{"model":"gpt-5.6","messages":[{"role":"user","content":"hi"}]}`, 13},
		{"chat SSE", "/v1/chat/completions", `{"model":"gpt-5.6","stream":true,"messages":[{"role":"user","content":"hi"}]}`, 13},
		{"responses HTTP", "/v1/responses", `{"model":"gpt-5.6","input":"hi"}`, 13},
		{"responses SSE", "/v1/responses", `{"model":"gpt-5.6","input":"hi","stream":true}`, 13},
		{"image generation", "/v1/images/generations", `{"model":"gpt-image-2","prompt":"test","n":1}`, 2200},
		{"image edit", "/v1/images/edits", `{"model":"gpt-image-2","prompt":"test","images":[{"image_url":"https://example.invalid/test.png"}]}`, 2200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := compositeRequest(engine, token, http.MethodPost, tc.path, tc.body)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var log model.Log
			require.NoError(t, model.LOG_DB.Where("user_id = ?", user.Id).Order("id DESC").First(&log).Error)
			assert.Equal(t, tc.want, log.Quota)
			assert.Contains(t, log.Other, `"billing_mode":"tiered_expr"`)
		})
	}
	oldSpecial := ratio_setting.GroupGroupRatio2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(oldSpecial)) })
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"default":{"GPT":0.1,"PPTONE":0.01}}`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","GPT":"GPT","PPTONE":"PPT"}`))
	require.NoError(t, model.DB.Model(token).Update("group", "GPT").Error)
	response := compositeRequest(engine, token, http.MethodPost, "/v1/chat/completions", `{"model":"gpt-5.6","messages":[{"role":"user","content":"hi"}]}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var log model.Log
	require.NoError(t, model.LOG_DB.Where("user_id = ?", user.Id).Order("id DESC").First(&log).Error)
	assert.Equal(t, 4, log.Quota)
	assert.NotContains(t, log.Other, `"composite"`)
}

func TestCompositeRetriesReserveBeforeSendingAndRefund(t *testing.T) {
	for _, tc := range []struct {
		cross   bool
		balance int
	}{{false, 1_000_000}, {true, 1_000_000}, {true, 2000}} {
		t.Run(fmt.Sprintf("cross=%t/balance=%d", tc.cross, tc.balance), func(t *testing.T) {
			engine, user, token := newCompositeFixture(t)
			require.NoError(t, model.DB.Model(user).Update("quota", tc.balance).Error)
			require.NoError(t, model.DB.Model(token).Update("remain_quota", tc.balance).Error)
			oldRetries := common.RetryTimes
			common.RetryTimes = 1
			t.Cleanup(func() { common.RetryTimes = oldRetries })
			var first, second model.Channel
			require.NoError(t, model.DB.Where("name = ?", "GPT").First(&first).Error)
			require.NoError(t, model.DB.Where("name = ?", "IMAGE").First(&second).Error)
			require.NoError(t, model.DB.Model(&first).Updates(map[string]any{"base_url": *first.BaseURL + "/fail", "auto_ban": 0}).Error)
			observed := make(chan int, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var reserved model.User
				if err := model.DB.First(&reserved, user.Id).Error; err != nil {
					observed <- -1
				} else {
					observed <- reserved.Quota
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"chat-retry","choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}`))
			}))
			t.Cleanup(server.Close)
			require.NoError(t, model.DB.Model(&second).Updates(map[string]any{"base_url": server.URL, "models": "gpt-image-2,gpt-5.6"}).Error)
			require.NoError(t, model.DB.Create(&model.Ability{Group: "IMAGE", Model: "gpt-5.6", ChannelId: second.Id, Enabled: true}).Error)
			cfg, err := model.ReadCompositeConfig(model.DB)
			require.NoError(t, err)
			_, err = model.UpdateComposite("PPTONE", model.CompositeChange{ExpectedVersion: cfg.Version, Definition: composite_setting.Definition{Enabled: true, Members: []string{"GPT", "IMAGE"}, CrossGroupRetry: tc.cross}, Ratio: common.GetPointer(0.8)}, false)
			require.NoError(t, err)
			response := compositeRequest(engine, token, http.MethodPost, "/v1/chat/completions", `{"model":"gpt-5.6","messages":[{"role":"user","content":"hi"}]}`)
			if tc.cross && tc.balance >= 3200 {
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				select {
				case quota := <-observed:
					assert.Equal(t, 1_000_000-3200, quota, "the more expensive member is reserved before upstream submission")
				default:
					t.Fatal("second member was not called")
				}
			} else {
				assert.GreaterOrEqual(t, response.Code, 400)
				assert.Empty(t, observed)
				require.Eventually(t, func() bool {
					var u model.User
					var key model.Token
					return model.DB.First(&u, user.Id).Error == nil && model.DB.First(&key, token.Id).Error == nil && u.Quota == tc.balance && key.RemainQuota == tc.balance
				}, time.Second, 10*time.Millisecond, "native asynchronous refund must restore both balances")
			}
		})
	}
}

func TestCompositeRealtimeIncrementalQuotaUsesSnapshot(t *testing.T) {
	_, user, token := newCompositeFixture(t)
	oldRatios := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-5.6":1}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(oldRatios)) })
	engine := gin.New()
	engine.GET("/v1/realtime", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) {
		info, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIRealtime, nil, nil)
		require.NoError(t, err)
		info.PriceData.GroupRatioInfo, err = helper.ResolveRequestGroupRatio(c, info)
		require.NoError(t, err)
		// A running connection keeps the composite price captured at submission.
		require.NoError(t, model.UpdateOption("GroupRatio", `{"default":1,"GPT":2,"IMAGE":3,"PPTONE":4}`))
		usage := &dto.RealtimeUsage{InputTokens: 1000}
		usage.InputTokenDetails.TextTokens = 1000
		require.NoError(t, service.PreWssConsumeQuota(c, info, usage))
		c.Status(http.StatusOK)
	})
	request := httptest.NewRequest(http.MethodGet, "/v1/realtime?model=gpt-5.6", nil)
	request.Header.Set("Authorization", "Bearer sk-"+token.Key)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.NoError(t, model.DB.First(user, user.Id).Error)
	require.NoError(t, model.DB.First(token, token.Id).Error)
	assert.Equal(t, 1_000_000-320, user.Quota)
	assert.Equal(t, 1_000_000-320, token.RemainQuota)
}

func TestCompositeWebSocketRetryAndReuse(t *testing.T) {
	_, user, token := newCompositeFixture(t)
	oldRetries := common.RetryTimes
	common.RetryTimes = 1
	t.Cleanup(func() { common.RetryTimes = oldRetries })
	cfg, err := model.ReadCompositeConfig(model.DB)
	require.NoError(t, err)
	_, err = model.UpdateComposite("PPTONE", model.CompositeChange{ExpectedVersion: cfg.Version, Definition: composite_setting.Definition{Enabled: true, Members: []string{"GPT", "IMAGE"}, CrossGroupRetry: true}, Ratio: common.GetPointer(0.8)}, false)
	require.NoError(t, err)
	reserved := make(chan int, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/fail") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":{"message":"retry","type":"server_error"}}`))
			return
		}
		var current model.User
		if err := model.DB.First(&current, user.Id).Error; err != nil {
			reserved <- -1
		} else {
			reserved <- current.Quota
		}
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if !assert.NoError(t, err) {
			return
		}
		defer ws.Close()
		for turn := 0; ; turn++ {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
			if err := ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"type":"response.completed","response":{"id":"resp_composite_%d","status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}`, turn))); err != nil {
				return
			}
		}
	}))
	t.Cleanup(upstream.Close)
	for _, member := range []string{"GPT", "IMAGE"} {
		var channel model.Channel
		require.NoError(t, model.DB.Where("name = ?", member).First(&channel).Error)
		baseURL := upstream.URL
		if member == "GPT" {
			baseURL += "/fail"
		}
		channel.SetSetting(dto.ChannelSettings{ResponsesWebSocketEnabled: true})
		require.NoError(t, model.DB.Model(&channel).Updates(map[string]any{"base_url": baseURL, "models": "gpt-5.6", "setting": channel.Setting, "auto_ban": 0}).Error)
		if member == "IMAGE" {
			require.NoError(t, model.DB.Create(&model.Ability{Group: member, Model: "gpt-5.6", ChannelId: channel.Id, Enabled: true}).Error)
		}
	}
	engine := gin.New()
	done := make(chan struct{})
	engine.GET("/v1/responses", middleware.TokenAuth(), func(c *gin.Context) {
		defer close(done)
		ResponsesWebSocket(c)
	})
	gateway := httptest.NewServer(engine)
	t.Cleanup(gateway.Close)
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(gateway.URL, "http")+"/v1/responses", http.Header{"Authorization": []string{"Bearer sk-" + token.Key}})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })
	require.NoError(t, client.SetReadDeadline(time.Now().Add(5*time.Second)))
	for range 2 {
		require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"gpt-5.6","input":"hi"}`)))
		assert.Equal(t, "response.completed", readResponsesWSTestEvent(t, client)["type"])
	}
	assert.Equal(t, 1_000_000-3200, <-reserved)
	require.NoError(t, client.Close())
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("websocket handler did not finish")
	}
	require.NoError(t, model.DB.First(user, user.Id).Error)
	require.NoError(t, model.DB.First(token, token.Id).Error)
	assert.Equal(t, 1_000_000-6400, user.Quota)
	assert.Equal(t, 1_000_000-6400, token.RemainQuota)
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("user_id = ? AND type = ?", user.Id, model.LogTypeConsume).Find(&logs).Error)
	require.Len(t, logs, 2)
	for _, entry := range logs {
		assert.Equal(t, 3200, entry.Quota)
		assert.Contains(t, entry.Other, `"final_ratio":0.64`)
	}
}

func compositeRequest(engine *gin.Engine, token *model.Token, method, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer sk-"+token.Key)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	return recorder
}

func TestCompositeVerticalPrototype(t *testing.T) {
	engine, user, token := newCompositeFixture(t)
	db := model.DB
	for _, tc := range []struct {
		path, body, group string
		want              int
	}{
		{"/v1/chat/completions", `{"model":"gpt-5.6","messages":[{"role":"user","content":"hi"}]}`, "GPT", 1600},
		{"/v1/images/generations", `{"model":"gpt-image-2","prompt":"test","n":1}`, "IMAGE", 3200},
	} {
		t.Run(tc.group, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			request.Header.Set("Authorization", "Bearer sk-"+token.Key)
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
			var log model.Log
			require.NoError(t, model.LOG_DB.Order("id DESC").First(&log).Error)
			assert.Equal(t, tc.want, log.Quota)
			assert.Equal(t, tc.group, log.Group)
			assert.Contains(t, log.Other, `"name":"PPTONE"`)
		})
	}
	var stored model.Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	assert.Equal(t, "PPTONE", stored.Group)
	assert.Equal(t, 1_000_000-4800, stored.RemainQuota)
	var storedUser model.User
	require.NoError(t, db.First(&storedUser, user.Id).Error)
	assert.Equal(t, stored.RemainQuota, storedUser.Quota)
}
