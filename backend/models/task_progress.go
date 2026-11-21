package models

type TaskOperation string

const (
	TaskOperationSync         TaskOperation = "sync"
	TaskOperationInstall      TaskOperation = "install"
	TaskOperationForgeInstall TaskOperation = "forge_install"
	TaskOperationCacheRebuild TaskOperation = "cache_rebuild"
)

type TaskProgressKind string

const (
	TaskProgressStarted   TaskProgressKind = "started"
	TaskProgressProgress  TaskProgressKind = "progress"
	TaskProgressCompleted TaskProgressKind = "completed"
)

type TaskProgressStage string

const (
	TaskStageTaskStarted           TaskProgressStage = "task_started"
	TaskStageTaskCompleted         TaskProgressStage = "task_completed"
	TaskStageTaskPartialFailure    TaskProgressStage = "task_partial_failure"
	TaskStageTaskFailed            TaskProgressStage = "task_failed"
	TaskStageTaskCancelled         TaskProgressStage = "task_cancelled"
	TaskStageSyncPlan              TaskProgressStage = "sync_plan"
	TaskStageSyncPreflight         TaskProgressStage = "sync_preflight"
	TaskStageSyncCleanup           TaskProgressStage = "sync_cleanup"
	TaskStageSyncDeploy            TaskProgressStage = "sync_deploy"
	TaskStageSyncPersist           TaskProgressStage = "sync_persist"
	TaskStageInstallArchives       TaskProgressStage = "install_archives"
	TaskStageInstallArchiveStage   TaskProgressStage = "install_archive_stage"
	TaskStageInstallCommit         TaskProgressStage = "install_commit"
	TaskStageForgeMetadata         TaskProgressStage = "forge_metadata"
	TaskStageForgeVersions         TaskProgressStage = "forge_versions"
	TaskStageForgeDownload         TaskProgressStage = "forge_download"
	TaskStageForgeSizeVerification TaskProgressStage = "forge_size_verification"
	TaskStageForgeParentValidation TaskProgressStage = "forge_parent_validation"
	TaskStageForgeStage            TaskProgressStage = "forge_stage"
	TaskStageForgeInstall          TaskProgressStage = "forge_install"
	TaskStageCacheNormalize        TaskProgressStage = "cache_normalize"
	TaskStageCacheScan             TaskProgressStage = "cache_scan"
	TaskStageCachePersist          TaskProgressStage = "cache_persist"
)

type TaskProgressLevel string

const (
	TaskLevelInfo  TaskProgressLevel = "info"
	TaskLevelWarn  TaskProgressLevel = "warn"
	TaskLevelError TaskProgressLevel = "error"
)

type TaskProgressLog struct {
	Level   TaskProgressLevel `json:"level"`
	Code    string            `json:"code"`
	Message string            `json:"message"`
}

// Pointer fields intentionally serialize as explicit null when absent.
type TaskProgressEvent struct {
	TaskID    string            `json:"taskId"`
	LibraryID string            `json:"libraryId"`
	Operation TaskOperation     `json:"operation"`
	Sequence  uint32            `json:"sequence"`
	Kind      TaskProgressKind  `json:"kind"`
	Stage     TaskProgressStage `json:"stage"`
	Percent   *float64          `json:"percent"`
	Log       *TaskProgressLog  `json:"log"`
}
