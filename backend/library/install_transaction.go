package library

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/security"
)

type installPhase string

const (
	installPrepared  installPhase = "prepared"
	installCommitted installPhase = "committed"
)

type installTransaction struct {
	Version int          `json:"version"`
	ID      string       `json:"id"`
	Phase   installPhase `json:"phase"`
	HadOld  bool         `json:"hadOld"`
	OldMod  *models.Mod  `json:"oldMod,omitempty"`
	NewMod  models.Mod   `json:"newMod"`
}

func installMarkerPath(l *Library, id string) string {
	return installPreparedMarkerPath(l, id)
}

func installPreparedMarkerPath(l *Library, id string) string {
	return filepath.Join(l.BackupsDir, id+".install.prepared")
}

func installCommittedMarkerPath(l *Library, id string) string {
	return filepath.Join(l.BackupsDir, id+".install.committed")
}

func installSnapshotPath(l *Library, id string) string {
	return filepath.Join(l.BackupsDir, id+".snapshot")
}

func writeInstallTransaction(path string, transaction installTransaction) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".modkeeper-install-tmp-")
	if err != nil {
		return err
	}
	tmp := file.Name()
	defer os.Remove(tmp)

	if err := json.NewEncoder(file).Encode(transaction); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}

	if _, err := os.Lstat(path); err == nil {
		return fmt.Errorf("install transaction marker already exists: %s", path)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	return syncLibraryDir(filepath.Dir(path))
}

func readInstallTransaction(path, id string) (installTransaction, error) {
	var transaction installTransaction
	data, err := os.ReadFile(path)
	if err != nil {
		return transaction, err
	}
	if err := json.Unmarshal(data, &transaction); err != nil {
		return transaction, fmt.Errorf("invalid install recovery marker %q: %w", path, err)
	}
	if transaction.Version != 1 || transaction.ID != id ||
		(transaction.Phase != installPrepared && transaction.Phase != installCommitted) ||
		security.ValidateModID(id) != nil ||
		(transaction.HadOld && transaction.OldMod == nil) ||
		(!transaction.HadOld && transaction.OldMod != nil) {
		return transaction, fmt.Errorf("invalid install recovery marker %q", path)
	}
	if transaction.NewMod.ID != id || (transaction.HadOld && transaction.OldMod.ID != id) {
		return transaction, fmt.Errorf("install recovery marker %q has mismatched mod metadata", path)
	}
	return transaction, nil
}

func recoverInstallTransaction(l *Library, preparedMarker, committedMarker string, transaction installTransaction, afterMarkerRemoved func(string) error) error {
	snapshot := installSnapshotPath(l, transaction.ID)
	destination := filepath.Join(l.ModsDir, transaction.ID)
	if transaction.Phase == installPrepared {
		if transaction.HadOld {
			if _, err := os.Stat(snapshot); err != nil {
				return fmt.Errorf("cannot restore interrupted upgrade %q: snapshot unavailable: %w", transaction.ID, err)
			}
			if err := restoreSnapshot(snapshot, destination); err != nil {
				return err
			}
			l.manifest.Mods[transaction.ID] = *transaction.OldMod
		} else {
			if err := os.RemoveAll(destination); err != nil {
				return err
			}
			delete(l.manifest.Mods, transaction.ID)
		}
		if err := l.Persist(); err != nil {
			return err
		}
	} else {
		info, err := os.Stat(destination)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return committedInstallDestinationError(transaction.ID, "is missing")
			}
			return err
		}
		if !info.IsDir() {
			return committedInstallDestinationError(transaction.ID, "is not a directory")
		}
		l.manifest.Mods[transaction.ID] = transaction.NewMod
		if err := l.Persist(); err != nil {
			return err
		}
	}

	if err := removeIfExists(preparedMarker); err != nil {
		return err
	}
	if err := removeIfExists(committedMarker); err != nil {
		return err
	}
	if err := syncLibraryDir(l.BackupsDir); err != nil {
		return err
	}
	if afterMarkerRemoved != nil {
		if err := afterMarkerRemoved(transaction.ID); err != nil {
			return err
		}
	}
	if err := os.RemoveAll(snapshot); err != nil {
		return err
	}
	return syncLibraryDir(filepath.Dir(snapshot))
}

func committedInstallDestinationError(id, reason string) error {
	return fmt.Errorf(
		"cannot recover committed install %q because its destination %s; the manifest, transaction markers, and snapshot were preserved. Preserve the library and backups, restore the destination and manifest from a trusted backup or source archive, then remove the markers only after verifying consistency",
		id,
		reason,
	)
}

func restoreSnapshot(snapshot, destination string) error {
	parent := filepath.Dir(destination)
	tmp, err := os.MkdirTemp(parent, ".modkeeper-tmp-restore-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	if err := copyTree(snapshot, tmp); err != nil {
		return err
	}
	if err := os.RemoveAll(destination); err != nil {
		return err
	}
	if err := os.Rename(tmp, destination); err != nil {
		return err
	}
	return syncLibraryDir(parent)
}

func removeIfExists(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func syncLibraryDir(path string) error {
	if os.PathSeparator == '\\' {
		return nil
	}
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
