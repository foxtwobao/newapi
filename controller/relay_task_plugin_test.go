package controller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relay"
	relaychannel "github.com/QuantumNous/new-api/relay/channel"
	taskplugin "github.com/QuantumNous/new-api/relay/channel/task/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

type taskSubmissionTestBilling struct {
	events     *[]string
	settleErr  error
	reserveErr error
	onSettle   func()
	refunds    int
}

func (b *taskSubmissionTestBilling) Settle(int) error {
	*b.events = append(*b.events, "settle")
	if b.onSettle != nil {
		b.onSettle()
	}
	return b.settleErr
}

func (b *taskSubmissionTestBilling) Refund(*gin.Context) {
	*b.events = append(*b.events, "refund")
	b.refunds++
}

func (b *taskSubmissionTestBilling) NeedsRefund() bool        { return b.refunds == 0 }
func (b *taskSubmissionTestBilling) GetPreConsumedQuota() int { return 0 }
func (b *taskSubmissionTestBilling) Reserve(int) error {
	*b.events = append(*b.events, "reserve")
	return b.reserveErr
}

func (b *taskSubmissionTestBilling) ReserveBeforeSubmit(quota int) error { return b.Reserve(quota) }

func TestPresentTaskSubmissionUsesNativePresenterAfterPersistence(t *testing.T) {
	plugin, err := pluginruntime.CompilePlugin(`
export const meta = {apiVersion:1,key:"presenter-test",name:"Presenter",version:"1.0.0",author:{name:"Test"},models:["model"],fetchMode:"per_task",routes:[{method:"POST",path:"/vendor/jobs",type:"submit",decode:"decode",render:"created"}]};
export const native = {decode:function(ctx){return {kind:"submit",model:"model",requestBody:ctx.body.value};},created:function(ctx,task){return {data:{task_id:task.task_id},upstream:task.data};}};
export function buildSubmitRequest(){return {}} export function parseSubmitResponse(){return {taskId:"upstream"}} export function buildQueryRequest(){return {}} export function parseTaskResult(){return {status:"SUCCESS"}}
`, pluginruntime.Options{})
	require.NoError(t, err)
	priceData := types.PriceData{}
	priceData.AddOtherRatio("seconds", 5)
	task := &model.Task{TaskID: "task_public", SubmitTime: 123}
	task.SetData(map[string]any{"task_id": "upstream_private"})
	outcome := &taskSubmissionOutcome{
		Result:    &relay.TaskSubmitResult{},
		Task:      task,
		RelayInfo: &relaycommon.RelayInfo{PriceData: priceData},
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/vendor/jobs", strings.NewReader(`{"model":"model"}`))
	c.Set(pluginruntime.ContextKeyPinnedRoute, pluginruntime.PinnedRoute{Plugin: plugin, Route: plugin.Meta.Routes[0]})
	c.Set(pluginruntime.ContextKeyRouteRequest, pluginruntime.RouteRequestContext{Path: "/vendor/jobs", Method: http.MethodPost, Body: map[string]any{"kind": "json", "value": map[string]any{"model": "model"}}})

	presentTaskSubmission(c, outcome)

	assert.JSONEq(t, `{
		"data":{"task_id":"task_public"},
		"upstream":{"task_id":"upstream_private"}
	}`, recorder.Body.String())
	assert.JSONEq(t, `{"seconds":5}`, recorder.Header().Get("X-New-Api-Other-Ratios"))
}

func TestPresentTaskSubmissionFallbackUsesPersistedPublicID(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	outcome := &taskSubmissionOutcome{
		Result:    &relay.TaskSubmitResult{},
		Task:      &model.Task{TaskID: "task_persisted", SubmitTime: 456},
		RelayInfo: &relaycommon.RelayInfo{OriginModelName: "video-model"},
	}

	presentTaskSubmission(c, outcome)

	assert.JSONEq(t, `{
		"id":"task_persisted",
		"task_id":"task_persisted",
		"status":"queued",
		"model":"video-model",
		"created_at":456
	}`, recorder.Body.String())
}

func TestPresentTaskSubmissionUsesHostOpenAIVideoCreateReceipt(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set(pluginruntime.ContextKeyPinnedEndpoint, pluginruntime.PinnedEndpoint{
		Protocol:  "openai_video",
		Operation: pluginruntime.HostProtocolOperation{Name: "create"},
	})
	task := &model.Task{
		TaskID:     "task_public",
		Status:     model.TaskStatusSubmitted,
		Progress:   "0%",
		CreatedAt:  456,
		Properties: model.Properties{OriginModelName: "video-model"},
	}
	outcome := &taskSubmissionOutcome{Result: &relay.TaskSubmitResult{}, Task: task, RelayInfo: &relaycommon.RelayInfo{}}

	presentTaskSubmission(c, outcome)

	assert.JSONEq(t, `{"id":"task_public","object":"video","model":"video-model","status":"queued","progress":0,"created_at":456}`, recorder.Body.String())
	assert.NotContains(t, recorder.Body.String(), "task_id")
}

func TestExecuteTaskSubmissionRefundsWhenInsertFails(t *testing.T) {
	events := make([]string, 0, 3)
	database := setupTaskSubmissionDatabase(t, false, &events)
	_ = database
	billing := &taskSubmissionTestBilling{events: &events}
	c := taskSubmissionTestContext()
	info := taskSubmissionRelayInfo(billing)

	outcome, taskErr := executeTaskSubmissionWith(c, info, func(*gin.Context, *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
		return &relay.TaskSubmitResult{
			UpstreamTaskID: "upstream_private",
			Platform:       constant.TaskPlatform("plugin"),
		}, nil
	})

	assert.Nil(t, outcome)
	require.NotNil(t, taskErr)
	assert.Equal(t, "task_insert_failed", taskErr.Code)
	assert.Equal(t, []string{"reserve", "insert", "refund"}, events)
	assert.Equal(t, 1, billing.refunds)
	assert.False(t, c.Writer.Written())
}

func TestExecuteTaskSubmissionSettlementFailureStaysDurableAndWritesNothing(t *testing.T) {
	events := make([]string, 0, 3)
	database := setupTaskSubmissionDatabase(t, true, &events)
	billing := &taskSubmissionTestBilling{events: &events, settleErr: errors.New("settlement failed")}
	c := taskSubmissionTestContext()
	info := taskSubmissionRelayInfo(billing)

	outcome, taskErr := executeTaskSubmissionWith(c, info, func(*gin.Context, *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
		return &relay.TaskSubmitResult{
			UpstreamTaskID: "upstream_private",
			Platform:       constant.TaskPlatform("plugin"),
		}, nil
	})

	assert.Nil(t, outcome)
	require.NotNil(t, taskErr)
	assert.Equal(t, "task_billing_settlement_failed", taskErr.Code)
	assert.Equal(t, []string{"reserve", "insert", "settle"}, events)
	assert.Zero(t, billing.refunds)
	var count int64
	require.NoError(t, database.Model(&model.Task{}).Where("task_id = ?", "task_public").Count(&count).Error)
	assert.Equal(t, int64(1), count)
	assert.False(t, c.Writer.Written())
}

func TestExecuteTaskSubmissionPersistsPinnedPluginProvenance(t *testing.T) {
	events := make([]string, 0, 3)
	database := setupTaskSubmissionDatabase(t, true, &events)
	previousLogConsumeEnabled := common.LogConsumeEnabled
	common.LogConsumeEnabled = false
	t.Cleanup(func() { common.LogConsumeEnabled = previousLogConsumeEnabled })

	c := taskSubmissionTestContext()
	c.Set(common.RequestIdKey, "request-public")
	c.Set(pluginruntime.ContextKeyPinnedPlugin, pluginruntime.PinnedPlugin{
		Generation: &pluginruntime.RoutingGeneration{Number: 42},
		Plugin: &pluginruntime.LoadedPlugin{Meta: pluginruntime.Meta{
			Key:        "document-parser",
			Name:       "Document Parser",
			Version:    "1.2.3",
			APIVersion: 1,
			Author: pluginruntime.AuthorMeta{
				Name: "Community Author",
				URL:  "https://plugins.example/author",
			},
		}},
	})
	billing := &taskSubmissionTestBilling{events: &events}
	info := taskSubmissionRelayInfo(billing)

	outcome, taskErr := executeTaskSubmissionWith(c, info, func(*gin.Context, *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
		return &relay.TaskSubmitResult{
			UpstreamTaskID: "upstream-private",
			Platform:       constant.TaskPlatform("document-parser"),
		}, nil
	})

	require.Nil(t, taskErr)
	require.NotNil(t, outcome)
	require.NotNil(t, outcome.Task.PrivateData.Execution)
	require.NotNil(t, outcome.Task.PrivateData.Execution.TaskPlugin)
	assert.Equal(t, "request-public", outcome.Task.PrivateData.Execution.RequestID)
	assert.Equal(t, "/plugin/submit", outcome.Task.PrivateData.Execution.RequestPath)
	assert.Equal(t, "1.2.3", outcome.Task.PrivateData.Execution.TaskPlugin.Version)
	assert.Equal(t, uint64(42), outcome.Task.PrivateData.Execution.TaskPlugin.Generation)
	require.NotNil(t, outcome.Task.PrivateData.Execution.TaskPlugin.Author)
	assert.Equal(t, "Community Author", outcome.Task.PrivateData.Execution.TaskPlugin.Author.Name)
	assert.Equal(t, "https://plugins.example/author", outcome.Task.PrivateData.Execution.TaskPlugin.Author.URL)

	var stored model.Task
	require.NoError(t, database.Where("task_id = ?", "task_public").First(&stored).Error)
	require.NotNil(t, stored.PrivateData.Execution)
	require.NotNil(t, stored.PrivateData.Execution.TaskPlugin)
	assert.Equal(t, "document-parser", stored.PrivateData.Execution.TaskPlugin.Key)
	require.NotNil(t, stored.PrivateData.Execution.TaskPlugin.Author)
	assert.Equal(t, "Community Author", stored.PrivateData.Execution.TaskPlugin.Author.Name)
	assert.Equal(t, "upstream-private", stored.PrivateData.UpstreamTaskID)
}

// A submit route declaring retainResult: false persists the task row for
// billing but never writes the upstream snapshot for an immediate terminal
// result, while the in-memory task still carries it for the presenter. An
// asynchronous result on the same route is retained because polling and
// retrieval depend on it.
func TestExecuteTaskSubmissionHonorsRouteRetainResult(t *testing.T) {
	retainFalse := false
	for _, tc := range []struct {
		name          string
		immediate     *relaycommon.TaskInfo
		wantDiscarded bool
	}{
		{"immediate success is discarded", &relaycommon.TaskInfo{Status: model.TaskStatusSuccess, Progress: "100%"}, true},
		{"immediate failure is discarded", &relaycommon.TaskInfo{Status: model.TaskStatusFailure, Reason: "rejected"}, true},
		{"asynchronous result is retained", nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			events := make([]string, 0, 3)
			database, _ := openTaskDialectDatabase(t, &model.Task{}, &model.User{}, &model.Channel{})
			previousDB := model.DB
			model.DB = database
			t.Cleanup(func() { model.DB = previousDB })
			previousLogConsumeEnabled := common.LogConsumeEnabled
			common.LogConsumeEnabled = false
			t.Cleanup(func() { common.LogConsumeEnabled = previousLogConsumeEnabled })

			c := taskSubmissionTestContext()
			c.Set(pluginruntime.ContextKeyPinnedRoute, pluginruntime.PinnedRoute{
				Plugin: &pluginruntime.LoadedPlugin{Meta: pluginruntime.Meta{Key: "sync-images"}},
				Route:  pluginruntime.Route{Method: http.MethodPost, Path: "/sync/images", Type: pluginruntime.RouteTypeSubmit, RetainResult: &retainFalse},
			})
			info := taskSubmissionRelayInfo(&taskSubmissionTestBilling{events: &events})
			upstream := []byte(`{"data":[{"url":"https://cdn.example/a.png"}]}`)

			outcome, taskErr := executeTaskSubmissionWith(c, info, func(*gin.Context, *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
				return &relay.TaskSubmitResult{
					UpstreamTaskID: "task_public",
					Platform:       constant.TaskPlatform("sync-images"),
					TaskData:       upstream,
					Immediate:      tc.immediate,
				}, nil
			})
			require.Nil(t, taskErr)
			require.NotNil(t, outcome)
			assert.JSONEq(t, string(upstream), string(outcome.Task.Data), "presenter keeps the in-memory snapshot")
			assert.Equal(t, tc.wantDiscarded, outcome.Task.PrivateData.ResultDiscarded)
			assert.Equal(t, !tc.wantDiscarded, outcome.Task.ResultRetrievable())

			var stored model.Task
			require.NoError(t, database.Where("task_id = ?", "task_public").First(&stored).Error)
			assert.Equal(t, tc.wantDiscarded, stored.PrivateData.ResultDiscarded)
			var nullCount int64
			require.NoError(t, database.Model(&model.Task{}).Where("task_id = ? AND data IS NULL", "task_public").Count(&nullCount).Error)
			if tc.wantDiscarded {
				assert.Equal(t, int64(1), nullCount, "snapshot column must stay NULL")
				artifacts, err := projectTaskArtifacts(&stored)
				require.NoError(t, err)
				assert.Empty(t, artifacts)
			} else {
				assert.Equal(t, int64(0), nullCount)
				assert.JSONEq(t, string(upstream), string(stored.Data))
			}
			listed := model.TaskGetAllUserTask(1, 0, 10, model.SyncTaskQueryParams{})
			require.Len(t, listed, 1)
			assert.Empty(t, listed[0].Data, "task lists never select the snapshot column")
		})
	}
}

