package zhimeng_test

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/model"
	runtime "github.com/QuantumNous/new-api/pkg/jsplugin"
	adaptorjs "github.com/QuantumNous/new-api/relay/channel/task/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Exercise the existing host's actual hook contexts: submit has no fetcher,
// while polling does. Node mocks alone cannot verify this boundary.
func TestReferenceCompletionOnUnmodifiedHost(t *testing.T) {
	service.InitHttpClient()
	source, err := os.ReadFile("plugin.js")
	require.NoError(t, err)
	plugin, err := runtime.NewRegistry().Register(string(source), runtime.Options{})
	require.NoError(t, err)
	for _, modelName := range []string{"MiniMax-H3", "wan3.0-video"} {
		for _, billingStatus := range []int{200, 404, 503} {
			t.Run(fmt.Sprintf("%s/billing-%d", modelName, billingStatus), func(t *testing.T) {
				duration, resolution, wireModel := 20, "768P", "minimax-h3"
				if modelName == "wan3.0-video" {
					duration, resolution, wireModel = 5, "720P", modelName
				}
				var queries, bills, posts atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					assert.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
					if r.Method != http.MethodGet {
						posts.Add(1)
						w.WriteHeader(405)
						return
					}
					w.Header().Set("Content-Type", "application/json")
					switch r.URL.Path {
					case "/v1/videos/upstream-1":
						queries.Add(1)
						// A stale JSON snapshot must not undo verified submission success.
						_, _ = io.WriteString(w, `{"status":"queued"}`)
					case "/api/log/token":
						bills.Add(1)
						w.WriteHeader(billingStatus)
						if billingStatus == 200 {
							fmt.Fprintf(w, `{"success":true,"data":[{"type":2,"model_name":%q,"other":{"task_id":"upstream-1","is_task":true,"reference_video_charge":{"seconds":3,"resolution":%q,"video_count":1}}}]}`, wireModel, resolution)
						}
					default:
						w.WriteHeader(404)
					}
				}))
				defer server.Close()
				info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: server.URL, ApiKey: "test-key"}, TaskRelayInfo: &relaycommon.TaskRelayInfo{}, OriginModelName: modelName}
				info.UpstreamModelName = modelName
				adaptor := adaptorjs.New(plugin)
				adaptor.Init(info)
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", nil)
				c.Set("task_request", map[string]any{"model": modelName, "prompt": "scene", "duration": duration, "resolution": resolution, "metadata": map[string]any{"input": map[string]any{"media": []any{map[string]any{"type": "reference_video", "url": "https://media.example/ref.mp4"}}}}})
				reply := fmt.Sprintf(`{"id":"upstream-1","status":"completed","seconds":%d}`, duration)
				submitted, taskErr := adaptor.ParseResponse(c, &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(reply))}, info)
				require.Nil(t, taskErr)
				require.NotNil(t, submitted)
				assert.Nil(t, submitted.Immediate)
				assert.Zero(t, bills.Load(), "submit parsing must not call fetch")
				task := &model.Task{TaskID: "task-public", Properties: model.Properties{OriginModelName: modelName, UpstreamModelName: modelName}, Data: submitted.TaskData}
				task.PrivateData.UpstreamTaskID = submitted.UpstreamTaskID
				task.PrivateData.PluginState = submitted.PluginState
				response, err := adaptor.FetchTask(server.URL, "test-key", task, "")
				require.NoError(t, err)
				defer response.Body.Close()
				body, err := io.ReadAll(response.Body)
				require.NoError(t, err)
				result, err := adaptor.ParseTaskResult(task, response, body)
				require.NoError(t, err)
				assert.Equal(t, model.TaskStatusSuccess, result.Status)
				assert.EqualValues(t, 1, queries.Load())
				assert.EqualValues(t, 1, bills.Load())
				assert.Zero(t, posts.Load())
				if billingStatus != 200 {
					assert.Empty(t, result.UsageFacts, "keep reservation on unavailable accounting")
					return
				}
				if modelName == "MiniMax-H3" {
					assert.EqualValues(t, 20, result.UsageFacts["seconds"])
					assert.EqualValues(t, 3, result.UsageFacts["reference_video_seconds"])
				} else {
					assert.EqualValues(t, 8, result.UsageFacts["seconds"])
				}
			})
		}
	}
}

func TestVideoFailureQueryOnUnmodifiedHost(t *testing.T) {
	for _, path := range []string{"plugin.js", "../rolldek/plugin.js"} {
		t.Run(path, func(t *testing.T) {
			source, err := os.ReadFile(path)
			require.NoError(t, err)
			plugin, err := runtime.NewRegistry().Register(string(source), runtime.Options{})
			require.NoError(t, err)
			task := &model.Task{TaskID: "task_public", Status: model.TaskStatusFailure, FailReason: "参考视频超过 15 秒", CreatedAt: 10, Properties: model.Properties{OriginModelName: "wan3.0-video"}}
			rendered, err := adaptorjs.New(plugin).ConvertToOpenAIVideo(task)
			require.NoError(t, err)
			assert.JSONEq(t, `{"id":"task_public","object":"video","model":"wan3.0-video","status":"failed","progress":0,"created_at":10,"error":{"code":"generation_failed","message":"参考视频超过 15 秒"}}`, string(rendered))
			task.FailReason = "Download failed https://cdn.example/private?signature=secret Bearer private-key"
			rendered, err = adaptorjs.New(plugin).ConvertToOpenAIVideo(task)
			require.NoError(t, err)
			assert.NotContains(t, string(rendered), "signature")
			assert.NotContains(t, string(rendered), "private-key")
			assert.Contains(t, string(rendered), "Download failed")
		})
	}
}
