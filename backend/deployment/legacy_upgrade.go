package deployment

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

// upgradeLegacyDeployment runs under the mutation lock before planning Sync.
// Old records contain no durable proof of which game files the app created.
func upgradeLegacyDeployment(l Layout) error {
	path := l.Paths().Deployment
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return ioError(fmt.Errorf("inspect deployment record before upgrade: %w", err))
	}
	if !info.Mode().IsRegular() {
		return collision(path)
	}

	f, err := os.Open(path)
	if err != nil {
		return ioError(err)
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil {
		return ioError(err)
	}
	if !os.SameFile(info, opened) {
		return collision(path)
	}
	raw, err := io.ReadAll(f)
	if err != nil {
		return ioError(err)
	}
	var state DeploymentState
	md, err := toml.Decode(string(raw), &state)
	if err != nil {
		return invalid(l, "deployment.toml: "+err.Error())
	}
	// Signed/partially signed records must use normal recovery; never "upgrade"
	// a damaged current record or discard metadata from an unknown format.
	if md.IsDefined("file_id") || md.IsDefined("receipt") || md.IsDefined("sync_token") {
		return nil
	}
	// Any evidence of recovery-era Sync makes an unsigned record a possible
	// replacement, not legacy input. The normal path will reject it.
	if _, err := os.Lstat(filepath.Join(l.LibraryRoot, ownershipKeyName)); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return ioError(err)
	}
	journals, err := syncIntentJournalPaths(l)
	if err != nil {
		return ioError(err)
	}
	for _, journal := range journals {
		if _, err := os.Lstat(journal); err == nil {
			return nil
		} else if !os.IsNotExist(err) {
			return ioError(err)
		}
	}
	if !md.IsDefined("artifacts") || !md.IsDefined("created_dirs") || len(md.Undecoded()) != 0 {
		return invalid(l, "deployment.toml is not a recognized legacy deployment record")
	}
	for _, a := range state.Artifacts {
		if a.FileID != "" || a.Receipt != "" || !contained(l.GameRoot, a.Target, false) {
			return invalid(l, "deployment.toml has an invalid legacy artifact path")
		}
		target := filepath.Join(l.GameRoot, a.Target)
		_, err := os.Lstat(target)
		if err == nil || isLink(target) {
			return invalid(l, fmt.Sprintf("Legacy deployment still has %q. Back up or undeploy those files before upgrading; ModKeeper has not changed the game files.", target))
		}
		if !os.IsNotExist(err) {
			return ioError(fmt.Errorf("inspect legacy target %q: %w", target, err))
		}
	}
	// Leave all legacy directories alone, even when the record claims them.
	backup := path + ".pre-recovery"
	latest, err := os.Lstat(path)
	if err != nil || !os.SameFile(opened, latest) {
		return collision(path)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return ioError(err)
	}
	now, err := io.ReadAll(f)
	if err != nil {
		return ioError(err)
	}
	if !bytes.Equal(raw, now) {
		return collision(path)
	}
	// Windows cannot rename the record while os.Open's handle is open.
	if err := f.Close(); err != nil {
		return ioError(err)
	}
	if err := archiveLegacyRecord(path, backup); err != nil {
		return ioError(fmt.Errorf("preserve legacy deployment record as %q: %w", backup, err))
	}
	archived, err := os.Lstat(backup)
	if err != nil || !os.SameFile(opened, archived) {
		return collision(backup)
	}
	if err := syncDirectoryDurably(filepath.Dir(path)); err != nil {
		return ioError(fmt.Errorf("sync legacy deployment record archive: %w", err))
	}
	return nil
}