func TestExecuteTaskSubmissionRefundsCancellationBeforeDurableBarrier(t *testing.T) {
	events := make([]string, 0, 2)
	setupTaskSubmissionDatabase(t, true, &events)
	billing := &taskSubmissionTestBilling{events: &events}
	c := taskSubmissionTestContext()
	requestContext, cancel := context.WithCancel(c.Request.Context())
	c.Request = c.Request.WithContext(requestContext)
	info := taskSubmissionRelayInfo(billing)

	outcome, taskErr := executeTaskSubmissionWith(c, info, func(*gin.Context, *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
		cancel()
		return &relay.TaskSubmitResult{
			UpstreamTaskID: "upstream_private",
			Platform:       constant.TaskPlatform("plugin"),
		}, nil
	})

	assert.Nil(t, outcome)
	require.NotNil(t, taskErr)
	assert.Equal(t, "request_cancelled", taskErr.Code)
	assert.Equal(t, []string{"refund"}, events)
	assert.Equal(t, 1, billing.refunds)
	assert.False(t, c.Writer.Written())
}

func TestExecuteTaskSubmissionDisconnectBeforeUpstreamAcceptanceSkipsSubmitAndRefunds(t *testing.T) {
	events := make([]string, 0, 1)
	setupTaskSubmissionDatabase(t, true, &events)
	billing := &taskSubmissionTestBilling{events: &events}
	c := taskSubmissionTestContext()
	requestContext, cancel := context.WithCancel(c.Request.Context())
	cancel()
	c.Request = c.Request.WithContext(requestContext)
	info := taskSubmissionRelayInfo(billing)
	submitted := false

	outcome, taskErr := executeTaskSubmissionWith(c, info, func(*gin.Context, *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
		submitted = true
		return nil, nil
	})

	assert.Nil(t, outcome)
	require.NotNil(t, taskErr)
	assert.Equal(t, "request_cancelled", taskErr.Code)
	assert.False(t, submitted)
	assert.Equal(t, []string{"refund"}, events)
	assert.Equal(t, 1, billing.refunds)
	assert.False(t, c.Writer.Written())
}

