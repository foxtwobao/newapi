package plugins_test

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRollDekStandalonePlugin(t *testing.T) {
	source, err := os.ReadFile("../rolldek/plugin.js")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	alibabaSource, err := builtinplugins.Source("alibaba")
	require.NoError(t, err)
	_, err = registry.RegisterFactory(alibabaSource, jsplugin.Options{Key: "alibaba"})
	require.NoError(t, err)
	plugin, err := registry.Register(string(source), jsplugin.Options{Key: "rolldek"})
	require.NoError(t, err)
	assert.Equal(t, "rolldek", plugin.Meta.Key)
	assert.Empty(t, plugin.Meta.ChannelTypes)
	assert.Equal(t, "https://rolldek.com", plugin.Meta.BaseURL)
	assert.ElementsMatch(t, []string{"wan3.0-video", "wan3.0-video-prime"}, plugin.Meta.Models)
	_, ok := registry.Get("alibaba")
	assert.True(t, ok)
	for _, model := range plugin.Meta.Models {
		schema, _ := plugin.Meta.UsageForModel(model)
		require.Contains(t, schema, "seconds")
		assert.Equal(t, "second", schema["seconds"].Unit)
		assert.Equal(t, "Video generation unit price", schema["seconds"].Description["en"])
		assert.Equal(t, "视频生成单价", schema["seconds"].Description["zh"])
	}

	decode := func(model string, body map[string]any) (map[string]any, error) {
		value, callErr := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
			"model": model, "body": map[string]any{"kind": "json", "value": body},
		})
		if callErr != nil {
			return nil, callErr
		}
		return rolldekMap(t, value), nil
	}
	for _, family := range []string{"wan3.0-video", "wan3.0-video-prime", "wan3.0-image", "wan3.0-image-prime"} {
		for _, resolution := range []string{"480p", "720p", "1080p"} {
			name := family + "-" + resolution
			t.Run("removed/"+name, func(t *testing.T) {
				assert.Empty(t, registry.Generation().LookupEndpointCandidates("POST", "/v1/videos", name))
				_, err := decode(name, map[string]any{"prompt": "cat", "duration": 5})
				require.ErrorContains(t, err, "unsupported RollDek model")
				for _, clientModel := range []string{name, "custom-alias"} {
					ctx := map[string]any{"model": clientModel, "upstreamModel": name, "requestBody": map[string]any{"prompt": "cat", "duration": 5}}
					for _, hook := range []string{"buildSubmitRequest", "extractUsage"} {
						_, err := plugin.Engine.Call(t.Context(), hook, ctx)
						require.ErrorContains(t, err, "unsupported RollDek model")
					}
				}
			})
		}
	}
	// Aliases may target a public model; the resolution suffix is only added
	// when building the provider request.
	aliasCtx := map[string]any{
		"model": "my-wan", "upstreamModel": "wan3.0-video", "baseUrl": "https://rolldek.com", "apiKey": "key",
		"requestBody": map[string]any{"prompt": "a cat", "duration": 5, "resolution": "720P"},
	}
	value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", aliasCtx)
	require.NoError(t, err)
	request := rolldekMap(t, value)
	assert.NotContains(t, request, "model")
	assert.Equal(t, "https://rolldek.com/v1/videos", request["url"])
	aliasBody := request["body"].(map[string]any)
	assert.Equal(t, "wan3.0-video-720p", aliasBody["model"])
	assert.Equal(t, "720P", aliasBody["size"])
	assert.Equal(t, "5", aliasBody["seconds"])
	_, err = decode("wan3.0-video", map[string]any{"prompt": "cat", "duration": 0})
	require.ErrorContains(t, err, "between 2 and 30")

	value, err = plugin.Engine.Call(t.Context(), "buildQueryRequest", map[string]any{"baseUrl": "https://rolldek.com", "apiKey": "key", "taskId": "task_1"})
	require.NoError(t, err)
	assert.Equal(t, "https://rolldek.com/v1/videos/task_1", rolldekMap(t, value)["url"])
	value, err = plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{}, map[string]any{
		"status": "completed", "progress": 100, "metadata": map[string]any{"url": "https://example.com/output.mp4"},
	})
	require.NoError(t, err)
	assert.Equal(t, "SUCCESS", rolldekMap(t, value)["status"])
	value, err = plugin.Engine.Call(t.Context(), "buildContentRequest", map[string]any{
		"baseUrl": "https://rolldek.com", "apiKey": "key", "upstreamTaskId": "task_1", "artifactKey": "video",
		"clientRequest": map[string]any{"method": "GET"},
	})
	require.NoError(t, err)
	assert.Equal(t, "https://rolldek.com/v1/videos/task_1/content", rolldekMap(t, value)["url"])
}

func rolldekMap(t *testing.T, value any) map[string]any {
	t.Helper()
	data, err := common.Marshal(value)
	require.NoError(t, err)
	var result map[string]any
	require.NoError(t, common.Unmarshal(data, &result))
	return result
}
