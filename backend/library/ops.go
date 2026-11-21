package library

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/martes/modkeeper/backend/deployment"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/modmanager"
	"github.com/martes/modkeeper/backend/spt"
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

// SetInstallTaskHook is a test seam for holding a fire-and-track install at a
// deterministic point while verifying concurrent command admission.
func (s *Service) SetInstallTaskHook(hook func(string)) {
	s.installTaskHook = hook
}

func (s *Service) admit(taskID, libraryID string, op models.TaskOperation) (*task_progress.Emitter, context.Context, error) {
	if taskID == "" || libraryID == "" {
		return nil, nil, fmt.Errorf("ParseError: taskId and libraryId are required")
	}
	if !s.libraryMu.TryRLock() {
		return nil, nil, models.Fail(models.LibraryBusy)
	}
	if s.active == nil {
		s.libraryMu.RUnlock()
		return nil, nil, fmt.Errorf("NoActiveLibrary")
	}
	if err := s.Registry.AssertActiveLibrary(libraryID); err != nil {
		s.libraryMu.RUnlock()
		return nil, nil, err
	}
	if s.active.manifest.ID != libraryID {
		s.libraryMu.RUnlock()
		return nil, nil, fmt.Errorf("InvalidLibrary: %s", libraryID)
	}
	if !s.modWrites.TryLock() {
		s.libraryMu.RUnlock()
		return nil, nil, models.Fail(models.LibraryBusy)
	}
	ctx, cancel := context.WithCancel(context.Background())
	if err := s.Registry.AcquireTaskWithCancellable(taskID, libraryID, cancel, op != models.TaskOperationCacheRebuild); err != nil {
		s.modWrites.Unlock()
		s.libraryMu.RUnlock()
		cancel()
		return nil, nil, err
	}
	e := task_progress.New(taskID, libraryID, op, s.sendProgress)
	if err := e.StartAfterAdmission(nil); err != nil {
		s.Registry.FinishTaskID(taskID)
		s.modWrites.Unlock()
		s.libraryMu.RUnlock()
		cancel()
		return nil, nil, err
	}
	s.beginTask()
	return e, ctx, nil
}

// runTask starts an admitted operation in the background and returns the accept
// signal immediately, matching the Rust fire-and-track commands.
func (s *Service) runTask(taskID string, run func() error) *models.OperationAccepted {
	go func() {
		defer s.endTask()
		defer s.Registry.FinishTaskID(taskID)
		defer s.libraryMu.RUnlock()
		defer s.modWrites.Unlock()
		_ = run()
	}()
	return &models.OperationAccepted{Accepted: true}
}

