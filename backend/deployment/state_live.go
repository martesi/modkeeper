package deployment

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/BurntSushi/toml"
)

type liveDeploymentState struct {
	file   *os.File
	object pinnedObject
}

var liveDeploymentStates = struct {
	sync.Mutex
	byPath map[string]*liveDeploymentState
}{byPath: map[string]*liveDeploymentState{}}

func deploymentStateKey(l Layout) string {
	return syncJournalKey(l.Paths().Deployment)
}

func releaseLiveDeploymentState(l Layout) error {
	key := deploymentStateKey(l)
	liveDeploymentStates.Lock()
	state := liveDeploymentStates.byPath[key]
	delete(liveDeploymentStates.byPath, key)
	liveDeploymentStates.Unlock()
	return closeLiveDeploymentState(state)
}

// ReleaseLibraryPins closes only this library's process-live pins. It refuses
// to release them while a Sync intent is pending and serializes with mutations.
func ReleaseLibraryPins(l Layout) error {
	if _, err := os.Stat(l.LibraryRoot); os.IsNotExist(err) {
		root, absErr := filepath.Abs(l.LibraryRoot)
		if absErr != nil {
			return ioError(absErr)
		}
		root = syncJournalKey(root)
		liveSyncJournals.Lock()
		for path, journal := range liveSyncJournals.byPath {
			if syncJournalKey(filepath.Dir(path)) != root {
				continue
			}
			for _, done := range journal.retired {
				if !done {
					liveSyncJournals.Unlock()
					return syncIntentConflict(l, path)
				}
			}
		}
		liveSyncJournals.Unlock()
		return releasePinsForMissingLibrary(l)
	} else if err != nil {
		return ioError(err)
	}
	release, err := acquireMutationLock(l)
	if err != nil {
		return ioError(fmt.Errorf("lock deployment mutation pins: %w", err))
	}
	defer release()
	if err := CheckNoPendingSync(l); err != nil {
		return err
	}
	stateErr := releaseLiveDeploymentState(l)
	root, err := filepath.Abs(l.LibraryRoot)
	if err != nil {
		return errors.Join(stateErr, ioError(err))
	}
	root = filepath.Clean(root)
	liveSyncJournals.Lock()
	var journals []*liveSyncJournal
	for path, journal := range liveSyncJournals.byPath {
		if syncJournalKey(filepath.Dir(path)) == syncJournalKey(root) {
			journals = append(journals, journal)
			delete(liveSyncJournals.byPath, path)
		}
	}
	liveSyncJournals.Unlock()
	var closeErrs []error
	for _, journal := range journals {
		closeErrs = append(closeErrs, journal.object.close(), journal.file.Close())
	}
	closeErrs = append(closeErrs, releaseLiveArtifactsForLibrary(l))
	return errors.Join(append([]error{stateErr}, closeErrs...)...)
}

func releasePinsForMissingLibrary(l Layout) error {
	stateErr := releaseLiveDeploymentState(l)
	root, err := filepath.Abs(l.LibraryRoot)
	if err != nil {
		return errors.Join(stateErr, ioError(err))
	}
	rootKey := syncJournalKey(root)
	liveSyncJournals.Lock()
	var journals []*liveSyncJournal
	for path, journal := range liveSyncJournals.byPath {
		if syncJournalKey(filepath.Dir(path)) == rootKey {
			journals = append(journals, journal)
			delete(liveSyncJournals.byPath, path)
		}
	}
	liveSyncJournals.Unlock()
	var closeErrs []error
	for _, journal := range journals {
		closeErrs = append(closeErrs, journal.object.close(), journal.file.Close())
	}
	closeErrs = append(closeErrs, releaseLiveArtifactsForLibrary(l))
	return errors.Join(append([]error{stateErr}, closeErrs...)...)
}

// CloseLiveDeploymentStates releases process-live ownership pins during shutdown.
// Durable state remains on disk and is not adopted by a later process.
func CloseLiveDeploymentStates() error {
	liveDeploymentStates.Lock()
	states := make([]*liveDeploymentState, 0, len(liveDeploymentStates.byPath))
	for key, state := range liveDeploymentStates.byPath {
		states = append(states, state)
		delete(liveDeploymentStates.byPath, key)
	}
	liveDeploymentStates.Unlock()
	var closeErrs []error
	for _, state := range states {
		if err := closeLiveDeploymentState(state); err != nil {
			closeErrs = append(closeErrs, err)
		}
	}
	liveSyncJournals.Lock()
	journals := liveSyncJournals.byPath
	liveSyncJournals.byPath = make(map[string]*liveSyncJournal)
	liveSyncJournals.Unlock()
	for _, journal := range journals {
		closeErrs = append(closeErrs, journal.object.close(), journal.file.Close())
	}
	liveArtifacts.Lock()
	artifacts := liveArtifacts.byTarget
	liveArtifacts.byTarget = make(map[string]*liveArtifact)
	liveArtifacts.Unlock()
	for _, artifact := range artifacts {
		closeErrs = append(closeErrs, artifact.object.close())
	}
	liveDirectories.Lock()
	dirs := liveDirectories.byPath
	liveDirectories.byPath = make(map[string]liveDirectory)
	liveDirectories.Unlock()
	for _, dir := range dirs {
		closeErrs = append(closeErrs, dir.object.close())
	}
	return errors.Join(closeErrs...)
}

