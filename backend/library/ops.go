package library

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/modmanager"
	"github.com/martes/modkeeper/backend/stager"
	"github.com/martes/modkeeper/backend/task_progress"
)

// SetEventSenders installs the application event sinks. A nil sink disables
// that event stream and is useful for headless callers.
func (s *Service) SetEventSenders(progress func(models.TaskProgressEvent) error, workspace func(models.WorkspaceEvent) error) {
	s.sendProgress, s.sendWorkspace = progress, workspace
}

// Wait blocks until every admitted background task has finished. It exists for
// tests and shutdown; Wails callers never wait because operations are
// fire-and-track like the Rust commands.
func (s *Service) Wait() { s.tasks.Wait() }

func (s *Service) beginTask() { s.tasks.Add(1) }
func (s *Service) endTask()   { s.tasks.Done() }

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
	if err := e.StartAfterAdmission(nil); err != nil {
		s.Registry.FinishTaskID(taskID)
		return nil, err
	}
	s.beginTask()
	return e, nil
}

// runTask starts an admitted operation in the background and returns the accept
// signal immediately, matching the Rust fire-and-track commands.
func (s *Service) runTask(taskID string, run func() error) *models.OperationAccepted {
	go func() {
		defer s.Registry.FinishTaskID(taskID)
		defer s.endTask()
		_ = run()
	}()
	return &models.OperationAccepted{Accepted: true}
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
	return s.runTask(in.TaskID, func() error {
		if _, err := modmanager.NormalizeModFolders(s.active.ModsDir, "SPT/user/mods", "BepInEx/plugins", s.active.manifest.Mods); err != nil {
			e.Completed(task_progress.Failure)
			return err
		}
		e.Progress(models.TaskStageCacheNormalize, nil)
		if err := s.active.Persist(); err != nil {
			e.Completed(task_progress.Failure)
			return err
		}
		e.Progress(models.TaskStageCachePersist, nil)
		e.Completed(task_progress.Success)
		rebuilt := time.Now().UTC().Format(time.RFC3339)
		status := &models.CacheStatus{State: models.CacheStateReady, LastRebuiltAt: &rebuilt}
		if s.sendWorkspace != nil {
			_ = s.sendWorkspace(models.WorkspaceEvent{Type: models.WorkspaceEventCacheRebuildCompleted, TaskID: in.TaskID, LibraryID: in.LibraryID, Workspace: *s.Workspace(), CacheStatus: status})
		}
		return nil
	}), nil
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
	return s.runTask(in.TaskID, func() error {
		failures := make([]models.ArchiveFailure, 0, len(in.ArchivePaths))
		l := modmanager.Library{Root: s.active.ModsDir, Mods: s.active.manifest.Mods}
		enable := s.Store.Config.Settings.EnableModsOnInstall
		for i, path := range in.ArchivePaths {
			e.Progress(models.TaskStageInstallArchives, task_progress.ArchiveCountPercent(i, len(in.ArchivePaths)))
			staged, stageErr := stager.Resolve([]string{path}, s.active.StagingDir, "SPT/user/mods", "BepInEx/plugins", nil)
			if stageErr != nil {
				failures = append(failures, models.ArchiveFailure{ArchivePath: path, Error: archiveError(stageErr)})
				continue
			}
			e.Progress(models.TaskStageInstallArchiveStage, nil)
			for _, item := range staged {
				err := modmanager.AddModWithMetadata(&l, item.FS.ID, item.Name, item.FS.ModType, path, enable, nil)
				if err == nil {
					err = copyTree(item.Root, filepath.Join(l.Root, item.FS.ID))
				}
				_ = stager.CleanUp(item.IsStaging, item.Root)
				if err != nil {
					failures = append(failures, models.ArchiveFailure{ArchivePath: path, Error: archiveError(err)})
					continue
				}
			}
			e.Progress(models.TaskStageInstallArchives, task_progress.ArchiveCountPercent(i+1, len(in.ArchivePaths)))
		}
		e.Progress(models.TaskStageInstallCommit, nil)
		s.active.manifest.Mods = l.Mods
		if err := s.active.Persist(); err != nil {
			e.Completed(task_progress.Failure)
			return err
		}
		e.Completed(task_progress.ArchiveOutcome(len(failures), len(in.ArchivePaths)))
		if s.sendWorkspace != nil {
			_ = s.sendWorkspace(models.WorkspaceEvent{Type: models.WorkspaceEventModInstallCompleted, TaskID: in.TaskID, LibraryID: in.LibraryID, Failures: failures, Workspace: *s.Workspace()})
		}
		return nil
	}), nil
}

func (s *Service) SyncMods(in models.SyncModsInput, progress func(models.TaskProgressEvent) error) (*models.OperationAccepted, error) {
	if progress != nil {
		s.sendProgress = progress
	}
	e, err := s.admit(in.TaskID, in.LibraryID, models.TaskOperationSync)
	if err != nil {
		return nil, err
	}
	return s.runTask(in.TaskID, func() error {
		e.Progress(models.TaskStageSyncPlan, nil)
		e.Progress(models.TaskStageSyncPreflight, nil)
		e.Progress(models.TaskStageSyncCleanup, nil)
		e.Progress(models.TaskStageSyncDeploy, nil)
		e.Progress(models.TaskStageSyncPersist, nil)
		e.Completed(task_progress.Failure)
		return fmt.Errorf("deployment sync unavailable")
	}), nil
}

func archiveError(err error) models.Error {
	if e, ok := err.(*models.Error); ok {
		return *e
	}
	return models.Error{Code: "Unexpected", Data: err.Error()}
}

func copyTree(src, dst string) error {
	if err := os.RemoveAll(dst); err != nil {
		return err
	}
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
		if err != nil {
			return err
		}
		_, err = io.Copy(out, in)
		closeErr := out.Close()
		if err != nil {
			return err
		}
		return closeErr
	})
}