func TestExecuteTaskSubmissionCallerCancellationDuringSubmitRefundsBeforeDurableBarrier(t *testing.T) {
	events := make([]string, 0, 1)
	setupTaskSubmissionDatabase(t, true, &events)
	billing := &taskSubmissionTestBilling{events: &events}
	c := taskSubmissionTestContext()
	requestContext, cancel := context.WithCancel(c.Request.Context())
	c.Request = c.Request.WithContext(requestContext)
	info := taskSubmissionRelayInfo(billing)
	submitStarted := make(chan struct{})
	done := make(chan struct{})
	var outcome *taskSubmissionOutcome
	var taskErr *dto.TaskError

	go func() {
		defer close(done)
		outcome, taskErr = executeTaskSubmissionWith(c, info, func(c *gin.Context, _ *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
			close(submitStarted)
			<-c.Request.Context().Done()
			return nil, service.TaskErrorWrapperLocal(c.Request.Context().Err(), "do_request_failed", http.StatusInternalServerError)
		})
	}()
	select {
	case <-submitStarted:
	case <-time.After(2 * time.Second):
		require.FailNow(t, "submission did not start")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		require.FailNow(t, "submission did not stop after disconnect")
	}

	assert.Nil(t, outcome)
	require.NotNil(t, taskErr)
	assert.Equal(t, "request_cancelled", taskErr.Code)
	assert.Equal(t, []string{"refund"}, events)
	assert.Equal(t, 1, billing.refunds)
	assert.False(t, c.Writer.Written())
}

func TestExecuteTaskSubmissionDisconnectAfterDurableInsertDoesNotRefund(t *testing.T) {
	events := make([]string, 0, 3)
	database := setupTaskSubmissionDatabase(t, true, &events)
	previousLogConsumeEnabled := common.LogConsumeEnabled
	common.LogConsumeEnabled = false
	t.Cleanup(func() { common.LogConsumeEnabled = previousLogConsumeEnabled })
	c := taskSubmissionTestContext()
	requestContext, cancel := context.WithCancel(c.Request.Context())
	c.Request = c.Request.WithContext(requestContext)
	billing := &taskSubmissionTestBilling{
		events:   &events,
		onSettle: cancel,
	}
	info := taskSubmissionRelayInfo(billing)

	outcome, taskErr := executeTaskSubmissionWith(c, info, func(*gin.Context, *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
		return &relay.TaskSubmitResult{
			UpstreamTaskID: "upstream_private",
			Platform:       constant.TaskPlatform("plugin"),
		}, nil
	})

	require.Nil(t, taskErr)
	require.NotNil(t, outcome)
	assert.Equal(t, "task_public", outcome.Task.TaskID)
	assert.Equal(t, []string{"reserve", "insert", "settle"}, events)
	assert.Zero(t, billing.refunds)
	var count int64
	require.NoError(t, database.Model(&model.Task{}).Where("task_id = ?", "task_public").Count(&count).Error)
	assert.Equal(t, int64(1), count)
	assert.False(t, c.Writer.Written())
}

// setupTaskSubmissionDatabase opens the dialect selected by
// TEST_TASK_DB_DIALECT (SQLite in memory by default) and records every task
// INSERT in events so tests can assert the reserve → insert → settle order.
// Without migrate the task table does not exist and inserts fail.
func setupTaskSubmissionDatabase(t *testing.T, migrate bool, events *[]string) *gorm.DB {
	t.Helper()
	previousDB := model.DB
	var models []any
	if migrate {
		models = append(models, &model.Task{})
	}
	database, _ := openTaskDialectDatabase(t, models...)
	require.NoError(t, database.Callback().Create().Before("gorm:create").Register("test:task-submit-order", func(*gorm.DB) {
		*events = append(*events, "insert")
	}))
	model.DB = database
	t.Cleanup(func() { model.DB = previousDB })
	return database
}

func taskSubmissionTestContext() *gin.Context {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/plugin/submit", strings.NewReader(`{}`))
	return c
}

