package plugins_test

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	relaychannel "github.com/QuantumNous/new-api/relay/channel"
	taskplugin "github.com/QuantumNous/new-api/relay/channel/task/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func wan3Plugins(t *testing.T, registry *jsplugin.Registry) []*jsplugin.LoadedPlugin {
	t.Helper()
	var plugins []*jsplugin.LoadedPlugin
	for _, key := range []string{"alibaba", "rolldek", "zhimeng"} {
		var source string
		var err error
		if key == "alibaba" {
			source, err = builtinplugins.Source(key)
		} else {
			var data []byte
			data, err = os.ReadFile("../" + key + "/plugin.js")
			source = string(data)
		}
		require.NoError(t, err)
		plugin, err := registry.RegisterFactory(source, jsplugin.Options{Key: key})
		require.NoError(t, err)
		plugins = append(plugins, plugin)
	}
	return plugins
}

func wan3Decode(t *testing.T, plugin *jsplugin.LoadedPlugin, model string, body map[string]any) (map[string]any, error) {
	t.Helper()
	value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
		"model": model, "body": map[string]any{"kind": "json", "value": body},
	})
	if err != nil {
		return nil, err
	}
	return rolldekMap(t, value)["requestBody"].(map[string]any), nil
}

func TestWAN3SharedRequests(t *testing.T) {
	plugins := wan3Plugins(t, jsplugin.NewRegistry())
	const prompt = "  a cat by the window  \n"
	for _, plugin := range plugins {
		if plugin.Meta.Key == "alibaba" {
			continue
		}
		_, err := wan3Decode(t, plugin, "wan3.0-video", map[string]any{"prompt": " \n\t"})
		require.Error(t, err, "%s must reject a whitespace-only WAN3 prompt", plugin.Meta.Key)
		for _, body := range []map[string]any{{}, {"prompt": ""}, {"prompt": " \n\t"}} {
			body["metadata"] = map[string]any{"input": map[string]any{"media": []any{
				map[string]any{"type": "first_frame", "url": "https://example.com/frame.png"},
			}}}
			_, err := wan3Decode(t, plugin, "wan3.0-video", body)
			require.Error(t, err, "%s requires a nonblank prompt with media", plugin.Meta.Key)
		}
		for _, model := range []string{"wan3.0-video", "wan3.0-video-prime"} {
			for _, resolution := range []string{"480P", "720P", "1080P"} {
				t.Run(plugin.Meta.Key+"/"+model+"/"+resolution, func(t *testing.T) {
					req, err := wan3Decode(t, plugin, model, map[string]any{"model": model, "prompt": prompt, "duration": 2, "resolution": resolution, "ratio": "9:16"})
					require.NoError(t, err)
					assert.Equal(t, prompt, req["prompt"])
					ctx := map[string]any{"model": model, "upstreamModel": model, "baseUrl": "https://provider.example", "apiKey": "test-key", "requestBody": req}
					value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
					require.NoError(t, err)
					descriptor := rolldekMap(t, value)
					assert.NotContains(t, descriptor, "rewriteModel")
					assert.NotContains(t, descriptor, "model")
					body := descriptor["body"].(map[string]any)
					switch plugin.Meta.Key {
					case "rolldek":
						assert.Equal(t, prompt, body["prompt"])
						assert.Equal(t, model+"-"+strings.ToLower(resolution), body["model"])
						assert.Equal(t, resolution, body["size"])
						assert.Equal(t, "2", body["seconds"])
						assert.Equal(t, "9:16", body["aspect_ratio"])
					case "zhimeng":
						assert.Equal(t, prompt, body["prompt"])
						assert.Equal(t, model, body["model"])
						assert.Equal(t, float64(2), body["duration"])
						assert.Equal(t, "9:16", body["aspect_ratio"])
					}
					value, err = plugin.Engine.Call(t.Context(), "extractUsage", ctx)
					require.NoError(t, err)
					assert.Equal(t, map[string]any{"seconds": float64(2), "resolution": resolution}, rolldekMap(t, value))
					schema, _ := plugin.Meta.UsageForModel(model)
					assert.Len(t, schema, 2)
					assert.Equal(t, "second", schema["seconds"].Unit)
					assert.Equal(t, []string{"480P", "720P", "1080P"}, schema["resolution"].Enum)
				})
			}
		}
		for _, tc := range []struct {
			name              string
			body              map[string]any
			duration          float64
			resolution, ratio string
		}{
			{"defaults", map[string]any{"prompt": "cat"}, 5, "1080P", "adaptive"},
			{"pixel size", map[string]any{"prompt": "cat", "size": "1280x720", "seconds": "2"}, 2, "720P", "16:9"},
			{"equivalent size tiers", map[string]any{"prompt": "cat", "size": "720", "metadata": map[string]any{"parameters": map[string]any{"size": "720P"}}}, 5, "720P", "adaptive"},
			{"equivalent pixel sizes", map[string]any{"prompt": "cat", "size": "1280x720", "metadata": map[string]any{"parameters": map[string]any{"size": "1280*720"}}}, 5, "720P", "16:9"},
			{"pixel size plus tier", map[string]any{"prompt": "cat", "size": "1280x720", "metadata": map[string]any{"parameters": map[string]any{"size": "720p"}}}, 5, "720P", "16:9"},
			{"tier plus pixel size", map[string]any{"prompt": "cat", "size": "720", "metadata": map[string]any{"parameters": map[string]any{"size": "1280x720"}}}, 5, "720P", "16:9"},
			{"aliases agree", map[string]any{"prompt": "cat", "duration": 2, "seconds": "2", "resolution": "720p", "ratio": "auto", "aspect_ratio": "adaptive", "metadata": map[string]any{"input": map[string]any{"prompt": "cat"}, "parameters": map[string]any{"duration": "2", "resolution": "720P", "ratio": "adaptive"}}}, 2, "720P", "adaptive"},
		} {
			t.Run(plugin.Meta.Key+"/"+tc.name, func(t *testing.T) {
				req, err := wan3Decode(t, plugin, "wan3.0-video", tc.body)
				require.NoError(t, err)
				assert.Equal(t, tc.duration, req["duration"])
				assert.Equal(t, tc.resolution, req["resolution"])
				assert.Equal(t, tc.ratio, req["ratio"])
				// Final channel decoding runs again; normalization must be stable.
				again, err := wan3Decode(t, plugin, "wan3.0-video", req)
				require.NoError(t, err)
				assert.Equal(t, req, again)
			})
		}
	}
}

