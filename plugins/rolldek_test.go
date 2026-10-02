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
	assert.Len(t, plugin.Meta.Models, 12)
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
	model := "wan3.0-video-480p"
	decoded, err := decode(model, map[string]any{
		"model": model, "prompt": "a cat", "seconds": "10", "resolution": "1080P", "ratio": "9:16",
		"reference_videos": []any{map[string]any{"url": "https://example.com/a.mp4", "duration": 5}, "https://example.com/a.mp4"},
		"reference_images": []any{map[string]any{"url": "https://example.com/cat.png"}},
	})
	require.NoError(t, err)
	ctx := map[string]any{
		"model": model, "upstreamModel": model, "baseUrl": "https://rolldek.com", "apiKey": "key",
		"requestBody": decoded["requestBody"],
	}
	value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
	require.NoError(t, err)
	request := rolldekMap(t, value)
	assert.Equal(t, "https://rolldek.com/v1/videos", request["url"])
	body := request["body"].(map[string]any)
	assert.Equal(t, model, body["model"])
	assert.Equal(t, "10", body["seconds"])
	assert.Equal(t, "480P", body["size"])
	assert.Equal(t, "480P", body["resolution"])
	assert.Equal(t, "9:16", body["aspect_ratio"])
	assert.Len(t, body["reference_videos"], 1)
	value, err = plugin.Engine.Call(t.Context(), "extractUsage", ctx)
	require.NoError(t, err)
	assert.Equal(t, float64(15), rolldekMap(t, value)["seconds"])
	aliasCtx := map[string]any{
		"model": "my-wan", "upstreamModel": "wan3.0-video-720p", "baseUrl": "https://rolldek.com", "apiKey": "key",
		"requestBody": map[string]any{"model": "my-wan", "prompt": "a cat", "seconds": "5"},
	}
	value, err = plugin.Engine.Call(t.Context(), "buildSubmitRequest", aliasCtx)
	require.NoError(t, err)
	aliasBody := rolldekMap(t, value)["body"].(map[string]any)
	assert.Equal(t, "wan3.0-video-720p", aliasBody["model"])
	assert.Equal(t, "720P", aliasBody["size"])

	value, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", map[string]any{"model": model}, map[string]any{}, map[string]any{
		"usage": map[string]any{"output_video_duration": 10, "input_video_duration": 6},
	})
	require.NoError(t, err)
	assert.Equal(t, float64(16), rolldekMap(t, value)["seconds"])
	value, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", map[string]any{"model": model}, map[string]any{}, map[string]any{"status": "completed"})
	require.NoError(t, err)
	assert.Empty(t, rolldekMap(t, value))
	value, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", map[string]any{"model": "wan3.0-image-720p"}, map[string]any{}, map[string]any{
		"usage": map[string]any{"output_video_duration": 8, "input_video_duration": 9},
	})
	require.NoError(t, err)
	assert.Equal(t, float64(8), rolldekMap(t, value)["seconds"])

	_, err = decode("wan3.0-image-720p", map[string]any{"prompt": "cat", "reference_videos": []any{"https://example.com/a.mp4"}})
	require.ErrorContains(t, err, "do not support reference videos")
	_, err = decode("wan3.0-image-720p", map[string]any{"prompt": "cat"})
	require.ErrorContains(t, err, "require a reference image")
	_, err = decode(model, map[string]any{"prompt": "cat", "seconds": 0})
	require.ErrorContains(t, err, "between 1 and 3600")

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