func taskSubmissionRelayInfo(billing relaycommon.BillingSettler) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		UserId:          1,
		UsingGroup:      "default",
		OriginModelName: "plugin-model",
		Billing:         billing,
		TaskRelayInfo: &relaycommon.TaskRelayInfo{
			PublicTaskID:  "task_public",
			LockedChannel: &model.Channel{Id: 1, Type: constant.ChannelTypeTaskPlugin, Name: "plugin"},
		},
		ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 1, ChannelType: constant.ChannelTypeTaskPlugin},
	}
}

// Uses the real submit adaptor, expression evaluator, BillingSession, task row
// and consume log. Set TEST_TASK_DB_DIALECT plus TEST_MYSQL_DSN or
// TEST_POSTGRES_DSN to exercise the same contract on an external test database.
// Unique table prefixes keep the fixture isolated from all existing tables.
// openTaskDialectDatabase opens the engine selected by TEST_TASK_DB_DIALECT
// (default SQLite in memory; MySQL and PostgreSQL through TEST_MYSQL_DSN and
// TEST_POSTGRES_DSN) with a unique table prefix, migrates the given models and
// drops them on cleanup. It logs the engine version so database verification
// runs leave a record.
func openTaskDialectDatabase(t *testing.T, models ...any) (*gorm.DB, common.DatabaseType) {
	t.Helper()
	dialect := common.DatabaseType(os.Getenv("TEST_TASK_DB_DIALECT"))
	var driver gorm.Dialector
	switch dialect {
	case "", common.DatabaseTypeSQLite:
		dialect = common.DatabaseTypeSQLite
		driver = sqlite.Open(":memory:")
	case common.DatabaseTypeMySQL:
		require.NotEmpty(t, os.Getenv("TEST_MYSQL_DSN"))
		driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
	case common.DatabaseTypePostgreSQL:
		require.NotEmpty(t, os.Getenv("TEST_POSTGRES_DSN"))
		driver = postgres.New(postgres.Config{DSN: os.Getenv("TEST_POSTGRES_DSN"), PreferSimpleProtocol: true})
	default:
		t.Fatalf("unsupported test dialect %q", dialect)
	}
	db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: fmt.Sprintf("tsubmit_%d_", time.Now().UnixNano())}})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(models...))
	t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(models...)) })
	var version string
	if dialect == common.DatabaseTypeSQLite {
		require.NoError(t, db.Raw("SELECT sqlite_version()").Scan(&version).Error)
	} else {
		require.NoError(t, db.Raw("SELECT version()").Scan(&version).Error)
	}
	t.Logf("database: %s %s", dialect, version)
	return db, dialect
}

func TestImmediateTaskSettlementDatabase(t *testing.T) {
	db, dialect := openTaskDialectDatabase(t, &model.User{}, &model.Channel{}, &model.Task{}, &model.Log{})
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	oldRedis, oldMemory, oldBatch, oldConsume, oldExport := common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled, common.DataExportEnabled
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(dialect, dialect)
	common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled, common.DataExportEnabled = false, false, false, true, false
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetDatabaseTypes(oldMain, oldLog)
		common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled, common.DataExportEnabled = oldRedis, oldMemory, oldBatch, oldConsume, oldExport
	})

	const expression = `u("units") == 7 ? tier("missing", u("missing") * 1.0) : u("units") == 8 ? tier("invalid", -1.0) : u("units") > 3 ? tier("bulk", u("units") * 0.01) : tier("small", u("units") * 0.01)`
	withTieredBillingConfig(t, map[string]string{"document-model": "tiered_expr"}, map[string]string{"document-model": expression})
	const source = `
export const meta={apiVersion:1,key:"generic-settlement",name:"Generic settlement",version:"1.0.0",author:{name:"Test"},models:["document-model"],fetchMode:"per_task",usageSchema:{units:{type:"number",unit:"count"}}};
export function buildSubmitRequest(ctx){return {url:ctx.baseUrl+"/compile",body:ctx.requestBody};}
export function parseSubmitResponse(ctx,resp){return {taskId:"vendor-job",taskData:resp.body,immediate:{status:resp.body.status,reason:"provider rejected job"}};}
export function extractUsage(){return {units:4};}
export function extractUsageOnComplete(ctx,result,body){return body.usage;}
export function parseTaskResult(){throw new Error("completed submissions must not poll");}
export function buildQueryRequest(){throw new Error("completed submissions must not poll");}
`
	plugin, err := pluginruntime.CompilePlugin(source, pluginruntime.Options{})
	require.NoError(t, err)
	for index, tc := range []struct {
		name, status string
		actual       any
		count        float64
	}{
		{"partial", "SUCCESS", 2, 2}, {"zero", "SUCCESS", 0, 0}, {"larger", "SUCCESS", 6, 6},
		{"invalid usage", "SUCCESS", -1, 4}, {"expression failure", "SUCCESS", 7, 4}, {"negative result", "SUCCESS", 8, 4}, {"missing usage", "SUCCESS", nil, 4}, {"failed", "FAILURE", 9, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				body := map[string]any{"status": tc.status}
				if tc.actual != nil {
					body["usage"] = map[string]any{"units": tc.actual}
				}
				encoded, err := common.Marshal(body)
				if err != nil {
					panic(err)
				}
				_, _ = w.Write(encoded)
			}))
			defer server.Close()
			initial := int(20 * common.QuotaPerUnit)
			user := model.User{Username: fmt.Sprintf("task_user_%d", index), AffCode: fmt.Sprintf("task_aff_%d", index), Quota: initial}
			require.NoError(t, db.Create(&user).Error)
			ch := model.Channel{Name: "test provider", Type: constant.ChannelTypeTaskPlugin}
			require.NoError(t, db.Create(&ch).Error)
			c := taskSubmissionTestContext()
			c.Set("group", "default")
			c.Set("username", user.Username)
			c.Set("task_request", map[string]any{"model": "document-model"})
			c.Set(pluginruntime.ContextKeyPinnedPlugin, pluginruntime.PinnedPlugin{Plugin: plugin})
			common.SetContextKey(c, constant.ContextKeyOriginalModel, "document-model")
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, server.URL)
			common.SetContextKey(c, constant.ContextKeyChannelId, ch.Id)
			common.SetContextKey(c, constant.ContextKeyChannelType, ch.Type)
			info := taskSubmissionRelayInfo(nil)
			info.UserId = user.Id
			info.OriginModelName = "document-model"
			info.UserGroup = "default"
			info.UsingGroup = "default"
			info.IsPlayground = true
			info.UserSetting.BillingPreference = "wallet_only"
			info.PublicTaskID = model.GenerateTaskID()
			info.LockedChannel = &ch
			outcome, taskErr := executeTaskSubmission(c, info)
			require.Nil(t, taskErr)
			require.NotNil(t, outcome)
			want := common.QuotaRound(tc.count * 0.01 * common.QuotaPerUnit)
			assert.Equal(t, want, outcome.Result.Quota)
			assert.Equal(t, want, info.PriceData.Quota)
			var stored model.Task
			require.NoError(t, db.Where("task_id = ?", info.PublicTaskID).First(&stored).Error)
			assert.Equal(t, want, stored.Quota)
			assert.Equal(t, model.TaskStatus(tc.status), stored.Status)
			assert.Positive(t, stored.FinishTime)
			assert.Equal(t, float64(4), info.TieredBillingSnapshot.EstimatedQuotaBeforeGroup/(0.01*common.QuotaPerUnit))
			if tc.status == "SUCCESS" {
				assert.Equal(t, tc.count, stored.PrivateData.BillingContext.TieredSnapshot.UsageFacts["units"])
			}
			var updated model.User
			require.NoError(t, db.First(&updated, user.Id).Error)
			assert.Equal(t, initial-want, updated.Quota)
			assert.Equal(t, want, updated.UsedQuota)
			var logs []model.Log
			require.NoError(t, db.Where("user_id = ?", user.Id).Find(&logs).Error)
			require.Len(t, logs, 1)
			assert.Equal(t, want, logs[0].Quota)
			var other map[string]any
			require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &other))
			if tc.status == "SUCCESS" {
				assert.Equal(t, tc.count, other["usage_facts"].(map[string]any)["units"])
			}
			assert.False(t, c.Writer.Written(), "presentation must follow persistence and settlement")
			require.NoError(t, info.Billing.Settle(want))
			info.Billing.Refund(c)
			require.NoError(t, db.First(&updated, user.Id).Error)
			assert.Equal(t, initial-want, updated.Quota, "terminal settlement is idempotent")
		})
	}
}

