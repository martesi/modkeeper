package deployment

import (
	"crypto/rand"
	"fmt"
	"github.com/martes/modkeeper/backend/models"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"unicode/utf8"
)

var purgeLock sync.Mutex

type purgeLink struct {
	path, raw, quarantine string
	info                  fs.FileInfo
}
type recoveryEntry struct {
	Original   string `toml:"original"`
	Quarantine string `toml:"quarantine"`
}
type purgeRecovery struct {
	Version int             `toml:"version"`
	Token   string          `toml:"token"`
	Entries []recoveryEntry `toml:"entries"`
}

func token() (string, error)  { var b [16]byte; _, e := rand.Read(b[:]); return fmt.Sprintf("%x", b), e }
func journal(l Layout) string { return filepath.Join(l.LibraryRoot, ".modkeeper-purge-recovery.toml") }
func planPurge(l Layout) ([]purgeLink, error) {
	// An orphaned quarantine in the library root means a previous purge did not
	// finish; refuse before walking anything.
	if entries, e := os.ReadDir(l.LibraryRoot); e == nil {
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), ".mkp-") {
				return nil, invalid(l, "Orphaned quarantine requires explicit recovery: "+filepath.Join(l.LibraryRoot, entry.Name()))
			}
		}
	}
	if _, e := os.Lstat(journal(l)); e == nil {
		return nil, invalid(l, "Purge recovery is pending; explicit recovery is required before retrying")
	} else if !os.IsNotExist(e) {
		return nil, ioError(e)
	}
	roots := ProtectedPaths(l.Rules)
	if l.Rules.ServerMods != "SPT/user/mods" {
		roots = append(roots, "SPT/user/mods")
	}
	var valid []string
	// Complete root validation before starting the first walk.
	for _, root := range roots {
		if !contained(l.GameRoot, root, true) {
			return nil, invalid(l, "Protected purge root is redirected: "+root)
		}
		p := filepath.Join(l.GameRoot, root)
		_, e := os.Lstat(p)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return nil, ioError(e)
		}
		valid = append(valid, p)
	}
	base, e := filepath.EvalSymlinks(l.LibraryRoot)
	if e != nil {
		return nil, ioError(e)
	}
	var links []purgeLink
	for _, root := range valid {
		e = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !utf8.ValidString(path) {
				return models.Fail(models.Unexpected)
			}
			if d.Type()&os.ModeSymlink == 0 {
				return nil
			}
			if strings.HasPrefix(d.Name(), ".mkp-") {
				return invalid(l, "Orphaned quarantine requires explicit recovery: "+path)
			}
			raw, err := os.Readlink(path)
			if err != nil {
				return nil
			}
			target := raw
			if !filepath.IsAbs(target) {
				target = filepath.Join(filepath.Dir(path), target)
			}
			resolved, err := filepath.EvalSymlinks(target)
			if err != nil || !within(base, resolved) {
				return nil
			}
			info, err := os.Lstat(path)
			if err != nil {
				return err
			}
			links = append(links, purgeLink{path: path, raw: raw, info: info})
			return nil
		})
		if e != nil {
			return nil, ioError(e)
		}
	}
	return links, nil
}
func verifyLink(link purgeLink, path string) error {
	info, e := os.Lstat(path)
	if e != nil {
		return ioError(e)
	}
	raw, e := os.Readlink(path)
	if e != nil || raw != link.raw || info.Mode()&os.ModeSymlink == 0 || !os.SameFile(link.info, info) {
		return collision(path)
	}
	return nil
}
func syncDir(path string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}
func syncLinks(links []purgeLink) error {
	dirs := map[string]bool{}
	for _, l := range links {
		dirs[filepath.Dir(l.path)] = true
	}
	for _, d := range sortedKeys(dirs) {
		if e := syncDir(d); e != nil {
			return e
		}
	}
	return nil
}

// Purge removes only links whose resolved target can be proven inside the library.
// Recorded copies are reconciled by Deploy, not by compatibility purge.
// ValidatePurge runs the purge preflight without mutating anything, so callers
// can reject a destructive operation before removing registrations.
func ValidatePurge(l Layout) error {
	_, err := planPurge(l)
	return err
}

func Purge(l Layout, _ []models.Mod) error {
	return purge(l, nil)
}

