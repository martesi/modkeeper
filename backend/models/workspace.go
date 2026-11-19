package models

import (
	"encoding/json"
	"fmt"
	"github.com/martes/modkeeper/backend/config"
)

type LibraryWorkspace struct {
	ActiveLibraryID  *string                  `json:"activeLibraryId,omitempty"`
	Libraries        []LibraryEntry           `json:"libraries"`
	ModsByLibraryID  map[string][]ModSummary  `json:"modsByLibraryId"`
	ToolsByLibraryID map[string][]ToolSummary `json:"toolsByLibraryId"`
	Settings         config.AppSettings       `json:"settings"`
	ConfigWarning    *string                  `json:"configWarning,omitempty"`
}
type OperationAccepted struct {
	Accepted bool `json:"accepted"`
}
type ArchiveFailure struct {
	ArchivePath string `json:"archivePath"`
	Error       Error  `json:"error"`
}
type ModFailure struct {
	ModID string `json:"modId"`
	Error Error  `json:"error"`
}
type CreateLibraryInput struct {
	GameRoot    string  `json:"gameRoot"`
	LibraryRoot *string `json:"libraryRoot"`
	Name        *string `json:"name"`
}
type ActivateLibraryInput struct {
	LibraryID string `json:"libraryId"`
}
type RenameLibraryInput struct {
	LibraryID string `json:"libraryId"`
	Name      string `json:"name"`
}
type DeleteLibraryInput struct {
	LibraryID   string `json:"libraryId"`
	DeleteFiles bool   `json:"deleteFiles"`
}
type BulkAction string
type BulkModAction = BulkAction

const (
	BulkActionEnable  BulkAction = "enable"
	BulkActionDisable BulkAction = "disable"
	BulkActionDelete  BulkAction = "delete"
)

type BulkUpdateModsInput struct {
	LibraryID string     `json:"libraryId"`
	ModIDs    []string   `json:"modIds"`
	Action    BulkAction `json:"action"`
}
type SyncModsInput struct {
	TaskID    string `json:"taskId"`
	LibraryID string `json:"libraryId"`
}
type RebuildLibraryCacheInput struct {
	TaskID    string `json:"taskId"`
	LibraryID string `json:"libraryId"`
}
type InstallModArchivesInput struct {
	TaskID       string   `json:"taskId"`
	LibraryID    string   `json:"libraryId"`
	ArchivePaths []string `json:"archivePaths"`
}
type ForgeDownloadVersionInput struct {
	TaskID    string    `json:"taskId"`
	LibraryID string    `json:"libraryId"`
	Kind      ForgeKind `json:"kind"`
	ItemID    uint64    `json:"itemId"`
	VersionID uint64    `json:"versionId"`
}
type ForgeMatchInstalledModInput struct {
	LibraryID      string    `json:"libraryId"`
	InstalledModID string    `json:"installedModId"`
	Kind           ForgeKind `json:"kind"`
	ItemID         uint64    `json:"itemId"`
	VersionID      uint64    `json:"versionId"`
}

const (
	WorkspaceEventCacheRebuildCompleted = "cache_rebuild_completed"
	WorkspaceEventModInstallCompleted   = "mod_install_completed"
	WorkspaceEventSyncCompleted         = "sync_completed"
)

type WorkspaceEvent struct {
	Type              string
	TaskID, LibraryID string
	Failures          any
	Workspace         LibraryWorkspace
	CacheStatus       *CacheStatus
}

func (e WorkspaceEvent) MarshalJSON() ([]byte, error) {
	if e.Type == WorkspaceEventCacheRebuildCompleted {
		if e.CacheStatus == nil {
			return nil, fmt.Errorf("cache completion requires cache status")
		}
		return json.Marshal(struct {
			Type        string           `json:"type"`
			TaskID      string           `json:"taskId"`
			LibraryID   string           `json:"libraryId"`
			CacheStatus *CacheStatus     `json:"cacheStatus"`
			Workspace   LibraryWorkspace `json:"workspace"`
		}{e.Type, e.TaskID, e.LibraryID, e.CacheStatus, e.Workspace})
	}
	if e.Type != WorkspaceEventModInstallCompleted && e.Type != WorkspaceEventSyncCompleted {
		return nil, fmt.Errorf("unknown workspace event %q", e.Type)
	}
	failures := e.Failures
	if failures == nil {
		failures = []ModFailure{}
	}
	return json.Marshal(struct {
		Type      string           `json:"type"`
		TaskID    string           `json:"taskId"`
		LibraryID string           `json:"libraryId"`
		Failures  any              `json:"failures"`
		Workspace LibraryWorkspace `json:"workspace"`
	}{e.Type, e.TaskID, e.LibraryID, failures, e.Workspace})
}
func (e *WorkspaceEvent) UnmarshalJSON(data []byte) error {
	var v struct {
		Type        string           `json:"type"`
		TaskID      string           `json:"taskId"`
		LibraryID   string           `json:"libraryId"`
		Failures    json.RawMessage  `json:"failures"`
		CacheStatus *CacheStatus     `json:"cacheStatus"`
		Workspace   LibraryWorkspace `json:"workspace"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	result := WorkspaceEvent{Type: v.Type, TaskID: v.TaskID, LibraryID: v.LibraryID, CacheStatus: v.CacheStatus, Workspace: v.Workspace}
	switch v.Type {
	case WorkspaceEventCacheRebuildCompleted:
		if v.CacheStatus == nil {
			return fmt.Errorf("cache completion requires cache status")
		}
	case WorkspaceEventModInstallCompleted:
		var failures []ArchiveFailure
		if err := json.Unmarshal(v.Failures, &failures); err != nil {
			return err
		}
		result.Failures = failures
	case WorkspaceEventSyncCompleted:
		var failures []ModFailure
		if err := json.Unmarshal(v.Failures, &failures); err != nil {
			return err
		}
		result.Failures = failures
	default:
		return fmt.Errorf("unknown workspace event %q", v.Type)
	}
	*e = result
	return nil
}