func TestAcceptedSubmitStreamNeverRetries(t *testing.T) {
	c := taskSubmissionTestContext()
	assert.Equal(t, service.PolicyDecision{Action: "stop", Reason: "task_accepted", Source: "system"}, decideTaskRetry(c, &dto.TaskError{StatusCode: 502, LocalError: true, NoRetry: true}, 3))
}

// Local task rejections carry a message but no cause; the response and the
// decision record must still be produced.
func TestRespondTaskSubmissionErrorWithoutCause(t *testing.T) {
	previousErrorLog := constant.ErrorLogEnabled
	constant.ErrorLogEnabled = false
	t.Cleanup(func() { constant.ErrorLogEnabled = previousErrorLog })
	c := taskSubmissionTestContext()
	taskErr := &dto.TaskError{Code: "get_channel_failed", Message: "no channel", StatusCode: http.StatusServiceUnavailable, LocalError: true}
	require.NotPanics(t, func() { respondTaskSubmissionError(c, taskErr) })
	assert.Equal(t, http.StatusServiceUnavailable, c.Writer.Status())
	events := service.RequestPolicy(c).Events()
	require.Len(t, events, 1)
	assert.Equal(t, service.PolicyDecision{Action: "stop", Reason: "request_failed", Source: "system"}, events[0].Decision)
	assert.Equal(t, http.StatusServiceUnavailable, events[0].Status)
	assert.Equal(t, service.PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "system"}, decideTaskRetry(c, &dto.TaskError{StatusCode: http.StatusForbidden, LocalError: true, Message: "billing"}, 2), "local errors stop once the status rules do not force a retry")
}

func TestExecuteTaskSubmissionRefundsWhenFinalReserveFails(t *testing.T) {
	events := []string{}
	setupTaskSubmissionDatabase(t, true, &events)
	billing := &taskSubmissionTestBilling{events: &events, reserveErr: errors.New("insufficient funds")}
	c := taskSubmissionTestContext()
	info := taskSubmissionRelayInfo(billing)
	outcome, taskErr := executeTaskSubmissionWith(c, info, func(*gin.Context, *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
		return &relay.TaskSubmitResult{Platform: "plugin", Quota: 600, Immediate: &relaycommon.TaskInfo{Status: "SUCCESS"}}, nil
	})
	require.Nil(t, outcome)
	require.NotNil(t, taskErr)
	assert.Equal(t, http.StatusForbidden, taskErr.StatusCode)
	assert.Equal(t, []string{"reserve", "refund"}, events)
	assert.Equal(t, 1, billing.refunds)
	assert.False(t, c.Writer.Written())
}