// PurgeWithProgress exposes the quarantine boundary to process-level recovery
// tests. The callback runs only after an owned link has been moved and while
// the package-wide purge lock is held. A non-nil callback must not call Purge
// or ValidatePurge; production callers should use Purge, which passes nil.
func PurgeWithProgress(l Layout, _ []models.Mod, afterQuarantine func()) error {
	return purge(l, afterQuarantine)
}

func purge(l Layout, afterQuarantine func()) error {
	purgeLock.Lock()
	defer purgeLock.Unlock()
	links, e := planPurge(l)
	if e != nil {
		return e
	}
	if len(links) == 0 {
		return nil
	}
	rec := purgeRecovery{Version: 2, Entries: []recoveryEntry{}}
	rec.Token, e = token()
	if e != nil {
		return ioError(e)
	}
	for i := range links {
		link := &links[i]
		if e = verifyLink(*link, link.path); e != nil {
			return e
		}
		parent, e := os.Stat(filepath.Dir(link.path))
		if e != nil {
			return ioError(e)
		}
		if parent.Mode().Perm()&0222 == 0 || parent.Mode().Perm()&0111 == 0 {
			return ioError(fmt.Errorf("link parent is not writable: %s", filepath.Dir(link.path)))
		}
		allocated := false
		for attempt := 0; attempt < 8; attempt++ {
			id, err := token()
			if err != nil {
				return ioError(err)
			}
			p := filepath.Join(filepath.Dir(link.path), ".mkp-"+id)
			_, err = os.Lstat(p)
			if os.IsNotExist(err) {
				link.quarantine = p
				allocated = true
				break
			}
			if err != nil {
				return ioError(err)
			}
		}
		if !allocated {
			return ioError(fmt.Errorf("unable to allocate quarantine beside %s", link.path))
		}
		original, e := filepath.Rel(l.GameRoot, link.path)
		if e != nil {
			return ioError(e)
		}
		quarantine, e := filepath.Rel(l.GameRoot, link.quarantine)
		if e != nil {
			return ioError(e)
		}
		rec.Entries = append(rec.Entries, recoveryEntry{original, quarantine})
	}
	// Exclusive create prevents replacing a journal owned by another process.
	f, e := os.OpenFile(journal(l), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return ioError(e)
	}
	e = encodeJournal(f, rec)
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e == nil {
		e = syncDir(l.LibraryRoot)
	}
	if e != nil {
		return ioError(e)
	}
	moved := 0
	rollback := func(primary error) error {
		for i := moved - 1; i >= 0; i-- {
			link := links[i]
			if _, err := os.Lstat(link.path); !os.IsNotExist(err) {
				return ioError(fmt.Errorf("%v; rollback target occupied; recovery pending", primary))
			}
			if err := verifyLink(link, link.quarantine); err != nil {
				return ioError(fmt.Errorf("%v; rollback refused: %v", primary, err))
			}
			if err := os.Rename(link.quarantine, link.path); err != nil {
				return ioError(fmt.Errorf("%v; rollback failed: %w", primary, err))
			}
		}
		if err := syncLinks(links); err != nil {
			return ioError(err)
		}
		if err := clearJournal(l, rec.Token); err != nil {
			return err
		}
		return ioError(primary)
	}
	for _, link := range links {
		rel, _ := filepath.Rel(l.GameRoot, link.path)
		if !contained(l.GameRoot, rel, false) {
			return rollback(collision(link.path))
		}
		if e = verifyLink(link, link.path); e != nil {
			return rollback(e)
		}
		if e = os.Rename(link.path, link.quarantine); e != nil {
			return rollback(e)
		}
		moved++
		if afterQuarantine != nil {
			afterQuarantine()
		}
	}
	if e = syncLinks(links); e != nil {
		return rollback(e)
	}
	// Validate the entire quarantine batch before the first irreversible unlink.
	for _, link := range links {
		if e = verifyLink(link, link.quarantine); e != nil {
			return rollback(e)
		}
	}
	for _, link := range links {
		rel, _ := filepath.Rel(l.GameRoot, link.quarantine)
		if !contained(l.GameRoot, rel, false) {
			return collision(link.quarantine)
		}
		if e = verifyLink(link, link.quarantine); e != nil {
			return e
		}
		if e = os.Remove(link.quarantine); e != nil {
			return ioError(e)
		}
	}
	if e = syncLinks(links); e != nil {
		return ioError(e)
	}
	return clearJournal(l, rec.Token)
}