func TestWAN3RejectsConflictsBeforeSubmission(t *testing.T) {
	plugins := wan3Plugins(t, jsplugin.NewRegistry())
	for _, body := range []map[string]any{
		{"duration": 31}, {"duration": 0}, {"duration": " "}, {"duration": nil}, {"duration": 2.5}, {"duration": 1e30},
		{"duration": 2, "seconds": 3},
		{"duration": 2, "metadata": map[string]any{"parameters": map[string]any{"duration": 7}}},
		{"resolution": "480P", "metadata": map[string]any{"parameters": map[string]any{"resolution": "720P"}}},
		{"ratio": "16:9", "aspect_ratio": "9:16"}, {"size": "1280x720", "ratio": "9:16"}, {"size": "1280x720", "resolution": "480P"},
		{"size": "720", "metadata": map[string]any{"parameters": map[string]any{"size": "1080P"}}},
		{"size": "1280x720", "metadata": map[string]any{"parameters": map[string]any{"size": "720x1280"}}},
		{"size": "1280x720", "metadata": map[string]any{"parameters": map[string]any{"size": "720P", "ratio": "9:16"}}},
		{"size": "1280x720", "metadata": map[string]any{"parameters": map[string]any{"size": "720P", "resolution": "480P"}}},
		{"resolution": "4K"}, {"size": "1000x1000"}, {"size": nil}, {"ratio": ""}, {"audio": "false"}, {"audio": nil}, {"seed": 1e30},
		{"metadata": map[string]any{"input": map[string]any{"prompt": "different"}}},
		{"audio": false, "metadata": map[string]any{"parameters": map[string]any{"audio": true}}},
		{"metadata": map[string]any{"parameters": map[string]any{"n": 2}}}, {"metadata": map[string]any{"input": map[string]any{"image": "https://example.com/a.png"}}},
		{"generate_audio": false}, {"reference_voice": "https://example.com/a.wav"}, {"input": map[string]any{"media": []any{}}},
		{"media": []any{}, "metadata": map[string]any{"input": map[string]any{"media": []any{}}}},
		{"media": []any{map[string]any{"type": "last_frame", "url": "https://example.com/a.png"}}},
		{"media": []any{map[string]any{"type": "first_frame", "url": "https://example.com/a.png"}, map[string]any{"type": "reference_audio", "url": "https://example.com/a.wav"}}},
		{"media": []any{map[string]any{"type": "first_frame", "url": "http://example.com/a.png"}}},
		{"media": []any{map[string]any{"type": "first_frame", "url": "data:image/png;base64,AA=="}}},
		{"metadata": nil}, {"metadata": map[string]any{"parameters": nil}}, {"metadata": map[string]any{"input": []any{}}},
	} {
		for _, plugin := range plugins {
			if plugin.Meta.Key == "alibaba" {
				continue
			}
			req := maps.Clone(body)
			if _, exists := req["prompt"]; !exists {
				req["prompt"] = "cat"
			}
			_, err := wan3Decode(t, plugin, "wan3.0-video", req)
			assert.Error(t, err, "%s accepted %+v", plugin.Meta.Key, body)
		}
	}
}

