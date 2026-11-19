// Package recovery implements the durable journal used while deleting library
// files. A journal is retained whenever recovery cannot prove the safe action.
package recovery

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/store"
)

const journalPrefix = ".modkeeper-delete-"
const journalSuffix = ".toml"
const quarantinePrefix = ".mkd-"

type Phase string

const (
	Staged    Phase = "staged"
	Committed Phase = "committed"
)

// Entry records the original path relative to LibraryRoot and its quarantine name.
type Entry struct {
	Original   string `toml:"original"`
	Quarantine string `toml:"quarantine"`
}

// Journal is the durable, versioned description of an in-progress deletion.
type Journal struct {
	Version     int     `toml:"version"`
	Token       string  `toml:"token"`
	LibraryID   string  `toml:"libraryId"`
	LibraryRoot string  `toml:"libraryRoot"`
	Phase       Phase   `toml:"phase"`
	Entries     []Entry `toml:"entries"`
}

// Transaction owns staged objects until Commit or Rollback.
type Transaction struct {
	path string
	data Journal
}

// Begin records the transaction before any move. Objects are root-relative paths.
func Begin(cfgPath, libraryID, libraryRoot string, objects ...string) (*Transaction, error) {
	root, err := filepath.Abs(libraryRoot)
	if err != nil {
		return nil, err
	}
	random := make([]byte, 16)
	if _, err = rand.Read(random); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(random)
	j := Journal{Version: 1, Token: token, LibraryID: libraryID, LibraryRoot: root, Phase: Staged}
	for i, original := range objects {
		clean := filepath.Clean(original)
		if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("unsafe deletion path %q", original)
		}
		if err := ensureNoLinkedParent(root, clean); err != nil {
			return nil, err
		}
		j.Entries = append(j.Entries, Entry{Original: clean, Quarantine: fmt.Sprintf("%s%s-%d", quarantinePrefix, token, i)})
	}
	if len(j.Entries) == 0 {
		return nil, errors.New("deletion transaction has no objects")
	}
	dir := filepath.Dir(cfgPath)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, journalPrefix+token+journalSuffix)
	if err = writeJournal(path, j, true); err != nil {
		return nil, err
	}
	tx := &Transaction{path: path, data: j}
	if err = tx.Stage(); err != nil {
		rb := tx.Rollback()
		if rb != nil {
			return nil, fmt.Errorf("%v; rollback pending: %w", err, rb)
		}
		return nil, err
	}
	return tx, nil
}

// Stage atomically renames each source into a bounded quarantine name in root.
func (t *Transaction) Stage() error {
	for _, e := range t.data.Entries {
		src := filepath.Join(t.data.LibraryRoot, e.Original)
		dst := filepath.Join(t.data.LibraryRoot, e.Quarantine)
		if _, err := os.Lstat(dst); err == nil {
			return fmt.Errorf("quarantine exists: %s", dst)
		}
		if err := ensureNoLinkedParent(t.data.LibraryRoot, e.Original); err != nil {
			return err
		}
		if err := os.Rename(src, dst); err != nil {
			return err
		}
	}
	return nil
}

// Commit marks deletion irreversible and removes quarantined objects.
func (t *Transaction) Commit() error {
	t.data.Phase = Committed
	if err := writeJournal(t.path, t.data, false); err != nil {
		return err
	}
	if err := removeEntries(t.data); err != nil {
		return err
	}
	return os.Remove(t.path)
}

// Rollback restores staged objects and removes the journal only after success.
func (t *Transaction) Rollback() error {
	if err := restore(t.data); err != nil {
		return err
	}
	return os.Remove(t.path)
}