func closeLiveDeploymentState(state *liveDeploymentState) error {
	if state == nil {
		return nil
	}
	return errors.Join(state.object.close(), state.file.Close())
}

func verifyLiveDeploymentState(l Layout) (bool, error) {
	key := deploymentStateKey(l)
	liveDeploymentStates.Lock()
	state := liveDeploymentStates.byPath[key]
	liveDeploymentStates.Unlock()
	if state == nil || state.object == nil || state.file == nil {
		return false, nil
	}
	owned, err := state.object.matches(l.Paths().Deployment)
	if err != nil {
		return false, ioError(fmt.Errorf("verify live deployment state: %w", err))
	}
	return owned, nil
}

func writeDeploymentState(l Layout, state DeploymentState) error {
	return writeDeploymentStateWithFileOps(l, state, func(file *os.File, data []byte) error {
		written, err := file.Write(data)
		if err != nil {
			return err
		}
		if written != len(data) {
			return io.ErrShortWrite
		}
		return file.Sync()
	})
}

func writeDeploymentStateWithFileOps(l Layout, state DeploymentState, persist func(*os.File, []byte) error) error {
	path := l.Paths().Deployment
	key := deploymentStateKey(l)
	liveDeploymentStates.Lock()
	defer liveDeploymentStates.Unlock()
	current := liveDeploymentStates.byPath[key]
	created := false
	if current != nil {
		owned, err := current.object.matches(path)
		if err != nil {
			return ioError(fmt.Errorf("verify deployment state before update: %w", err))
		}
		if !owned {
			return collision(path)
		}
		identity, err := fileIdentity(path)
		if err != nil {
			return ioError(err)
		}
		state.FileID = identity
	} else {
		var file *os.File
		info, err := os.Lstat(path)
		if err == nil {
			if !info.Mode().IsRegular() {
				return collision(path)
			}
			oldState, loadErr := LoadState(l)
			if loadErr != nil {
				return loadErr
			}
			identity, identityErr := fileIdentity(path)
			if identityErr != nil {
				return ioError(identityErr)
			}
			if oldState.FileID == "" || oldState.FileID != identity || !verifyDeploymentStateReceipt(l, oldState) {
				return collision(path)
			}
			file, err = os.OpenFile(path, os.O_RDWR, 0)
			if err != nil {
				return ioError(err)
			}
		} else if os.IsNotExist(err) {
			file, err = os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
			if os.IsExist(err) {
				return collision(path)
			}
			if err != nil {
				return ioError(fmt.Errorf("create deployment state without replacement: %w", err))
			}
			created = true
		} else {
			return ioError(err)
		}
		object, pinErr := pinOpenFile(file)
		if pinErr != nil {
			_ = file.Close()
			return ioError(fmt.Errorf("pin deployment state: %w", pinErr))
		}
		owned, matchErr := object.matches(path)
		if matchErr != nil || !owned {
			_ = object.close()
			_ = file.Close()
			if matchErr != nil {
				return ioError(matchErr)
			}
			return collision(path)
		}
		identity, identityErr := fileIdentity(path)
		if identityErr != nil {
			_ = object.close()
			_ = file.Close()
			return ioError(identityErr)
		}
		state.FileID = identity
		current = &liveDeploymentState{file: file, object: object}
	}
	if err := sealDeploymentState(l, &state); err != nil {
		return err
	}
	var data bytes.Buffer
	if err := toml.NewEncoder(&data).Encode(state); err != nil {
		return ioError(err)
	}
	if created {
		if err := persist(current.file, data.Bytes()); err != nil {
			_ = current.object.close()
			_ = current.file.Close()
			return ioError(fmt.Errorf("write new deployment state: %w", err))
		}
	} else {
		if err := current.file.Truncate(0); err != nil {
			return ioError(fmt.Errorf("truncate owned deployment state: %w", err))
		}
		if _, err := current.file.Seek(0, 0); err != nil {
			return ioError(fmt.Errorf("seek owned deployment state: %w", err))
		}
		if _, err := current.file.Write(data.Bytes()); err != nil {
			return ioError(fmt.Errorf("write owned deployment state: %w", err))
		}
		if err := current.file.Sync(); err != nil {
			return ioError(fmt.Errorf("sync owned deployment state: %w", err))
		}
	}
	owned, err := current.object.matches(path)
	if err != nil || !owned {
		if created {
			_ = current.object.close()
			_ = current.file.Close()
		}
		if err != nil {
			return ioError(fmt.Errorf("verify new deployment state: %w", err))
		}
		return collision(path)
	}
	if err := syncDirectoryDurably(filepath.Dir(path)); err != nil {
		if created {
			_ = current.object.close()
			_ = current.file.Close()
		}
		return ioError(fmt.Errorf("sync deployment state directory: %w", err))
	}
	liveDeploymentStates.byPath[key] = current
	return nil
}