func TestVideoSubmitWithoutRetries(t *testing.T) {
	service.InitHttpClient()
	oldRetries, oldErrorLog := common.RetryTimes, constant.ErrorLogEnabled
	common.RetryTimes, constant.ErrorLogEnabled = 0, false
	t.Cleanup(func() { common.RetryTimes, constant.ErrorLogEnabled = oldRetries, oldErrorLog })
	withTieredBillingConfig(t, map[string]string{"wan3.0-video": "tiered_expr"}, map[string]string{"wan3.0-video": `tier("base", u("seconds") * 0.1)`})
	source, err := os.ReadFile("../zhimeng/plugin.js")
	require.NoError(t, err)
	registry := pluginruntime.NewRegistry()
	plugin, err := registry.RegisterFactory(string(source), pluginruntime.Options{})
	require.NoError(t, err)
	binding, found := registry.Generation().LookupEndpoint("POST", "/v1/videos", "wan3.0-video")
	require.True(t, found)
	for _, tc := range []struct {
		name     string
		requests int
	}{
		{"invalid JSON after acceptance", 1},
		{"missing task ID after acceptance", 1},
		{"truncated response after acceptance", 1},
		{"disconnect after reading request", 1},
		{"provider server error", 1},
		{"explicit rate limit", 1},
		{"connection refused", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				_, _ = io.Copy(io.Discard, r.Body)
				w.Header().Set("Content-Type", "application/json")
				switch tc.name {
				case "disconnect after reading request":
					conn, _, hijackErr := w.(http.Hijacker).Hijack()
					if hijackErr != nil {
						t.Error(hijackErr)
						return
					}
					_ = conn.Close()
				case "invalid JSON after acceptance":
					_, _ = io.WriteString(w, `{`)
				case "missing task ID after acceptance":
					_, _ = io.WriteString(w, `{"status":"queued"}`)
				case "truncated response after acceptance":
					w.Header().Set("Content-Length", "1000")
					_, _ = io.WriteString(w, `{"id":"accepted"`)
				case "provider server error":
					w.WriteHeader(http.StatusBadGateway)
				case "explicit rate limit":
					if requests.Load() == 1 {
						w.WriteHeader(http.StatusTooManyRequests)
					} else {
						w.WriteHeader(http.StatusBadRequest)
					}
				}
			}))
			t.Cleanup(server.Close)
			if tc.name == "connection refused" {
				server.Close()
			}
			events := []string{}
			billing := &taskSubmissionTestBilling{events: &events}
			c := taskSubmissionTestContext()
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"model":"wan3.0-video","prompt":"cat","duration":2,"resolution":"480P","ratio":"16:9"}`))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Set("group", "default")
			c.Set("task_request", map[string]any{"model": "wan3.0-video", "prompt": "cat", "duration": 2, "resolution": "480P", "ratio": "16:9"})
			c.Set(pluginruntime.ContextKeyPinnedPlugin, pluginruntime.PinnedPlugin{Generation: registry.Generation(), Plugin: plugin})
			c.Set(pluginruntime.ContextKeyPinnedEndpoint, pluginruntime.PinnedEndpoint{Generation: registry.Generation(), Plugin: plugin, Protocol: "openai_video", Model: "wan3.0-video", Operation: binding.Operation, Candidates: []pluginruntime.ProtocolBinding{binding}})
			channel := &model.Channel{Id: 1, Name: "video", Type: constant.ChannelTypeTaskPlugin, Key: "test-key", BaseURL: common.GetPointer(server.URL), Status: common.ChannelStatusEnabled}
			channel.Setting = common.GetPointer(`{"task_plugin_key":"zhimeng"}`)
			info := taskSubmissionRelayInfo(billing)
			info.OriginModelName, info.UserGroup = "wan3.0-video", "default"
			info.LockedChannel = channel
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, server.URL)
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeTaskPlugin)
			var attempts int
			_, taskErr := executeTaskSubmissionWith(c, info, func(c *gin.Context, info *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
				attempts++
				return relay.RelayTaskSubmit(c, info)
			})
			require.NotNil(t, taskErr)
			assert.Equal(t, 1, attempts)
			assert.Equal(t, int32(tc.requests), requests.Load())
			assert.Equal(t, 1, billing.refunds)
		})
	}
}

func TestWAN3AsynchronousLifecycle(t *testing.T) {
	service.InitHttpClient()
	// Keep asynchronous telemetry outside the billing fixture lifetime.
	metricsEnabled := perf_metrics_setting.GetSetting().Enabled
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{"perf_metrics_setting.enabled": "false"}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{"perf_metrics_setting.enabled": fmt.Sprint(metricsEnabled)}))
	})
	db, dialect := openTaskDialectDatabase(t, &model.User{}, &model.Channel{}, &model.Task{}, &model.Log{})
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	oldRedis, oldMemory, oldBatch, oldConsume, oldExport := common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled, common.DataExportEnabled
	oldAdaptor := service.GetTaskAdaptorFunc
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(dialect, dialect)
	common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled, common.DataExportEnabled = false, false, false, true, false
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetDatabaseTypes(oldMain, oldLog)
		common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled, common.DataExportEnabled = oldRedis, oldMemory, oldBatch, oldConsume, oldExport
		service.GetTaskAdaptorFunc = oldAdaptor
	})
	withTieredBillingConfig(t, map[string]string{"wan3.0-video": "tiered_expr", "sd-2-c4": "tiered_expr", "sd-2-c5": "tiered_expr"}, map[string]string{
		"wan3.0-video": `u("resolution") == "480P" ? tier("480P", u("seconds") * 0.1) : tier("higher", u("seconds") * 0.2)`,
		"sd-2-c4":      `tier("base", u("video_count") * 0.1)`, "sd-2-c5": `tier("base", u("video_count") * 0.1)`,
	})
	for _, key := range []string{"zhimeng", "rolldek"} {
		source, err := os.ReadFile("../" + key + "/plugin.js")
		require.NoError(t, err)
		plugin, err := pluginruntime.NewRegistry().RegisterFactory(string(source), pluginruntime.Options{})
		require.NoError(t, err)
		service.GetTaskAdaptorFunc = func(constant.TaskPlatform) service.TaskPollingAdaptor { return taskplugin.New(plugin) }
		for index, tc := range []struct {
			name, status            string
			actual                  any
			seconds                 float64
			input                   float64
			duration                int
			modelName               string
			media                   []any
			pluginKey               string
			missingReferenceBilling bool
			completeFirst           bool
		}{
			{name: "success", status: "completed", actual: 2, seconds: 2, duration: 5},
			{name: "missing usage", status: "completed", seconds: 5, duration: 5},
			{name: "invalid usage", status: "completed", actual: -1, seconds: 5, duration: 5},
			{name: "failed", status: "failed", actual: 2, duration: 5},
			{name: "reference input over fifteen seconds", status: "completed", actual: 2, seconds: 18, input: 16, duration: 2},
			{name: "reference total over thirty seconds", status: "completed", actual: 20, seconds: 36, input: 16, duration: 20},
			{name: "reference missing usage", status: "completed", seconds: 35, input: 16, duration: 5},
			{name: "reference failure", status: "failed", actual: 2, input: 16, duration: 2},
			{name: "verified reference input", pluginKey: "zhimeng", status: "completed", actual: 2, seconds: 5.019, input: 3.019, duration: 2},
			{name: "reference completes on first poll", pluginKey: "zhimeng", status: "completed", actual: 2, seconds: 5.019, input: 3.019, duration: 2, completeFirst: true},
			{name: "reference billing unavailable", pluginKey: "zhimeng", status: "completed", actual: 2, seconds: 17, input: 3.019, duration: 2, missingReferenceBilling: true},
			{name: "reference output unavailable", pluginKey: "zhimeng", status: "completed", seconds: 17, input: 3.019, duration: 2},
			{name: "reference invalid total", pluginKey: "zhimeng", status: "completed", actual: 30, seconds: 17, input: 3.019, duration: 2},
			{name: "reference upper reservation", pluginKey: "zhimeng", status: "completed", actual: 20, seconds: 23.019, input: 3.019, duration: 20},
			{name: "reference failed refund", pluginKey: "zhimeng", status: "failed", actual: 2, input: 3.019, duration: 2},
			{name: "first frame", status: "completed", actual: 2, seconds: 2, duration: 5, media: []any{map[string]any{"type": "first_frame", "url": "https://example.com/first.png"}}},
			{name: "first and last frame missing usage", status: "completed", seconds: 5, duration: 5, media: []any{map[string]any{"type": "first_frame", "url": "https://example.com/first.png"}, map[string]any{"type": "last_frame", "url": "https://example.com/last.png"}}},
			{name: "first frame failure", status: "failed", duration: 5, media: []any{map[string]any{"type": "first_frame", "url": "https://example.com/first.png"}}},
			{name: "Seedance c4 short success", modelName: "sd-2-c4", status: "completed", actual: 15, seconds: 1, duration: 4},
			{name: "Seedance c5 long missing usage", modelName: "sd-2-c5", status: "completed", seconds: 1, duration: 15, media: []any{map[string]any{"type": "reference_video", "url": "https://example.com/reference.mp4"}, map[string]any{"type": "reference_audio", "url": "https://example.com/audio.wav"}}},
			{name: "Seedance c5 failure", modelName: "sd-2-c5", status: "failed", duration: 4},
		} {
			if (tc.pluginKey != "" && tc.pluginKey != key) || (tc.input > 0 && tc.pluginKey == "" && key != "rolldek") || (tc.modelName != "" && key != "zhimeng") {
				continue
			}
			t.Run(key+"/"+tc.name, func(t *testing.T) {
				modelName, resolution := "wan3.0-video", "480P"
				if tc.modelName != "" {
					modelName, resolution = tc.modelName, "720P"
				}
				var submissions atomic.Int32
				var queries atomic.Int32
				var billingQueries atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					assert.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
					w.Header().Set("Content-Type", "application/json")
					if r.URL.Path == "/api/log/token/" {
						http.Redirect(w, r, "/api/log/token", http.StatusMovedPermanently)
						return
					}
					if r.URL.Path == "/api/log/token" {
						billingQueries.Add(1)
						rows := []any{}
						if !tc.missingReferenceBilling && queries.Load() <= 1 {
							other, marshalErr := common.Marshal(map[string]any{"is_task": true, "task_id": "vendor-job", "reference_video_charge": map[string]any{"seconds": tc.input, "resolution": resolution, "video_count": 1}})
							if !assert.NoError(t, marshalErr) {
								return
							}
							rows = append(rows, map[string]any{"type": 2, "model_name": modelName, "other": string(other)})
						}
						encoded, marshalErr := common.Marshal(map[string]any{"success": true, "data": rows})
						if !assert.NoError(t, marshalErr) {
							return
						}
						_, _ = w.Write(encoded)
						return
					}
					if r.Method == http.MethodPost {
						submissions.Add(1)
						var body map[string]any
						if !assert.NoError(t, common.DecodeJson(r.Body, &body)) {
							w.WriteHeader(http.StatusBadRequest)
							return
						}
						if tc.modelName != "" {
							assert.Len(t, body, 3)
							assert.Equal(t, modelName, body["model"])
							assert.Equal(t, map[string]any{"duration": float64(tc.duration), "resolution": "720p", "ratio": "16:9"}, body["parameters"])
						}
						_, _ = io.WriteString(w, `{"id":"vendor-job","status":"queued"}`)
						return
					}
					assert.Equal(t, "/v1/videos/vendor-job", r.URL.Path)
					if queries.Add(1) == 1 && !tc.completeFirst {
						_, _ = io.WriteString(w, `{"status":"in_progress","progress":50}`)
						return
					}
					body := map[string]any{"status": tc.status, "content": map[string]any{"url": "https://cdn.example/video.mp4"}, "metadata": map[string]any{"url": "https://cdn.example/video.mp4"}, "error": nil}
					if tc.actual != nil {
						body["seconds"] = tc.actual
						body["usage"] = map[string]any{"output_video_duration": tc.actual, "input_video_duration": tc.input}
						if key == "rolldek" {
							body["metadata"].(map[string]any)["usage"] = body["usage"]
							delete(body, "usage")
						}
					}
					encoded, marshalErr := common.Marshal(body)
					if marshalErr != nil {
						t.Error(marshalErr)
						return
					}
					_, _ = w.Write(encoded)
				}))
				t.Cleanup(server.Close)
				initial := common.QuotaRound(20 * common.QuotaPerUnit)
				user := model.User{Username: fmt.Sprintf("%s_user_%d", key, index), AffCode: fmt.Sprintf("%s_aff_%d", key, index), Quota: initial}
				require.NoError(t, db.Create(&user).Error)
				channel := model.Channel{Name: key, Type: constant.ChannelTypeTaskPlugin, Key: "test-key", BaseURL: common.GetPointer(server.URL), Status: common.ChannelStatusEnabled}
				channel.Setting = common.GetPointer(`{"task_plugin_key":"` + key + `"}`)
				require.NoError(t, db.Create(&channel).Error)
				c := taskSubmissionTestContext()
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{}`))
				c.Set("group", "default")
				c.Set("username", user.Username)
				request := map[string]any{"model": modelName, "prompt": "cat", "duration": tc.duration, "resolution": resolution, "ratio": "16:9"}
				estimatedSeconds := tc.duration
				if tc.media != nil {
					request["metadata"] = map[string]any{"input": map[string]any{"media": tc.media}}
				}
				if tc.input > 0 {
					request["metadata"] = map[string]any{"input": map[string]any{"media": []any{map[string]any{"type": "reference_video", "url": "https://example.com/reference.mp4"}}}}
					estimatedSeconds += 30
					if key == "zhimeng" {
						estimatedSeconds = min(tc.duration+15, 30)
					}
				}
				if tc.modelName != "" {
					estimatedSeconds = 1
				}
				c.Set("task_request", request)
				c.Set(pluginruntime.ContextKeyPinnedPlugin, pluginruntime.PinnedPlugin{Plugin: plugin})
				c.Set(pluginruntime.ContextKeyPinnedEndpoint, pluginruntime.PinnedEndpoint{Plugin: plugin, Protocol: "openai_video", Model: modelName})
				common.SetContextKey(c, constant.ContextKeyOriginalModel, modelName)
				common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, server.URL)
				common.SetContextKey(c, constant.ContextKeyChannelKey, "test-key")
				common.SetContextKey(c, constant.ContextKeyChannelId, channel.Id)
				common.SetContextKey(c, constant.ContextKeyChannelType, channel.Type)
				c.Request.Header.Set("Authorization", "Bearer test-key")
				info := taskSubmissionRelayInfo(nil)
				info.UserId, info.OriginModelName, info.UserGroup = user.Id, modelName, "default"
				info.IsPlayground, info.UserSetting.BillingPreference = true, "wallet_only"
				info.PublicTaskID, info.LockedChannel = model.GenerateTaskID(), &channel
				outcome, taskErr := executeTaskSubmission(c, info)
				require.Nil(t, taskErr, "%+v", taskErr)
				require.NotNil(t, outcome)
				var task model.Task
				require.NoError(t, db.Where("task_id = ?", info.PublicTaskID).First(&task).Error)
				assert.JSONEq(t, string(outcome.Result.PluginState), string(task.PrivateData.PluginState))
				assert.Equal(t, modelName, task.Properties.OriginModelName)
				assert.Equal(t, modelName, task.Properties.UpstreamModelName)
				assert.Equal(t, common.QuotaRound(float64(estimatedSeconds)*0.1*common.QuotaPerUnit), task.Quota)
				ids := map[int][]string{channel.Id: {"vendor-job"}}
				require.NoError(t, service.UpdateVideoTasks(t.Context(), constant.TaskPlatform(key), ids, map[string]*model.Task{"vendor-job": &task}))
				require.NoError(t, db.First(&task, task.ID).Error)
				if !tc.completeFirst {
					assert.Equal(t, model.TaskStatus(model.TaskStatusInProgress), task.Status)
					if key != "zhimeng" || tc.input == 0 {
						assert.JSONEq(t, string(outcome.Result.PluginState), string(task.PrivateData.PluginState))
					} else if !tc.missingReferenceBilling {
						assert.Contains(t, string(task.PrivateData.PluginState), `"referenceVideoBilling"`)
					}
					require.NoError(t, service.UpdateVideoTasks(t.Context(), constant.TaskPlatform(key), ids, map[string]*model.Task{"vendor-job": &task}))
					require.NoError(t, db.First(&task, task.ID).Error)
				}
				want := common.QuotaRound(tc.seconds * 0.1 * common.QuotaPerUnit)
				assert.Equal(t, want, task.Quota)
				if tc.status == "failed" {
					assert.Equal(t, model.TaskStatus(model.TaskStatusFailure), task.Status)
				} else {
					assert.Equal(t, model.TaskStatus(model.TaskStatusSuccess), task.Status)
				}
				var updated model.User
				require.NoError(t, db.First(&updated, user.Id).Error)
				assert.Equal(t, initial-want, updated.Quota)
				assert.Equal(t, want, updated.UsedQuota)
				var logs []model.Log
				require.NoError(t, db.Where("user_id = ?", user.Id).Find(&logs).Error)
				for _, log := range logs {
					assert.Equal(t, modelName, log.ModelName)
					assert.Equal(t, channel.Id, log.ChannelId)
					assert.NotContains(t, log.Other, "test-key")
				}
				logCount := len(logs)
				require.NoError(t, service.UpdateVideoTasks(t.Context(), constant.TaskPlatform(key), ids, map[string]*model.Task{"vendor-job": &task}))
				require.NoError(t, db.First(&updated, user.Id).Error)
				assert.Equal(t, initial-want, updated.Quota, "duplicate completion must not charge or refund again")
				var count int64
				require.NoError(t, db.Model(&model.Log{}).Where("user_id = ?", user.Id).Count(&count).Error)
				assert.Equal(t, int64(logCount), count)
				assert.Equal(t, int32(1), submissions.Load())
				if key == "zhimeng" && tc.input > 0 && !tc.missingReferenceBilling {
					assert.Equal(t, int32(2), billingQueries.Load(), "preflight plus one measured-input lookup; persisted input survives log eviction")
				}
			})
		}
	}
}