func (s *Service) BulkUpdateMods(in models.BulkUpdateModsInput) error {
	s.libraryMu.RLock()
	defer s.libraryMu.RUnlock()
	s.modWrites.Lock()
	defer s.modWrites.Unlock()
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
		// Never remove mod data while a recorded deployment is no longer owned.
		rules, err := spt.Discover(s.active.GameRoot)
		if err != nil {
			return err
		}
		if err := deployment.VerifyOwnership(deployment.Layout{LibraryRoot: s.active.Root, GameRoot: s.active.GameRoot, Rules: rules}); err != nil {
			return err
		}
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
	e, ctx, err := s.admit(in.TaskID, in.LibraryID, models.TaskOperationCacheRebuild)
	if err != nil {
		return nil, err
	}
	return s.runTask(in.TaskID, func() error {
		if ctx.Err() != nil {
			e.Cancelled()
			return ctx.Err()
		}
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
	e, ctx, err := s.admit(in.TaskID, in.LibraryID, models.TaskOperationInstall)
	if err != nil {
		return nil, err
	}
	return s.runTask(in.TaskID, func() error {
		if s.installTaskHook != nil {
			s.installTaskHook(in.TaskID)
		}
		failures := make([]models.ArchiveFailure, 0, len(in.ArchivePaths))
		l := modmanager.Library{Root: s.active.ModsDir, Mods: s.active.manifest.Mods}
		enable := s.Store.Config.Settings.EnableModsOnInstall
		for i, path := range in.ArchivePaths {
			if ctx.Err() != nil {
				s.finishCancelled(e, in, l.Mods)
				return ctx.Err()
			}
			e.Progress(models.TaskStageInstallArchives, task_progress.ArchiveCountPercent(i, len(in.ArchivePaths)))
			staged, stageErr := stager.Resolve([]string{path}, s.active.StagingDir, "SPT/user/mods", "BepInEx/plugins", nil)
			if stageErr != nil {
				failures = append(failures, models.ArchiveFailure{ArchivePath: path, Error: archiveError(stageErr)})
				continue
			}
			e.Progress(models.TaskStageInstallArchiveStage, nil)
			for _, item := range staged {
				if ctx.Err() != nil {
					_ = stager.CleanUp(item.IsStaging, item.Root)
					s.finishCancelled(e, in, l.Mods)
					return ctx.Err()
				}
				previous, hadPrevious := l.Mods[item.FS.ID]
				snapshot := ""
				var err error
				if hadPrevious {
					snapshot, err = s.snapshotMod(item.FS.ID)
					if err == nil && snapshot == "" {
						hadPrevious = false
						delete(l.Mods, item.FS.ID)
					}
				} else if _, statErr := os.Lstat(filepath.Join(s.active.ModsDir, item.FS.ID)); statErr == nil {
					err = fmt.Errorf("ModIdConflict: untracked directory already exists for %s", item.FS.ID)
				} else if !os.IsNotExist(statErr) {
					err = statErr
				}
				newMod := previous
				if !hadPrevious {
					newMod = models.Mod{ID: item.FS.ID, Name: item.Name}
				}
				newMod.ApplyInstall(enable, nil, time.Now())
				if err == nil {
					l.Mods[item.FS.ID] = newMod
				}
				transaction := installTransaction{
					Version: 1,
					ID:      item.FS.ID,
					Phase:   installPrepared,
					HadOld:  hadPrevious,
					NewMod:  newMod,
				}
				if hadPrevious {
					old := previous
					transaction.OldMod = &old
				}
				marker := installMarkerPath(s.active, item.FS.ID)
				markerPrepared := false
				if err == nil {
					err = s.writeInstallMarker(marker, transaction)
					markerPrepared = err == nil
					if markerPrepared && s.installTransactionHook != nil {
						s.installTransactionHook("after-prepared-marker")
					}
				}
				if err == nil {
					err = modmanager.AddModWithMetadata(&l, item.FS.ID, item.Name, item.FS.ModType, path, enable, nil)
				}
				if err == nil {
					err = s.installModTree(ctx, item.Root, item.FS.ID, func() {
						e.Progress(models.TaskStageInstallArchiveStage, nil)
					})
					if err == nil {
						// This existing progress boundary is after replacement and
						// before manifest persistence.
						e.Progress(models.TaskStageInstallArchiveStage, nil)
					}
				}
				if err != nil && markerPrepared {
					if recoveryErr := recoverInstallTransaction(
						s.active,
						marker,
						installCommittedMarkerPath(s.active, item.FS.ID),
						transaction,
						nil,
					); recoveryErr != nil {
						err = fmt.Errorf("%w (recovery failed: %v)", err, recoveryErr)
					}
				}
				_ = stager.CleanUp(item.IsStaging, item.Root)
				if err != nil {
					if hadPrevious {
						l.Mods[item.FS.ID] = previous
					} else {
						delete(l.Mods, item.FS.ID)
					}
					s.active.manifest.Mods = l.Mods
					if _, markerErr := os.Stat(marker); os.IsNotExist(markerErr) && snapshot != "" {
						_ = os.RemoveAll(snapshot)
					}
				}
				if err == nil {
					committed, finishErr := s.finishInstallTransaction(transaction)
					if finishErr != nil {
						err = finishErr
						restoreErr := recoverInterruptedInstall(s.active)
						if restoreErr != nil {
							err = fmt.Errorf("%w (recovery failed: %v)", err, restoreErr)
						} else if committed {
							err = nil
						}
						l.Mods = s.active.manifest.Mods
					}
				}
				if ctx.Err() != nil {
					s.finishCancelled(e, in, l.Mods)
					return ctx.Err()
				}
				if err != nil {
					failures = append(failures, models.ArchiveFailure{ArchivePath: path, Error: archiveError(err)})
					continue
				}
			}
			e.Progress(models.TaskStageInstallArchives, task_progress.ArchiveCountPercent(i+1, len(in.ArchivePaths)))
		}
		if ctx.Err() != nil {
			s.finishCancelled(e, in, l.Mods)
			return ctx.Err()
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

func (s *Service) finishCancelled(e *task_progress.Emitter, in models.InstallModArchivesInput, mods map[string]models.Mod) {
	s.active.manifest.Mods = mods
	e.Cancelled()
	if s.sendWorkspace != nil {
		_ = s.sendWorkspace(models.WorkspaceEvent{Type: models.WorkspaceEventModInstallCompleted, TaskID: in.TaskID, LibraryID: in.LibraryID, Failures: []models.ArchiveFailure{}, Workspace: *s.Workspace()})
	}
}

func (s *Service) CancelTask(taskID, libraryID string) error {
	s.libraryMu.RLock()
	defer s.libraryMu.RUnlock()
	if s.active == nil || s.active.manifest.ID != libraryID {
		return fmt.Errorf("InvalidLibrary: %s", libraryID)
	}
	return s.Registry.CancelTask(taskID, libraryID)
}

func (s *Service) SyncMods(in models.SyncModsInput, progress func(models.TaskProgressEvent) error) (*models.OperationAccepted, error) {
	if progress != nil {
		s.sendProgress = progress
	}
	e, ctx, err := s.admit(in.TaskID, in.LibraryID, models.TaskOperationSync)
	if err != nil {
		return nil, err
	}
	return s.runTask(in.TaskID, func() error {
		rules, err := spt.Discover(s.active.GameRoot)
		if err != nil {
			e.Completed(task_progress.Failure)
			return err
		}
		layout := deployment.Layout{LibraryRoot: s.active.Root, GameRoot: s.active.GameRoot, Rules: rules}
		report, err := deployment.Sync(ctx, layout, s.active.modList(), e)
		failures := make([]models.ModFailure, 0, len(report.Failures))
		for _, failure := range report.Failures {
			modFailure := models.ModFailure{ModID: failure.ModID}
			if failure.Error != nil {
				modFailure.Error = models.Error{Code: failure.Error.Code, Data: failure.Error.Data}
			}
			failures = append(failures, modFailure)
		}
		if err != nil {
			if ctx.Err() != nil {
				e.Cancelled()
			} else {
				e.Completed(task_progress.Failure)
			}
			if s.sendWorkspace != nil {
				_ = s.sendWorkspace(models.WorkspaceEvent{Type: models.WorkspaceEventSyncCompleted, TaskID: in.TaskID, LibraryID: in.LibraryID, Failures: failures, Workspace: *s.Workspace()})
			}
			return err
		}
		s.active.manifest.IsDirty = false
		if err := s.active.Persist(); err != nil {
			e.Completed(task_progress.Failure)
			return err
		}
		e.Progress(models.TaskStageSyncPersist, nil)
		if len(failures) > 0 {
			e.Completed(task_progress.PartialFailure)
		} else {
			e.Completed(task_progress.Success)
		}
		if s.sendWorkspace != nil {
			_ = s.sendWorkspace(models.WorkspaceEvent{Type: models.WorkspaceEventSyncCompleted, TaskID: in.TaskID, LibraryID: in.LibraryID, Failures: failures, Workspace: *s.Workspace()})
		}
		return nil
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