// Recover resolves all deletion journals adjacent to cfgPath.
func Recover(cfgPath string) error {
	dir := filepath.Dir(cfgPath)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var failures []string
	for _, item := range entries {
		name := item.Name()
		if !strings.HasPrefix(name, journalPrefix) || !strings.HasSuffix(name, journalSuffix) {
			continue
		}
		path := filepath.Join(dir, name)
		if item.Type()&os.ModeSymlink != 0 || !item.Type().IsRegular() {
			failures = append(failures, path+": not a regular journal")
			continue
		}
		var j Journal
		if _, err := toml.DecodeFile(path, &j); err != nil {
			failures = append(failures, err.Error())
			continue
		}
		if _, err := os.Stat(cfgPath); errors.Is(err, os.ErrNotExist) {
			failures = append(failures, path+": config file missing")
			continue
		} else if err != nil {
			failures = append(failures, err.Error())
			continue
		}
		cfg, err := store.LoadFrom(cfgPath)
		if err != nil {
			failures = append(failures, err.Error())
			continue
		}
		registered := false
		for _, lib := range cfg.KnownLibraries {
			if filepath.Clean(lib.LibraryRoot) == filepath.Clean(j.LibraryRoot) {
				if lib.ID != j.LibraryID {
					failures = append(failures, path+": different library claims root")
					registered = false
					err = errors.New("blocked")
					break
				}
				registered = true
			}
		}
		if err != nil {
			continue
		}
		if registered {
			if j.Phase != Staged {
				failures = append(failures, path+": committed journal remains registered")
				continue
			}
			err = restore(j)
		} else {
			err = removeEntries(j)
		}
		if err == nil {
			err = os.Remove(path)
		}
		if err != nil {
			failures = append(failures, path+": "+err.Error())
		}
	}
	if len(failures) != 0 {
		return errors.New(strings.Join(failures, "; "))
	}
	return nil
}

func restore(j Journal) error {
	for i := len(j.Entries) - 1; i >= 0; i-- {
		e := j.Entries[i]
		src, dst := filepath.Join(j.LibraryRoot, e.Quarantine), filepath.Join(j.LibraryRoot, e.Original)
		_, se := os.Lstat(src)
		_, de := os.Lstat(dst)
		if se == nil && de == nil {
			return fmt.Errorf("both original and quarantine exist: %s", e.Original)
		}
		if se == nil {
			if err := os.Rename(src, dst); err != nil {
				return err
			}
		} else if !errors.Is(se, os.ErrNotExist) {
			return se
		}
	}
	return nil
}

func removeEntries(j Journal) error {
	for _, e := range j.Entries {
		p := filepath.Join(j.LibraryRoot, e.Quarantine)
		if err := ensureNoLinkedParent(j.LibraryRoot, e.Quarantine); err != nil {
			return err
		}
		if err := os.RemoveAll(p); err != nil {
			return err
		}
	}
	return nil
}

func writeJournal(path string, j Journal, create bool) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".delete-journal-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err = tmp.Chmod(0600); err == nil {
		err = toml.NewEncoder(tmp).Encode(j)
	}
	if err == nil {
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if create {
		f, openErr := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if openErr != nil {
			return openErr
		}
		if _, err = f.Write([]byte{}); err == nil {
			err = f.Close()
		} else {
			_ = f.Close()
		}
		if err != nil {
			return err
		}
	}
	return os.Rename(tmp.Name(), path)
}

func ensureNoLinkedParent(root, rel string) error {
	root, _ = filepath.Abs(root)
	cur := root
	parts := strings.Split(filepath.Clean(rel), string(filepath.Separator))
	for _, part := range parts[:len(parts)-1] {
		cur = filepath.Join(cur, part)
		info, err := os.Lstat(cur)
		if errors.Is(err, os.ErrNotExist) {
			break
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing path through link: %s", cur)
		}
	}
	return nil
}

// EnsureNoOrphanQuarantine rejects recovery artifacts that have no active
// transaction. Purge callers run this before walking or unlinking deployment paths.
func EnsureNoOrphanQuarantine(root string) error { return ensureNoOrphanQuarantine(root) }

func ensureNoOrphanQuarantine(root string) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".mkp-") || name == ".modkeeper-purge-recovery.toml" {
			return fmt.Errorf("orphaned purge quarantine or recovery manifest: %s", filepath.Join(root, name))
		}
	}
	return nil
}
