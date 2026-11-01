use crate::models::error::SError;
use crate::models::mod_dto::ModType;
use crate::store::app_config::AppSettings;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;

/// The full frontend-facing state: every registered library, its mods,
/// and the app settings. Assembled read-only (C13).
#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibraryWorkspace {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_library_id: Option<String>,
    pub libraries: Vec<LibraryEntry>,
    pub mods_by_library_id: BTreeMap<String, Vec<ModSummary>>,
    /// Present-but-empty this pass; the tool registry is deferred (§7d).
    pub tools_by_library_id: BTreeMap<String, Vec<ToolSummary>>,
    pub settings: AppSettings,
    /// One-shot startup config problem for the frontend to toast (C12).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_warning: Option<String>,
}

/// A registered library is either readable (summary) or a path-only stub -
/// never dropped from the list (C13).
#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(untagged)]
pub enum LibraryEntry {
    Summary(LibrarySummary),
    Stub(LibraryStub),
}

/// Registered-but-unreadable; render the bare path, remove-only.
#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStub {
    pub path: String,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySummary {
    pub id: String,
    pub name: String,
    pub game_root: String,
    pub library_root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spt_version: Option<String>,
    pub cache_status: CacheStatus,
    /// Deployed symlinks no longer match recorded state; drives the Sync highlight (C3).
    pub deploy_stale: bool,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatus {
    pub state: CacheState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_rebuilt_at: Option<String>,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CacheState {
    Ready,
    Dirty,
    Rebuilding,
    Failed,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModSummary {
    pub id: String,
    pub library_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub mod_type: ModType,
    pub is_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    pub updated_at: String,
}

/// Defined for forward-compat; unused by live commands this pass (§7d).
#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolSummary {
    pub id: String,
    pub library_id: String,
    pub name: String,
    pub executable_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_args: Option<String>,
    pub updated_at: String,
}

/// Fire-and-track accept signal: sync validation passed, outcome arrives
/// as a WorkspaceEvent matched by taskId (§7e).
#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OperationAccepted {
    pub accepted: bool,
}

impl OperationAccepted {
    pub fn new() -> Self {
        Self { accepted: true }
    }
}

impl Default for OperationAccepted {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveFailure {
    pub archive_path: String,
    pub error: SError,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModFailure {
    pub mod_id: String,
    pub error: SError,
}

// --- Command inputs (§9 API surface) ---

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CreateLibraryInput {
    pub game_root: String,
    pub library_root: Option<String>,
    pub name: Option<String>,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActivateLibraryInput {
    pub library_id: String,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenameLibraryInput {
    pub library_id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLibraryInput {
    pub library_id: String,
    pub delete_files: bool,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BulkModAction {
    Enable,
    Disable,
    Delete,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BulkUpdateModsInput {
    pub library_id: String,
    pub mod_ids: Vec<String>,
    pub action: BulkModAction,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RebuildLibraryCacheInput {
    pub task_id: String,
    pub library_id: String,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstallModArchivesInput {
    pub task_id: String,
    pub library_id: String,
    pub archive_paths: Vec<String>,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncModsInput {
    pub task_id: String,
    pub library_id: String,
}

/// Completion events for the three fire-and-track operations (§7e/§9).
#[derive(Serialize, Deserialize, Type, Clone, Debug, tauri_specta::Event)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkspaceEvent {
    #[serde(rename_all = "camelCase")]
    CacheRebuildCompleted {
        task_id: String,
        library_id: String,
        cache_status: CacheStatus,
        workspace: LibraryWorkspace,
    },
    #[serde(rename_all = "camelCase")]
    ModInstallCompleted {
        task_id: String,
        library_id: String,
        failures: Vec<ArchiveFailure>,
        workspace: LibraryWorkspace,
    },
    #[serde(rename_all = "camelCase")]
    SyncCompleted {
        task_id: String,
        library_id: String,
        failures: Vec<ModFailure>,
        workspace: LibraryWorkspace,
    },
}