func TestWAN3ChannelCapabilities(t *testing.T) {
	plugins := wan3Plugins(t, jsplugin.DefaultRegistry)
	for _, plugin := range plugins {
		t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister(plugin.Meta.Key)) })
	}
	for _, tc := range []struct {
		body string
		keys []string
	}{
		{`{"prompt":"cat","duration":2,"resolution":"480P","ratio":"16:9"}`, []string{"alibaba", "rolldek", "zhimeng"}},
		{`{"prompt":"cat","size":"720","metadata":{"parameters":{"size":"720P"}}}`, []string{"alibaba", "rolldek", "zhimeng"}},
		{`{"prompt":"cat","metadata":{"parameters":{"audio":false,"seed":0,"prompt_extend":false,"watermark":false}}}`, []string{"alibaba", "zhimeng"}},
		{`{"prompt":"cat","ratio":"4:3"}`, []string{"alibaba", "zhimeng"}},
		{`{"prompt":"cat","duration":-1}`, []string{"alibaba"}},
		{`{"metadata":{"input":{"media":[{"type":"first_frame","url":"https://example.com/a.png"}]}}}`, []string{"alibaba"}},
		{`{"prompt":"cat","metadata":{"input":{"media":[{"type":"first_frame","url":"https://example.com/a.png"}]}}}`, []string{"alibaba", "rolldek", "zhimeng"}},
		{`{"prompt":"cat","metadata":{"input":{"media":[{"type":"last_frame","url":"https://example.com/b.png"},{"type":"first_frame","url":"https://example.com/a.png"}]}}}`, []string{"alibaba", "rolldek", "zhimeng"}},
		{`{"prompt":"cat","metadata":{"input":{"media":[{"type":"reference_image","url":"https://example.com/a.png"}]}}}`, []string{"alibaba", "rolldek", "zhimeng"}},
		{`{"prompt":"cat","metadata":{"input":{"media":[{"type":"reference_audio","url":"https://example.com/a.wav"}]}}}`, []string{"alibaba", "rolldek", "zhimeng"}},
		{`{"prompt":"图2的人物参考音频1","metadata":{"input":{"media":[{"type":"reference_image","url":"https://example.com/a.png"},{"type":"reference_audio","url":"https://example.com/a.wav"},{"type":"reference_image","url":"https://example.com/b.png"}]},"parameters":{"audio":false}}}`, []string{"alibaba", "zhimeng"}},
		{`{"prompt":"cat","metadata":{"input":{"media":[{"type":"reference_video","url":"https://example.com/a.mp4"}]}}}`, []string{"alibaba", "rolldek", "zhimeng"}},
		{`{"prompt":"cat","duration":31}`, []string{"alibaba"}},
	} {
		router := gin.New()
		var keys []string
		router.POST("/v1/videos", middleware.PinTaskPluginEndpoint(), middleware.PrepareTaskPluginEndpoint(), func(c *gin.Context) {
			pinned := c.MustGet(jsplugin.ContextKeyPinnedEndpoint).(jsplugin.PinnedEndpoint)
			for _, candidate := range pinned.Candidates {
				keys = append(keys, candidate.Plugin.Meta.Key)
			}
			c.Status(http.StatusNoContent)
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"model":"wan3.0-video",`+strings.TrimPrefix(tc.body, "{")))
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		assert.Equal(t, tc.keys, keys, tc.body+response.Body.String())
		if tc.keys == nil {
			assert.Equal(t, http.StatusBadRequest, response.Code)
		} else {
			assert.Equal(t, http.StatusNoContent, response.Code, response.Body.String())
		}
	}
	for _, plugin := range plugins {
		if plugin.Meta.Key == "alibaba" {
			req, err := wan3Decode(t, plugin, "wan3.0-video", map[string]any{"prompt": "cat", "duration": 31})
			require.NoError(t, err)
			_, err = plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{"model": "wan3.0-video", "requestBody": req, "baseUrl": "https://provider.example", "apiKey": "k"})
			require.Error(t, err)
		}
		if plugin.Meta.Key == "rolldek" {
			continue
		}
		req, err := wan3Decode(t, plugin, "wan3.0-video", map[string]any{"prompt": "cat", "metadata": map[string]any{"parameters": map[string]any{"audio": false, "seed": 0, "prompt_extend": false, "watermark": false}}})
		require.NoError(t, err)
		value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{"model": "wan3.0-video", "requestBody": req, "baseUrl": "https://provider.example", "apiKey": "k"})
		require.NoError(t, err)
		body := rolldekMap(t, value)["body"].(map[string]any)
		params := body["parameters"]
		if plugin.Meta.Key == "zhimeng" {
			params = body["metadata"].(map[string]any)["parameters"]
		}
		for key, expected := range map[string]any{"audio": false, "seed": float64(0), "prompt_extend": false, "watermark": false} {
			assert.Equal(t, expected, params.(map[string]any)[key])
		}
	}
}

func TestWAN3RollDekMediaOrderAndIdentity(t *testing.T) {
	plugin := wan3Plugins(t, jsplugin.NewRegistry())[1]
	media := []any{map[string]any{"type": "reference_image", "url": "https://example.com/a.png"}, map[string]any{"type": "reference_video", "url": "https://example.com/v.mp4"}, map[string]any{"type": "reference_audio", "url": "https://example.com/a.wav"}, map[string]any{"type": "reference_image", "url": "https://example.com/b.png"}, map[string]any{"type": "reference_video", "url": "https://example.com/v.mp4"}}
	req, err := wan3Decode(t, plugin, "wan3.0-video", map[string]any{"prompt": "图2参考视频1和音频1", "duration": 2, "resolution": "480P", "metadata": map[string]any{"input": map[string]any{"media": media}}})
	require.NoError(t, err)
	ctx := map[string]any{"model": "wan3.0-video", "requestBody": req, "baseUrl": "https://provider.example", "apiKey": "k"}
	value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
	require.NoError(t, err)
	body := rolldekMap(t, value)["body"].(map[string]any)
	assert.Equal(t, media, body["input"].(map[string]any)["media"])
	assert.Equal(t, "图2参考视频1和音频1", body["prompt"])
	value, err = plugin.Engine.Call(t.Context(), "extractUsage", ctx)
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"seconds": float64(32), "resolution": "480P"}, rolldekMap(t, value))
	value, err = plugin.Engine.Call(t.Context(), "parseSubmitResponse", ctx, map[string]any{"body": map[string]any{"id": "vendor-job"}})
	require.NoError(t, err)
	state := rolldekMap(t, value)["state"].(map[string]any)
	assert.Equal(t, "wan3.0-video-480p", state["upstreamModel"])
	assert.Equal(t, true, state["hasReferenceVideo"])
	ctx["upstreamModel"] = "wan3.0-video-720p"
	_, err = plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
	require.ErrorContains(t, err, "must not be mapped")

}

func TestWAN3CompletionAndDownloads(t *testing.T) {
	for _, plugin := range wan3Plugins(t, jsplugin.NewRegistry())[1:] {
		t.Run(plugin.Meta.Key, func(t *testing.T) {
			req, err := wan3Decode(t, plugin, "wan3.0-video", map[string]any{"prompt": "cat", "duration": 5, "resolution": "720P", "ratio": "16:9"})
			require.NoError(t, err)
			value, err := plugin.Engine.Call(t.Context(), "parseSubmitResponse", map[string]any{"model": "wan3.0-video", "requestBody": req}, map[string]any{"body": map[string]any{"id": "vendor-job", "status": "queued"}})
			require.NoError(t, err)
			state := rolldekMap(t, value)["state"]
			encodedState, err := common.Marshal(state)
			require.NoError(t, err)
			task := &model.Task{TaskID: "public-job", Status: model.TaskStatusSuccess, Properties: model.Properties{OriginModelName: "wan3.0-video", UpstreamModelName: "wan3.0-video"}, PrivateData: model.TaskPrivateData{UpstreamTaskID: "vendor-job", PluginState: encodedState}}
			adaptor := taskplugin.New(plugin)
			adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: "https://provider.example", ApiKey: "test-key", ChannelType: constant.ChannelTypeTaskPlugin}})
			for _, tc := range []struct {
				name, body, status string
				seconds            float64
			}{
				{"measured", `{"status":"completed","seconds":2,"size":"16:9","usage":{"output_video_duration":2,"input_video_duration":0}}`, "SUCCESS", 2},
				{"missing", `{"status":"completed"}`, "SUCCESS", 5},
				{"null", `{"status":"completed","seconds":null,"usage":{"output_video_duration":null,"input_video_duration":0}}`, "SUCCESS", 5},
				{"string", `{"status":"completed","seconds":"2","usage":{"output_video_duration":"2","input_video_duration":0}}`, "SUCCESS", 5},
				{"oversized", `{"status":"completed","seconds":3601,"usage":{"output_video_duration":3601,"input_video_duration":0}}`, "SUCCESS", 5},
				{"negative", `{"status":"completed","seconds":-1,"usage":{"output_video_duration":-1,"input_video_duration":0}}`, "SUCCESS", 5},
				{"failed", `{"status":"failed","seconds":2,"error":{"message":"rejected"}}`, "FAILURE", 5},
				{"unknown", `{"status":"new_status","progress":100,"seconds":2}`, "UNKNOWN", 5},
			} {
				t.Run(tc.name, func(t *testing.T) {
					result, err := adaptor.ParseTaskResult(task, &http.Response{StatusCode: http.StatusOK, Header: make(http.Header)}, []byte(tc.body))
					require.NoError(t, err)
					assert.Equal(t, tc.status, result.Status)
					snap := &billingexpr.BillingSnapshot{TaskUsageBilling: true, ExprString: `u("resolution") == "720P" ? tier("720P", u("seconds") * 0.2) : tier("other", u("seconds") * 0.1)`, ExprVersion: 1, QuotaPerUnit: common.QuotaPerUnit, GroupRatio: 1.5, UsageFacts: map[string]any{"seconds": float64(5), "resolution": "720P"}}
					settled, facts, err := service.EvaluateTaskCompletionUsage(snap, result.UsageFacts)
					require.NoError(t, err)
					assert.Equal(t, tc.seconds, facts["seconds"])
					assert.Equal(t, "720P", facts["resolution"])
					assert.Equal(t, common.QuotaRound(tc.seconds*0.2*1.5*common.QuotaPerUnit), settled.ActualQuotaAfterGroup)
					assert.Equal(t, float64(5), snap.UsageFacts["seconds"])
				})
			}
			for _, method := range []string{http.MethodHead, http.MethodGet} {
				descriptor, err := adaptor.BuildContentRequest(t.Context(), task, "video", relaychannel.TaskArtifactClientRequest{Method: method, Headers: map[string]string{"Range": "bytes=0-1023"}})
				require.NoError(t, err)
				assert.Equal(t, "https://provider.example/v1/videos/vendor-job/content", descriptor.URL)
				assert.Equal(t, method, descriptor.Method)
				assert.Equal(t, "Bearer test-key", descriptor.Headers["Authorization"])
				assert.NotContains(t, descriptor.URL, "test-key")
			}
		})
	}
}

func TestZhimengTaskContract(t *testing.T) {
	plugin := wan3Plugins(t, jsplugin.NewRegistry())[2]
	for _, tc := range []struct {
		body                map[string]any
		status, url, reason string
	}{
		{map[string]any{"status": "completed", "content": map[string]any{"url": "https://cdn.example/primary.mp4"}, "video_url": "https://cdn.example/secondary.mp4"}, "SUCCESS", "https://cdn.example/primary.mp4", ""},
		{map[string]any{"status": "completed", "output": []any{"https://cdn.example/output.mp4"}}, "SUCCESS", "https://cdn.example/output.mp4", ""},
		{map[string]any{"status": "in_progress", "progress": 100, "url": "https://cdn.example/early.mp4"}, "IN_PROGRESS", "", ""},
		{map[string]any{"status": "failed", "code": "rejected", "message": "invalid material"}, "FAILURE", "", "invalid material"},
		{map[string]any{"status": "failed", "error": map[string]any{"message": "upstream failed"}}, "FAILURE", "", "upstream failed"},
		{map[string]any{"status": "completed", "code": "rejected", "message": "conflicting result"}, "UNKNOWN", "", "conflicting result"},
	} {
		value, err := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{}, tc.body)
		require.NoError(t, err)
		result := rolldekMap(t, value)
		assert.Equal(t, tc.status, result["status"])
		if tc.url == "" {
			assert.NotContains(t, result, "url")
		} else {
			assert.Equal(t, tc.url, result["url"])
		}
		if tc.reason != "" {
			assert.Equal(t, tc.reason, result["reason"])
		}
	}
	value, err := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{"model": "sd-2-c4"}, map[string]any{"status": "completed"})
	require.NoError(t, err)
	result := rolldekMap(t, value)
	assert.Equal(t, "UNKNOWN", result["status"])
	assert.Equal(t, "Seedance video URL is unavailable", result["reason"])
	for _, state := range []any{nil, map[string]any{"hasReferenceVideo": true}, map[string]any{"duration": 5, "resolution": "720P"}} {
		_, err := plugin.Engine.Call(t.Context(), "extractUsageOnComplete", map[string]any{"state": state}, map[string]any{"status": "SUCCESS"}, map[string]any{"seconds": 2})
		require.ErrorContains(t, err, "retaining reserved usage")
	}
	value, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", map[string]any{"state": map[string]any{"duration": 5, "resolution": "720P", "hasReferenceVideo": false}}, map[string]any{"status": "SUCCESS"}, map[string]any{"seconds": 2})
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"seconds": float64(2)}, rolldekMap(t, value))
	for _, body := range []map[string]any{{"code": "invalid_request", "message": "bad request"}, {"error": map[string]any{"message": "bad request"}}} {
		_, err := plugin.Engine.Call(t.Context(), "parseSubmitResponse", map[string]any{}, map[string]any{"body": body})
		require.ErrorContains(t, err, "bad request")
	}
}

func TestZhimengWAN3Media(t *testing.T) {
	plugin := wan3Plugins(t, jsplugin.NewRegistry())[2]
	first := map[string]any{"type": "first_frame", "url": "https://example.com/first.png"}
	last := map[string]any{"type": "last_frame", "url": "https://example.com/last.png"}
	imageFirst := map[string]any{"type": "reference_image", "url": "https://example.com/a.png"}
	imageSecond := map[string]any{"type": "reference_image", "url": "https://example.com/b.png"}
	audioFirst := map[string]any{"type": "reference_audio", "url": "https://example.com/a.wav"}
	audioSecond := map[string]any{"type": "reference_audio", "url": "https://example.com/b.wav"}
	var maximum []any
	for range 5 {
		maximum = append(maximum, imageFirst, audioFirst, imageSecond)
	}
	for _, modelName := range []string{"wan3.0-video", "wan3.0-video-prime"} {
		for _, media := range [][]any{{first}, {first, last}, {last, first}, {imageFirst, imageSecond}, {audioFirst, audioSecond}, {imageFirst, audioSecond, imageSecond, audioFirst, imageFirst}, maximum} {
			body := map[string]any{"prompt": "图2的人物参考音频1和 @2，保持原提示词及素材顺序", "duration": 2, "resolution": "480P",
				"metadata": map[string]any{"input": map[string]any{"media": media}, "parameters": map[string]any{"audio": false, "seed": 0}}}
			original, err := common.Marshal(body)
			require.NoError(t, err)
			req, err := wan3Decode(t, plugin, modelName, body)
			require.NoError(t, err)
			repeated, err := wan3Decode(t, plugin, modelName, req)
			require.NoError(t, err)
			assert.Equal(t, req, repeated)
			unchanged, err := common.Marshal(body)
			require.NoError(t, err)
			assert.Equal(t, string(original), string(unchanged))
			ctx := map[string]any{"model": modelName, "requestBody": req, "baseUrl": "https://provider.example", "apiKey": "test-key"}
			value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
			require.NoError(t, err)
			upstream := rolldekMap(t, value)["body"].(map[string]any)
			assert.Equal(t, body["prompt"], upstream["prompt"])
			assert.Equal(t, media, upstream["metadata"].(map[string]any)["input"].(map[string]any)["media"])
			assert.Equal(t, map[string]any{"audio": false, "seed": float64(0)}, upstream["metadata"].(map[string]any)["parameters"])
			value, err = plugin.Engine.Call(t.Context(), "extractUsage", ctx)
			require.NoError(t, err)
			assert.Equal(t, map[string]any{"seconds": float64(2), "resolution": "480P"}, rolldekMap(t, value))
			value, err = plugin.Engine.Call(t.Context(), "parseSubmitResponse", ctx, map[string]any{"body": map[string]any{"id": "vendor-job"}})
			require.NoError(t, err)
			assert.Equal(t, map[string]any{"model": modelName, "duration": float64(2), "resolution": "480P", "hasReferenceVideo": false}, rolldekMap(t, value)["state"])
		}
	}
	for _, media := range [][]any{{last}, {first, first}, {first, last, last},
		append(append([]any{}, maximum...), imageFirst),
		append(append([]any{}, maximum...), audioFirst),
		{map[string]any{"type": "reference_voice", "url": "https://example.com/audio.wav"}},
		{first, map[string]any{"type": "reference_image", "url": "https://example.com/image.png"}},
		{first, map[string]any{"type": "reference_audio", "url": "https://example.com/audio.wav"}},
		{map[string]any{"type": "first_frame", "url": "data:image/png;base64,AA=="}},
		{map[string]any{"type": "first_frame", "url": "http://example.com/first.png"}},
		{map[string]any{"type": "first_frame", "url": "https://example.com/first.png", "role": "reference_image"}}} {
		_, err := wan3Decode(t, plugin, "wan3.0-video", map[string]any{"prompt": "cat", "metadata": map[string]any{"input": map[string]any{"media": media}}})
		require.Error(t, err, "%+v", media)
	}
	_, err := wan3Decode(t, plugin, "wan3.0-video", map[string]any{"prompt": "cat", "media": []any{imageFirst, map[string]any{"type": "reference_video", "url": "https://example.com/video.mp4"}, audioFirst}})
	require.NoError(t, err)
}

func TestZhimengSeedanceRequests(t *testing.T) {
	registry := jsplugin.NewRegistry()
	plugin := wan3Plugins(t, registry)[2]
	for _, modelName := range []string{"sd-2-c4", "sd-2-c5"} {
		_, err := wan3Decode(t, plugin, modelName, map[string]any{"duration": 5})
		require.ErrorContains(t, err, "prompt must contain")
		_, err = wan3Decode(t, plugin, modelName, map[string]any{"prompt": " \n\t"})
		require.ErrorContains(t, err, "prompt must contain")
	}
	for _, modelName := range []string{"sd-2-c4", "sd-2-c5"} {
		binding, found := registry.Generation().LookupEndpoint("POST", "/v1/videos", modelName)
		require.True(t, found)
		assert.Equal(t, "zhimeng", binding.Plugin.Meta.Key)
		schema, _ := plugin.Meta.UsageForModel(modelName)
		require.Len(t, schema, 1)
		assert.Equal(t, "count", schema["video_count"].Unit)
		for _, tc := range []struct {
			name     string
			body     map[string]any
			duration float64
			ratio    string
		}{
			{"defaults", map[string]any{"prompt": "cat"}, 5, "16:9"},
			{"shortest", map[string]any{"prompt": "cat", "duration": 4, "resolution": "720p", "ratio": "9:16"}, 4, "9:16"},
			{"longest", map[string]any{"prompt": "cat", "seconds": "15", "ratio": "1:1"}, 15, "1:1"},
			{"equivalent aliases", map[string]any{"prompt": "cat", "duration": 4, "seconds": "4", "size": "1280x720", "metadata": map[string]any{"input": map[string]any{"prompt": "cat"}, "parameters": map[string]any{"size": "720P", "resolution": "720p", "ratio": "16:9"}}}, 4, "16:9"},
			{"nested parameters", map[string]any{"metadata": map[string]any{"input": map[string]any{"prompt": " cat "}, "parameters": map[string]any{"duration": "4", "ratio": "9:16"}}}, 4, "9:16"},
		} {
			t.Run(modelName+"/"+tc.name, func(t *testing.T) {
				req, err := wan3Decode(t, plugin, modelName, tc.body)
				require.NoError(t, err)
				repeated, err := wan3Decode(t, plugin, modelName, req)
				require.NoError(t, err)
				assert.Equal(t, req, repeated)
				ctx := map[string]any{"model": modelName, "requestBody": req, "baseUrl": "https://provider.example", "apiKey": "test-key"}
				value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
				require.NoError(t, err)
				descriptor := rolldekMap(t, value)
				assert.NotContains(t, descriptor, "rewriteModel")
				expectedPrompt := "cat"
				if tc.name == "nested parameters" {
					expectedPrompt = " cat "
				}
				assert.Equal(t, expectedPrompt, req["prompt"])
				assert.Equal(t, map[string]any{"model": modelName, "input": map[string]any{"prompt": expectedPrompt, "media": []any{}},
					"parameters": map[string]any{"duration": tc.duration, "resolution": "720p", "ratio": tc.ratio}}, descriptor["body"])
				value, err = plugin.Engine.Call(t.Context(), "extractUsage", ctx)
				require.NoError(t, err)
				assert.Equal(t, map[string]any{"video_count": float64(1)}, rolldekMap(t, value))
				ctx["usagePurpose"] = "billing_ratios"
				value, err = plugin.Engine.Call(t.Context(), "extractUsage", ctx)
				require.NoError(t, err)
				assert.Empty(t, rolldekMap(t, value))
			})
		}
		for _, ratio := range []string{"4:3", "3:4", "21:9"} {
			_, err := wan3Decode(t, plugin, modelName, map[string]any{"prompt": "cat", "ratio": ratio})
			if modelName == "sd-2-c4" {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		}
	}
	for _, body := range []map[string]any{
		{"duration": 3}, {"duration": 16}, {"duration": -1}, {"duration": 4.5}, {"duration": " "}, {"duration": nil}, {"duration": true}, {"duration": 1e30},
		{"duration": 4, "seconds": 5}, {"duration": 4, "metadata": map[string]any{"parameters": map[string]any{"duration": 5}}},
		{"resolution": "1080P"}, {"resolution": "480P"}, {"size": "1920x1080"}, {"size": "960x960", "ratio": "9:16"},
		{"size": "720P", "metadata": map[string]any{"parameters": map[string]any{"size": "1080P"}}},
		{"ratio": "adaptive"}, {"ratio": "auto"}, {"ratio": nil}, {"ratio": "16:9", "aspect_ratio": "9:16"},
		{"prompt": " "}, {"prompt": strings.Repeat("猫", 10001)}, {"seed": 0}, {"audio": false}, {"watermark": false}, {"prompt_extend": false},
		{"auto_duration": false}, {"input": map[string]any{"prompt": "cat"}}, {"parameters": map[string]any{"duration": 4}},
		{"metadata": nil}, {"metadata": map[string]any{"parameters": nil}}, {"metadata": map[string]any{"input": []any{}}},
		{"metadata": map[string]any{"input": map[string]any{"prompt": "different"}}},
		{"metadata": map[string]any{"parameters": map[string]any{"seed": 0}}},
		{"media": []any{}, "metadata": map[string]any{"input": map[string]any{"media": []any{}}}},
	} {
		if _, exists := body["prompt"]; !exists {
			body["prompt"] = "cat"
		}
		_, err := wan3Decode(t, plugin, "sd-2-c5", body)
		require.Error(t, err, "%+v", body)
	}
}

func TestZhimengSeedanceMedia(t *testing.T) {
	plugin := wan3Plugins(t, jsplugin.NewRegistry())[2]
	first := map[string]any{"type": "first_frame", "url": "https://example.com/first.png"}
	last := map[string]any{"type": "last_frame", "url": "https://example.com/last.png"}
	image := map[string]any{"type": "reference_image", "url": "https://example.com/image.png"}
	video := map[string]any{"type": "reference_video", "url": "https://example.com/video.mp4"}
	audio := map[string]any{"type": "reference_audio", "url": "https://example.com/audio.wav"}
	var maximum []any
	for range 9 {
		maximum = append(maximum, image)
	}
	for range 3 {
		maximum = append(maximum, video, audio)
	}
	for _, modelName := range []string{"sd-2-c4", "sd-2-c5"} {
		for _, media := range [][]any{nil, {first}, {last, first}, {image, video, audio, image, video}, {first, image, last, audio}, maximum} {
			if media == nil {
				media = []any{}
			}
			prompt := "保留 @1、图2、视频1、音频1 的原文，不替换引用"
			req, err := wan3Decode(t, plugin, modelName, map[string]any{"prompt": prompt, "duration": 4, "metadata": map[string]any{"input": map[string]any{"media": media}}})
			require.NoError(t, err)
			repeated, err := wan3Decode(t, plugin, modelName, req)
			require.NoError(t, err)
			assert.Equal(t, req, repeated)
			ctx := map[string]any{"model": modelName, "requestBody": req, "baseUrl": "https://provider.example", "apiKey": "test-key"}
			value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
			require.NoError(t, err)
			upstream := rolldekMap(t, value)["body"].(map[string]any)["input"].(map[string]any)
			assert.Equal(t, prompt, upstream["prompt"])
			actual := upstream["media"].([]any)
			require.Len(t, actual, len(media))
			hasReferenceVideo := false
			for index, item := range media {
				expected := maps.Clone(item.(map[string]any))
				if expected["type"] == "reference_audio" {
					expected["type"] = "reference_voice"
				}
				hasReferenceVideo = hasReferenceVideo || expected["type"] == "reference_video"
				assert.Equal(t, expected, actual[index])
			}
			assert.Equal(t, media, req["metadata"].(map[string]any)["input"].(map[string]any)["media"])
			value, err = plugin.Engine.Call(t.Context(), "parseSubmitResponse", ctx, map[string]any{"body": map[string]any{"task_id": "vendor-job", "status": "queued"}})
			require.NoError(t, err)
			state := rolldekMap(t, value)["state"]
			assert.Equal(t, map[string]any{"model": modelName, "duration": float64(4), "resolution": "720P", "hasReferenceVideo": hasReferenceVideo}, state)
			value, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", map[string]any{"model": "client-alias", "upstreamModel": modelName, "state": state}, map[string]any{"status": "SUCCESS"}, map[string]any{"seconds": -1})
			require.NoError(t, err)
			assert.Equal(t, map[string]any{"video_count": float64(1)}, rolldekMap(t, value))
		}
	}
	for _, media := range [][]any{
		{last}, {first, first}, {first, last, last}, {video, video, video, video}, {audio, audio, audio, audio},
		{first, last, image, image, image, image, image, image, image, image},
		append(append([]any{}, maximum...), image),
		{map[string]any{"type": "reference_voice", "url": "https://example.com/audio.wav"}},
		{map[string]any{"type": "reference_image", "url": "http://example.com/image.png"}},
		{map[string]any{"type": "reference_image", "url": "data:image/png;base64,AA=="}},
		{map[string]any{"type": "reference_video", "url": "https://example.com/video.mp4", "duration": 4}},
	} {
		_, err := wan3Decode(t, plugin, "sd-2-c5", map[string]any{"prompt": "cat", "media": media})
		require.Error(t, err, "%+v", media)
	}
	for _, modelName := range []string{"wan3.0-video", "sd-2-c4"} {
		mapped := "sd-2-c5"
		_, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{"model": modelName, "upstreamModel": mapped, "requestBody": map[string]any{"prompt": "cat"}})
		require.ErrorContains(t, err, "must not be remapped")
	}
}

func TestWAN3RollDekReferenceVideoSettlement(t *testing.T) {
	plugin := wan3Plugins(t, jsplugin.NewRegistry())[1]
	adaptor := taskplugin.New(plugin)
	for _, modelName := range []string{"wan3.0-video", "wan3.0-video-prime"} {
		for _, tc := range []struct {
			input, output, total float64
		}{
			{16, 2, 18},
			{16, 20, 36},
		} {
			t.Run(modelName+"/"+fmt.Sprint(tc.total), func(t *testing.T) {
				state, err := common.Marshal(map[string]any{"duration": tc.output, "resolution": "480P", "hasReferenceVideo": true})
				require.NoError(t, err)
				task := &model.Task{Properties: model.Properties{OriginModelName: modelName, UpstreamModelName: modelName}, PrivateData: model.TaskPrivateData{PluginState: state}}
				body, err := common.Marshal(map[string]any{"status": "completed", "usage": map[string]any{"input_video_duration": tc.input, "output_video_duration": tc.output}})
				require.NoError(t, err)
				result, err := adaptor.ParseTaskResult(task, &http.Response{StatusCode: http.StatusOK, Header: make(http.Header)}, body)
				require.NoError(t, err)
				assert.Equal(t, "SUCCESS", result.Status)
				assert.Equal(t, map[string]any{"seconds": tc.total}, result.UsageFacts)
				snap := &billingexpr.BillingSnapshot{TaskUsageBilling: true, ExprString: `tier("base", u("seconds") * 0.1)`, ExprVersion: 1, QuotaPerUnit: common.QuotaPerUnit, GroupRatio: 1, UsageFacts: map[string]any{"seconds": tc.output + 30, "resolution": "480P"}}
				settled, facts, err := service.EvaluateTaskCompletionUsage(snap, result.UsageFacts)
				require.NoError(t, err)
				assert.Equal(t, tc.total, facts["seconds"])
				assert.Equal(t, common.QuotaRound(tc.total*0.1*common.QuotaPerUnit), settled.ActualQuotaAfterGroup)
				assert.Equal(t, tc.output+30, snap.UsageFacts["seconds"], "completion must retain the frozen reservation")
			})
		}
	}
}

func TestRollDekNestedCompletionUsage(t *testing.T) {
	plugin := wan3Plugins(t, jsplugin.NewRegistry())[1]
	adaptor := taskplugin.New(plugin)
	for _, modelName := range []string{"wan3.0-video", "wan3.0-video-prime"} {
		for _, tc := range []struct {
			name, body string
			seconds    float64
			valid      bool
		}{
			{"actual RollDek response", `{"metadata":{"usage":{"SR":480,"duration":5,"input_video_duration":3,"output_video_duration":2}}}`, 5, true},
			{"fractional input", `{"metadata":{"usage":{"input_video_duration":3.019,"output_video_duration":2}}}`, 5.019, true},
			{"top level remains supported", `{"usage":{"input_video_duration":3,"output_video_duration":2}}`, 5, true},
			{"top level precedence", `{"usage":{"input_video_duration":0,"output_video_duration":2},"metadata":{"usage":{"input_video_duration":3,"output_video_duration":2}}}`, 2, true},
			{"null top level", `{"usage":null,"metadata":{"usage":{"input_video_duration":3,"output_video_duration":2}}}`, 5, true},
			{"duration fallback", `{"metadata":{"usage":{"input_video_duration":3,"duration":2}}}`, 5, true},
			{"missing usage", `{"metadata":{}}`, 0, false},
			{"partial reports must not merge", `{"usage":{"input_video_duration":3},"metadata":{"usage":{"output_video_duration":2}}}`, 0, false},
			{"negative output", `{"metadata":{"usage":{"input_video_duration":0,"output_video_duration":-1}}}`, 0, false},
			{"over host limit", `{"metadata":{"usage":{"input_video_duration":0,"output_video_duration":3601}}}`, 0, false},
		} {
			t.Run(modelName+"/"+tc.name, func(t *testing.T) {
				var body map[string]any
				require.NoError(t, common.UnmarshalJsonStr(tc.body, &body))
				body["status"] = "completed"
				encoded, err := common.Marshal(body)
				require.NoError(t, err)
				task := &model.Task{Properties: model.Properties{OriginModelName: modelName, UpstreamModelName: modelName}}
				result, err := adaptor.ParseTaskResult(task, &http.Response{StatusCode: http.StatusOK, Header: make(http.Header)}, encoded)
				require.NoError(t, err)
				assert.Equal(t, "SUCCESS", result.Status)
				if !tc.valid {
					assert.Empty(t, result.UsageFacts, "invalid or partial usage must retain the reservation")
					return
				}
				assert.Equal(t, map[string]any{"seconds": tc.seconds}, result.UsageFacts)
			})
		}
	}
}

func TestZhimengReferenceVideoBilling(t *testing.T) {
	plugin := wan3Plugins(t, jsplugin.NewRegistry())[2]
	video := map[string]any{"type": "reference_video", "url": "https://example.com/video.mp4"}
	media := []any{video, map[string]any{"type": "reference_image", "url": "https://example.com/image.png"}, video}
	for _, modelName := range []string{"wan3.0-video", "wan3.0-video-prime"} {
		t.Run(modelName, func(t *testing.T) {
			req, err := wan3Decode(t, plugin, modelName, map[string]any{"prompt": "视频1和视频2", "duration": 2, "resolution": "480P", "media": media})
			require.NoError(t, err)
			repeated, err := wan3Decode(t, plugin, modelName, req)
			require.NoError(t, err)
			assert.Equal(t, req, repeated)
			driver := map[string]any{"model": modelName, "baseUrl": "https://provider.example", "apiKey": "test-key", "requestBody": req}
			preflight := jsplugin.WithFetcher(t.Context(), func(_ context.Context, r jsplugin.FetchRequest) (jsplugin.FetchResponse, error) {
				assert.Equal(t, "https://provider.example/api/log/token", r.URL)
				assert.Equal(t, "Bearer test-key", r.Headers["Authorization"])
				return jsplugin.FetchResponse{Status: 200, Body: []byte(`{"success":true,"data":[]}`)}, nil
			})
			value, err := plugin.Engine.Call(preflight, "buildSubmitRequest", driver)
			require.NoError(t, err)
			assert.Equal(t, media, rolldekMap(t, value)["body"].(map[string]any)["metadata"].(map[string]any)["input"].(map[string]any)["media"])
			_, err = plugin.Engine.Call(t.Context(), "buildSubmitRequest", driver)
			require.Error(t, err, "a host without billing lookup must not submit paid reference work")
			unavailable := jsplugin.WithFetcher(t.Context(), func(_ context.Context, _ jsplugin.FetchRequest) (jsplugin.FetchResponse, error) {
				return jsplugin.FetchResponse{Status: 403, Body: []byte(`{"success":false}`)}, nil
			})
			_, err = plugin.Engine.Call(unavailable, "buildSubmitRequest", driver)
			require.ErrorContains(t, err, "billing records are unavailable")
			value, err = plugin.Engine.Call(t.Context(), "extractUsage", driver)
			require.NoError(t, err)
			assert.Equal(t, map[string]any{"seconds": float64(17), "resolution": "480P"}, rolldekMap(t, value))
			value, err = plugin.Engine.Call(t.Context(), "parseSubmitResponse", driver, map[string]any{"body": map[string]any{"id": "vendor-job"}})
			require.NoError(t, err)
			state := rolldekMap(t, value)["state"].(map[string]any)
			task := map[string]any{"model": modelName, "taskId": "vendor-job", "baseUrl": "https://provider.example", "apiKey": "test-key", "state": state}
			for _, tc := range []struct {
				name, taskID, resolution string
				seconds                  any
				count                    int
				status                   int
				duplicate                bool
				valid                    bool
			}{
				{name: "measured fractional input", seconds: 6.038, count: 2, valid: true},
				{name: "provider deduplicated input", seconds: 2.02, count: 1, valid: true},
				{name: "missing input", count: 2},
				{name: "string input", seconds: "3.019", count: 2},
				{name: "zero input", seconds: 0, count: 2},
				{name: "negative input", seconds: -1, count: 2},
				{name: "input over limit", seconds: 15.001, count: 2},
				{name: "wrong task", taskID: "another-job", seconds: 3.019, count: 2},
				{name: "wrong resolution", resolution: "720P", seconds: 3.019, count: 2},
				{name: "too many videos", seconds: 3.019, count: 3},
				{name: "duplicate billing records", seconds: 3.019, count: 2, duplicate: true},
				{name: "billing lookup unavailable", status: 503, seconds: 3.019, count: 2},
			} {
				t.Run(tc.name, func(t *testing.T) {
					taskID, resolution := tc.taskID, tc.resolution
					if taskID == "" {
						taskID = "vendor-job"
					}
					if resolution == "" {
						resolution = "480P"
					}
					other, err := common.Marshal(map[string]any{"task_id": taskID, "is_task": true, "reference_video_charge": map[string]any{"seconds": tc.seconds, "resolution": resolution, "video_count": tc.count}})
					require.NoError(t, err)
					row := map[string]any{"type": 2, "model_name": modelName, "other": string(other)}
					rows := []any{map[string]any{"type": 2, "model_name": modelName, "other": "invalid JSON"}, row}
					if tc.duplicate {
						rows = append(rows, row)
					}
					encoded, err := common.Marshal(map[string]any{"success": true, "data": rows})
					require.NoError(t, err)
					fetch := jsplugin.WithFetcher(t.Context(), func(_ context.Context, r jsplugin.FetchRequest) (jsplugin.FetchResponse, error) {
						status := tc.status
						if status == 0 {
							status = 200
						}
						return jsplugin.FetchResponse{Status: status, Body: encoded}, nil
					})
					body := map[string]any{"status": "completed", "seconds": 2}
					value, err := plugin.Engine.Call(fetch, "parseTaskResult", task, body)
					require.NoError(t, err)
					parsed := rolldekMap(t, value)
					assert.Equal(t, "SUCCESS", parsed["status"], "billing lookup failure must not refund a generated video")
					result := map[string]any{"status": "SUCCESS", "plugin_state": parsed["state"]}
					usage, usageErr := plugin.Engine.Call(t.Context(), "extractUsageOnComplete", task, result, body)
					if !tc.valid {
						require.Error(t, usageErr)
						assert.Contains(t, parsed["state"].(map[string]any), "referenceVideoBillingError")
						return
					}
					require.NoError(t, usageErr)
					assert.Equal(t, tc.seconds.(float64)+2, rolldekMap(t, usage)["seconds"])
					cachedTask := maps.Clone(task)
					cachedTask["state"] = parsed["state"]
					_, err = plugin.Engine.Call(t.Context(), "parseTaskResult", cachedTask, body)
					require.NoError(t, err, "persisted input billing must survive the token log window without another fetch")
					usage, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", cachedTask, map[string]any{"status": "SUCCESS"}, body)
					require.NoError(t, err)
					assert.Equal(t, tc.seconds.(float64)+2, rolldekMap(t, usage)["seconds"])
					_, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", cachedTask, map[string]any{"status": "SUCCESS"}, map[string]any{"seconds": 30})
					require.Error(t, err, "input plus output must not exceed the provider total limit")
				})
			}
			for _, duration := range []int{20, 29} {
				req["duration"] = duration
				usage, err := plugin.Engine.Call(t.Context(), "extractUsage", driver)
				require.NoError(t, err)
				assert.Equal(t, float64(30), rolldekMap(t, usage)["seconds"])
			}
			req["duration"] = 30
			_, err = wan3Decode(t, plugin, modelName, req)
			require.Error(t, err)
			video["duration"] = 0.001
			_, err = wan3Decode(t, plugin, modelName, map[string]any{"prompt": "cat", "media": []any{video}})
			require.Error(t, err, "client duration must not influence input billing")
			delete(video, "duration")
			five := []any{video, video, video, video, video}
			_, err = wan3Decode(t, plugin, modelName, map[string]any{"prompt": "cat", "media": five})
			require.NoError(t, err)
			_, err = wan3Decode(t, plugin, modelName, map[string]any{"prompt": "cat", "media": append(five, video)})
			require.ErrorContains(t, err, "too many input.media entries for reference_video")
		})
	}
}

func TestZhimengMinimaxH3(t *testing.T) {
	registry := jsplugin.NewRegistry()
	plugin := wan3Plugins(t, registry)[2]
	binding, found := registry.Generation().LookupEndpoint("POST", "/v1/videos", "MiniMax-H3")
	require.True(t, found)
	assert.Equal(t, "zhimeng", binding.Plugin.Meta.Key)
	schema, _ := plugin.Meta.UsageForModel("MiniMax-H3")
	require.Len(t, schema, 4)
	assert.Equal(t, "second", schema["reference_video_seconds"].Unit)
	assert.Equal(t, "count", schema["extra_image_count"].Unit)

	for _, tc := range []struct {
		name             string
		body             map[string]any
		seconds          float64
		resolution, mode string
		images           []any
	}{
		{"defaults", map[string]any{"prompt": "cat"}, 4, "2K", "frames", []any{}},
		{"aliases", map[string]any{"prompt": "cat", "seconds": "15", "size": "768p", "aspect_ratio": "21:9"}, 15, "768P", "frames", []any{}},
		{"frames reordered", map[string]any{"prompt": "cat", "media": []any{map[string]any{"type": "last_frame", "url": "https://example.com/last.png"}, map[string]any{"type": "first_frame", "url": "http://example.com/first.png"}}}, 4, "2K", "frames", []any{"http://example.com/first.png", "https://example.com/last.png"}},
		{"references", map[string]any{"prompt": "cat", "generation_mode": "references", "image_urls": []any{"https://example.com/image.png"}}, 4, "2K", "references", []any{"https://example.com/image.png"}},
		{"nested", map[string]any{"metadata": map[string]any{"input": map[string]any{"prompt": "cat"}, "parameters": map[string]any{"duration": 6, "resolution": "768P"}}}, 6, "768P", "frames", []any{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, err := wan3Decode(t, plugin, "MiniMax-H3", tc.body)
			require.NoError(t, err)
			repeated, err := wan3Decode(t, plugin, "MiniMax-H3", req)
			require.NoError(t, err)
			assert.Equal(t, req, repeated)
			ctx := map[string]any{"model": "MiniMax-H3", "requestBody": req, "baseUrl": "https://provider.example", "apiKey": "test-key"}
			value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
			require.NoError(t, err)
			body := rolldekMap(t, value)["body"].(map[string]any)
			assert.Equal(t, "minimax-h3", body["model"])
			assert.Equal(t, tc.seconds, body["duration"])
			assert.Equal(t, tc.resolution, body["resolution"])
			assert.Equal(t, tc.mode, body["generation_mode"])
			assert.Equal(t, tc.images, body["image_urls"])
			value, err = plugin.Engine.Call(t.Context(), "extractUsage", ctx)
			require.NoError(t, err)
			assert.Equal(t, map[string]any{"seconds": tc.seconds, "resolution": tc.resolution, "reference_video_seconds": float64(0), "extra_image_count": float64(0)}, rolldekMap(t, value))
			value, err = plugin.Engine.Call(t.Context(), "parseSubmitResponse", ctx, map[string]any{"body": map[string]any{"id": "h3-task"}})
			require.NoError(t, err)
			task := map[string]any{"model": "MiniMax-H3", "state": rolldekMap(t, value)["state"]}
			value, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", task, map[string]any{"status": "SUCCESS"}, map[string]any{})
			require.NoError(t, err)
			assert.Equal(t, map[string]any{"seconds": tc.seconds}, rolldekMap(t, value))
			for _, seconds := range []any{0, 3, 16, 4.5, "4", nil} {
				_, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", task, map[string]any{"status": "SUCCESS"}, map[string]any{"seconds": seconds})
				require.Error(t, err)
			}
		})
	}
	for _, body := range []map[string]any{
		{"duration": -1}, {"duration": 3}, {"duration": 16}, {"duration": 4.5}, {"duration": true}, {"duration": nil}, {"duration": " "}, {"duration": 1e30},
		{"seconds": 4, "duration": 5}, {"metadata": map[string]any{"parameters": map[string]any{"duration": 16}}},
		{"resolution": "720P"}, {"resolution": "2K", "size": "768P"}, {"ratio": "auto"}, {"generation_mode": "invalid"},
		{"image_urls": "https://example.com/a.png"}, {"image_urls": []any{"blob:test"}},
		{"generation_mode": "frames", "video_urls": []any{"https://example.com/v.mp4"}},
		{"image_urls": []any{"https://example.com/1", "https://example.com/2", "https://example.com/3"}},
		{"media": []any{map[string]any{"type": "last_frame", "url": "https://example.com/last.png"}}},
		{"media": []any{}, "image_urls": []any{}}, {"content": []any{}}, {"metadata": nil},
		{"metadata": map[string]any{"input": map[string]any{"media": []any{map[string]any{"type": "reference_video", "url": "https://example.com/v", "seconds": 1}}}}},
	} {
		body["prompt"] = "cat"
		_, err := wan3Decode(t, plugin, "MiniMax-H3", body)
		require.Error(t, err, "%+v", body)
	}
	for _, key := range []string{"video_urls", "audio_urls"} {
		_, err := wan3Decode(t, plugin, "MiniMax-H3", map[string]any{"prompt": "cat", "generation_mode": "references", key: []any{"https://example.com/1", "https://example.com/2", "https://example.com/3", "https://example.com/4"}})
		require.Error(t, err)
	}
	_, err := wan3Decode(t, plugin, "minimax-h3", map[string]any{"prompt": "cat"})
	require.NoError(t, err)
	canonical, found := registry.Generation().CanonicalModel("minimax-h3")
	require.True(t, found)
	assert.Equal(t, "MiniMax-H3", canonical)
	value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{"model": "custom-h3", "upstreamModel": "minimax-h3", "requestBody": map[string]any{"prompt": "cat"}, "baseUrl": "https://provider.example", "apiKey": "test-key"})
	require.NoError(t, err)
	assert.Equal(t, "minimax-h3", rolldekMap(t, value)["body"].(map[string]any)["model"])
	value, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", map[string]any{"model": "custom-h3", "upstreamModel": "minimax-h3", "state": map[string]any{"duration": 4, "hasReferenceVideo": false}}, map[string]any{"status": "SUCCESS"}, map[string]any{})
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"seconds": float64(4)}, rolldekMap(t, value))
	for _, count := range []int{5, 6, 9, 10} {
		images := make([]any, count)
		for i := range images {
			images[i] = fmt.Sprintf("https://example.com/%d.png", i)
		}
		req, err := wan3Decode(t, plugin, "MiniMax-H3", map[string]any{"prompt": "cat", "generation_mode": "references", "image_urls": images, "video_urls": []any{"https://example.com/v.mp4"}})
		if count == 10 {
			require.Error(t, err)
			continue
		}
		require.NoError(t, err)
		ctx := map[string]any{"model": "MiniMax-H3", "requestBody": req, "baseUrl": "https://provider.example", "apiKey": "test-key"}
		value, err := plugin.Engine.Call(t.Context(), "extractUsage", ctx)
		require.NoError(t, err)
		assert.Equal(t, map[string]any{"seconds": float64(4), "resolution": "2K", "reference_video_seconds": float64(15), "extra_image_count": float64(max(count-5, 0))}, rolldekMap(t, value))
		_, err = plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
		require.Error(t, err, "reference video requires access to provider billing logs")
		fetch := jsplugin.WithFetcher(t.Context(), func(_ context.Context, r jsplugin.FetchRequest) (jsplugin.FetchResponse, error) {
			assert.Equal(t, "https://provider.example/api/log/token", r.URL)
			return jsplugin.FetchResponse{Status: 200, Body: []byte(`{"success":true,"data":[{"type":2,"model_name":"minimax-h3","other":{"task_id":"h3-task","is_task":true,"reference_video_charge":{"seconds":6.038,"video_count":1,"resolution":"2K"}}}]}`)}, nil
		})
		value, err = plugin.Engine.Call(fetch, "buildSubmitRequest", ctx)
		require.NoError(t, err)
		assert.Equal(t, []any{"https://example.com/v.mp4"}, rolldekMap(t, value)["body"].(map[string]any)["video_urls"])
		value, err = plugin.Engine.Call(t.Context(), "parseSubmitResponse", ctx, map[string]any{"body": map[string]any{"id": "h3-task"}})
		require.NoError(t, err)
		task := map[string]any{"model": "MiniMax-H3", "taskId": "h3-task", "state": rolldekMap(t, value)["state"], "baseUrl": "https://provider.example", "apiKey": "test-key"}
		_, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", task, map[string]any{"status": "SUCCESS"}, map[string]any{})
		require.Error(t, err, "missing verified input must retain reservation")
		value, err = plugin.Engine.Call(fetch, "parseTaskResult", task, map[string]any{"status": "completed", "media_url": "https://cdn.example/h3.mp4"})
		require.NoError(t, err)
		parsed := rolldekMap(t, value)
		assert.Equal(t, "https://cdn.example/h3.mp4", parsed["url"])
		value, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", task, map[string]any{"status": "SUCCESS", "plugin_state": parsed["state"]}, map[string]any{})
		require.NoError(t, err)
		assert.Equal(t, map[string]any{"seconds": float64(4), "reference_video_seconds": 6.038}, rolldekMap(t, value))
	}
	value, err = plugin.Engine.Call(t.Context(), "buildContentRequest", map[string]any{"model": "MiniMax-H3", "artifactKey": "video", "upstreamTaskId": "h3-task", "baseUrl": "https://provider.example", "apiKey": "test-key", "clientRequest": map[string]any{"method": "GET"}})
	require.NoError(t, err)
	assert.Equal(t, "https://provider.example/v1/videos/h3-task/content", rolldekMap(t, value)["url"])
}
