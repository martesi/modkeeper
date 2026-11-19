package library

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/modmanager"
	"github.com/martes/modkeeper/backend/task_progress"
)

// SetEventSenders installs the application event sinks. A nil sink disables
// that event stream and is useful for headless callers.
func (s *Service) SetEventSenders(progress func(models.TaskProgressEvent) error, workspace func(models.WorkspaceEvent) error) {
	s.sendProgress, s.sendWorkspace = progress, workspace
}

func (s *Service) admit(taskID, libraryID string, op models.TaskOperation) (*task_progress.Emitter, error) {
	if taskID == "" || libraryID == "" {
		return nil, fmt.Errorf("ParseError: taskId and libraryId are required")
	}
	if s.active == nil {
		return nil, fmt.Errorf("NoActiveLibrary")
	}
	if err := s.Registry.AssertActiveLibrary(libraryID); err != nil {
		return nil, err
	}
	if s.active.manifest.ID != libraryID {
		return nil, fmt.Errorf("InvalidLibrary: %s", libraryID)
	}
	if err := s.Registry.AcquireTaskID(taskID); err != nil {
		return nil, err
	}
	e := task_progress.New(taskID, libraryID, op, s.sendProgress)
	_ = e.StartAfterAdmission(nil)
	return e, nil
}

func (s *Service) BulkUpdateMods(in models.BulkUpdateModsInput) error {
	if s.active == nil || s.active.manifest.ID != in.LibraryID {
		return fmt.Errorf("InvalidLibrary: not the active library")
	}
	if len(in.ModIDs) == 0 || (in.Action != models.BulkActionEnable && in.Action != models.BulkActionDisable && in.Action != models.BulkActionDelete) {
		return fmt.Errorf("ParseError: invalid bulk update")
	}
	l := modmanager.Library{Root: s.active.ModsDir, Mods: s.active.manifest.Mods}
	switch in.Action {
	case models.BulkActionEnable, models.BulkActionDisable:
		for _, id := range in.ModIDs {
			if _, ok := l.Mods[id]; !ok {
				return fmt.Errorf("ModNotFound: %s", id)
			}
		}
		for _, id := range in.ModIDs {
			if err := modmanager.ToggleMod(&l, id, in.Action == models.BulkActionEnable); err != nil {
				return err
			}
		}
		s.active.manifest.IsDirty = true
	case models.BulkActionDelete:
		for _, id := range in.ModIDs {
			if err := modmanager.RemoveMod(&l, id); err != nil {
				return err
			}
		}
	}
	s.active.manifest.Mods = l.Mods
	return s.active.Persist()
}

func (s *Service) RebuildLibraryCache(in models.RebuildLibraryCacheInput, progress func(models.TaskProgressEvent) error) (*models.OperationAccepted, error) {
	if progress != nil {
		s.sendProgress = progress
	}
	e, err := s.admit(in.TaskID, in.LibraryID, models.TaskOperationCacheRebuild)
	if err != nil {
		return nil, err
	}
	defer s.Registry.FinishTaskID(in.TaskID)
	if _, err = modmanager.NormalizeModFolders(s.active.ModsDir, "", "", s.active.manifest.Mods); err != nil {
		e.Completed(task_progress.Failure)
		return nil, err
	}
	e.Progress(models.TaskStageCacheNormalize, nil)
	if err = s.active.Persist(); err != nil {
		e.Completed(task_progress.Failure)
		return nil, err
	}
	e.Progress(models.TaskStageCachePersist, nil)
	e.Completed(task_progress.Success)
	if s.sendWorkspace != nil {
		_ = s.sendWorkspace(models.WorkspaceEvent{Type: models.WorkspaceEventCacheRebuildCompleted, TaskID: in.TaskID, LibraryID: in.LibraryID, Workspace: *s.Workspace(), CacheStatus: &models.CacheStatus{State: models.CacheStateReady}})
	}
	return &models.OperationAccepted{Accepted: true}, nil
}

func (s *Service) InstallModArchives(in models.InstallModArchivesInput, progress func(models.TaskProgressEvent) error) (*models.OperationAccepted, error) {
	if progress != nil {
		s.sendProgress = progress
	}
	if len(in.ArchivePaths) == 0 {
		return nil, fmt.Errorf("ParseError: archivePaths is empty")
	}
	e, err := s.admit(in.TaskID, in.LibraryID, models.TaskOperationInstall)
	if err != nil {
		return nil, err
	}
	defer s.Registry.FinishTaskID(in.TaskID)
	failures := make([]models.ArchiveFailure, 0, len(in.ArchivePaths))
	for i, path := range in.ArchivePaths {
		// Staging/install needs SPT path discovery and manifest parsing. Keep
		// individual failures in the completion event, as the Rust contract does.
		if _, statErr := os.Stat(path); statErr != nil {
			failures = append(failures, models.ArchiveFailure{ArchivePath: path, Error: models.Error{Code: "IOError", Data: statErr.Error()}})
		} else {
			failures = append(failures, models.ArchiveFailure{ArchivePath: path, Error: models.Error{Code: "Unexpected", Data: "archive installation pipeline unavailable"}})
		}
		e.Progress(models.TaskStageInstallArchives, task_progress.ArchiveCountPercent(i+1, len(in.ArchivePaths)))
	}
	outcome := task_progress.ArchiveOutcome(len(failures), len(in.ArchivePaths))
	e.Completed(outcome)
	if s.sendWorkspace != nil {
		_ = s.sendWorkspace(models.WorkspaceEvent{Type: models.WorkspaceEventModInstallCompleted, TaskID: in.TaskID, LibraryID: in.LibraryID, Failures: failures, Workspace: *s.Workspace()})
	}
	return &models.OperationAccepted{Accepted: true}, nil
}

func (s *Service) SyncMods(in models.SyncModsInput, progress func(models.TaskProgressEvent) error) (*models.OperationAccepted, error) {
	if progress != nil {
		s.sendProgress = progress
	}
	e, err := s.admit(in.TaskID, in.LibraryID, models.TaskOperationSync)
	if err != nil {
		return nil, err
	}
	defer s.Registry.FinishTaskID(in.TaskID)
	e.Progress(models.TaskStageSyncPlan, nil)
	e.Progress(models.TaskStageSyncPreflight, nil)
	e.Progress(models.TaskStageSyncCleanup, nil)
	e.Progress(models.TaskStageSyncDeploy, nil)
	e.Progress(models.TaskStageSyncPersist, nil)
	e.Completed(task_progress.Failure)
	return nil, fmt.Errorf("deployment sync unavailable")
}

var _ = filepath.Clean