func TestZhimengSeedanceContent(t *testing.T) {
	fixture := setupGenericTaskTest(t)
	allowPrivateTaskMediaTest(t)
	source, err := os.ReadFile("../zhimeng/plugin.js")
	require.NoError(t, err)
	plugin, err := pluginruntime.NewRegistry().RegisterFactory(string(source), pluginruntime.Options{})
	require.NoError(t, err)
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		assert.Empty(t, request.Header.Get("Authorization"))
		assert.Empty(t, request.Header.Get("Cookie"))
		assert.Equal(t, "bytes=0-3", request.Header.Get("Range"))
		response.Header().Set("Content-Type", "video/mp4")
		response.Header().Set("Content-Range", "bytes 0-3/10")
		response.WriteHeader(http.StatusPartialContent)
		if request.Method == http.MethodGet {
			_, _ = io.WriteString(response, "data")
		}
	}))
	t.Cleanup(upstream.Close)
	adaptor := taskplugin.New(plugin)
	adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: "https://provider.example", ApiKey: "provider-key", ChannelType: constant.ChannelTypeTaskPlugin}})
	for _, modelName := range []string{"sd-2-c4", "sd-2-c5"} {
		state, err := common.Marshal(map[string]any{"model": modelName, "duration": 4, "resolution": "720P", "hasReferenceVideo": false})
		require.NoError(t, err)
		task := &model.Task{TaskID: "public-job", ChannelId: fixture.ChannelId, Status: model.TaskStatusSuccess, Properties: model.Properties{OriginModelName: modelName, UpstreamModelName: modelName}, PrivateData: model.TaskPrivateData{UpstreamTaskID: "vendor-job", PluginState: state}}
		for _, body := range []map[string]any{
			{"status": "completed", "content": map[string]any{"url": upstream.URL + "/video.mp4"}},
			{"status": "completed", "object": upstream.URL + "/video.mp4"},
		} {
			task.Data, err = common.Marshal(body)
			require.NoError(t, err)
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				descriptor, err := adaptor.BuildContentRequest(t.Context(), task, "video", relaychannel.TaskArtifactClientRequest{Method: method})
				require.NoError(t, err)
				require.True(t, descriptor.Credentialless)
				assert.Empty(t, descriptor.Headers)
				assert.Equal(t, upstream.URL+"/video.mp4", descriptor.URL)
				recorder := httptest.NewRecorder()
				ctx, _ := gin.CreateTestContext(recorder)
				ctx.Request = httptest.NewRequest(method, "/v1/videos/public-job/content", nil)
				ctx.Request.Header.Set("Range", "bytes=0-3")
				ctx.Request.Header.Set("Authorization", "Bearer client-key")
				ctx.Request.Header.Set("Cookie", "session=client-cookie")
				require.NoError(t, proxyTaskMedia(ctx, task, descriptor))
				assert.Equal(t, http.StatusPartialContent, recorder.Code)
				assert.Equal(t, "bytes 0-3/10", recorder.Header().Get("Content-Range"))
				if method == http.MethodHead {
					assert.Empty(t, recorder.Body.String())
				} else {
					assert.Equal(t, "data", recorder.Body.String())
				}
			}
		}
		for _, body := range []string{`{"status":"completed"}`, `{"status":"in_progress","content":{"url":"https://cdn.example/early.mp4"}}`} {
			task.Data = []byte(body)
			_, err := adaptor.BuildContentRequest(t.Context(), task, "video", relaychannel.TaskArtifactClientRequest{Method: http.MethodGet})
			require.ErrorContains(t, err, "Seedance video URL is unavailable")
		}
	}
}
