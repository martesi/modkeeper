use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Serialize, Deserialize, Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskOperation {
    Sync,
    Install,
    ForgeInstall,
    CacheRebuild,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskProgressKind {
    Started,
    Progress,
    Completed,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskProgressStage {
    TaskStarted,
    TaskCompleted,
    TaskPartialFailure,
    TaskFailed,
    SyncPlan,
    SyncPreflight,
    SyncCleanup,
    SyncDeploy,
    SyncPersist,
    InstallArchives,
    InstallArchiveStage,
    InstallCommit,
    ForgeMetadata,
    ForgeVersions,
    ForgeDownload,
    ForgeSizeVerification,
    ForgeParentValidation,
    ForgeStage,
    ForgeInstall,
    CacheNormalize,
    CacheScan,
    CachePersist,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskProgressLevel {
    Info,
    Warn,
    Error,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgressLog {
    pub level: TaskProgressLevel,
    pub code: String,
    pub message: String,
}

/// Progress is deliberately separate from WorkspaceEvent, which remains the
/// authoritative completion and workspace refresh event.
#[derive(Serialize, Deserialize, Type, Clone, Debug, PartialEq, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "task_progress")]
pub struct TaskProgressEvent {
    pub task_id: String,
    pub library_id: String,
    pub operation: TaskOperation,
    pub sequence: u32,
    pub kind: TaskProgressKind,
    pub stage: TaskProgressStage,
    pub percent: Option<f64>,
    pub log: Option<TaskProgressLog>,
}
