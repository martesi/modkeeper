// Package deployment reconciles library-owned artifacts without removing user files.
package deployment

import (
	"errors"
	"fmt"
	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/spt"
	"github.com/zeebo/blake3"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type Layout struct {
	LibraryRoot, GameRoot string
	Rules                 spt.Rules
}
type Paths struct{ Mods, Staging, Backups, Manifest, Cache, Deployment, SyncIntent string }

func (l Layout) Paths() Paths {
	return Paths{filepath.Join(l.LibraryRoot, "mods"), filepath.Join(l.LibraryRoot, "staging"), filepath.Join(l.LibraryRoot, "backups"), filepath.Join(l.LibraryRoot, "manifest.toml"), filepath.Join(l.LibraryRoot, "cache.toml"), filepath.Join(l.LibraryRoot, "deployment-v2.toml"), filepath.Join(l.LibraryRoot, "sync-intent.toml")}
}

type DeploymentArtifact struct {
	Target      string              `toml:"target"`
	Source      string              `toml:"source"`
	Kind        linker.ArtifactKind `toml:"kind"`
	Fingerprint *string             `toml:"fingerprint,omitempty"`
	FileID      string              `toml:"file_id,omitempty"`
	Receipt     string              `toml:"receipt,omitempty"`
}
type DeploymentState struct {
	Artifacts     []DeploymentArtifact    `toml:"artifacts"`
	CreatedDirs   []string                `toml:"created_dirs"`
	Method        models.DeploymentMethod `toml:"method,omitempty"`
	TargetRuntime models.TargetRuntime    `toml:"target_runtime,omitempty"`
	SyncToken     string                  `toml:"sync_token,omitempty"`
	FileID        string                  `toml:"file_id,omitempty"`
	Receipt       string                  `toml:"receipt,omitempty"`
}
type DeploymentPlan struct {
	Artifacts     []DeploymentArtifact
	Directories   []string
	Method        models.DeploymentMethod
	TargetRuntime models.TargetRuntime
}

// The helpers below preserve the error-code/data contract on the wire.
func collision(path string) error {
	return models.Fail(models.FileCollision, []string{fmt.Sprintf("Deployment target already exists or cannot be safely removed: '%s'.", path)})
}
func invalid(l Layout, detail string) error {
	return models.Fail(models.InvalidLibrary, l.LibraryRoot, detail)
}
func ioError(err error) error {
	if err == nil {
		return nil
	}
	var coded *models.Error
	if errors.As(err, &coded) {
		return err
	}
	return models.Fail(models.IOError, err.Error())
}
func ProtectedPaths(r spt.Rules) []string { return []string{r.ServerMods, r.ClientPlugins} }
func IsProtected(path string, r spt.Rules) bool {
	for _, p := range ProtectedPaths(r) {
		if filepath.Clean(path) == filepath.Clean(p) {
			return true
		}
	}
	return false
}
func safeRelative(p string) bool {
	if p == "" || !filepath.IsLocal(p) || (filepath.Separator != '\\' && strings.Contains(p, "\\")) || strings.Contains(p, ":") {
		return false
	}
	for _, c := range strings.Split(filepath.ToSlash(p), "/") {
		if c == ".." {
			return false
		}
	}
	return true
}
func pathKey(p string) string { return filepath.ToSlash(filepath.Clean(p)) }
func within(base, path string) bool {
	rel, err := filepath.Rel(base, path)
	return err == nil && (rel == "." || safeRelative(rel))
}

// Check each ancestor without following redirects, including redirects within game root.
func contained(base, rel string, directory bool) bool {
	if !safeRelative(rel) {
		return false
	}
	if _, err := filepath.EvalSymlinks(base); err != nil {
		return false
	}
	parts := strings.Split(filepath.Clean(rel), string(filepath.Separator))
	n := len(parts)
	if !directory {
		n--
	}
	p := base
	for _, c := range parts[:n] {
		p = filepath.Join(p, c)
		m, e := os.Lstat(p)
		if os.IsNotExist(e) {
			return true
		}
		if e != nil || !m.IsDir() || m.Mode()&os.ModeSymlink != 0 {
			return false
		}
	}
	return true
}
func sourcePath(l Layout, rel string, existing bool) (string, bool) {
	if !safeRelative(rel) {
		return "", false
	}
	p := filepath.Join(l.LibraryRoot, rel)
	base, e := filepath.EvalSymlinks(l.LibraryRoot)
	if e != nil {
		return "", false
	}
	check := p
	if !existing {
		check = filepath.Dir(p)
	}
	for {
		resolved, err := filepath.EvalSymlinks(check)
		if err == nil {
			return p, within(base, resolved)
		}
		if !os.IsNotExist(err) || check == filepath.Dir(check) {
			return "", false
		}
		check = filepath.Dir(check)
	}
}

func isLink(path string) bool {
	_, err := os.Readlink(path)
	return err == nil
}
func fingerprint(p string) (string, error) {
	f, e := os.Open(p)
	if e != nil {
		return "", e
	}
	defer f.Close()
	return fingerprintFile(f)
}

func fingerprintFile(f *os.File) (string, error) {
	h := blake3.New()
	if _, e := f.Seek(0, io.SeekStart); e != nil {
		return "", e
	}
	if _, e := io.Copy(h, f); e != nil {
		return "", e
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}
func linkMatches(source, target string) bool {
	raw, e := os.Readlink(target)
	if e != nil {
		return false
	}
	if !filepath.IsAbs(raw) {
		raw = filepath.Join(filepath.Dir(target), raw)
	}
	if filepath.Clean(raw) == filepath.Clean(source) {
		return true
	}
	a, e := filepath.EvalSymlinks(raw)
	if e != nil {
		return false
	}
	b, e := filepath.EvalSymlinks(source)
	return e == nil && a == b
}
func recorded(l Layout, a DeploymentArtifact) (bool, error) {
	if !contained(l.GameRoot, a.Target, false) {
		return false, nil
	}
	_, ok := sourcePath(l, a.Source, false)
	if !ok {
		return false, nil
	}
	target := filepath.Join(l.GameRoot, a.Target)
	_, e := os.Lstat(target)
	if os.IsNotExist(e) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if live, liveErr := liveArtifactMatches(l, a, target); liveErr != nil || live {
		return live, liveErr
	}
	return verifyOwnershipReceipt(l, a, target), nil
}
func current(l Layout, a DeploymentArtifact) (bool, error) {
	ok, e := recorded(l, a)
	if e != nil || !ok {
		return ok, e
	}
	source, ok := sourcePath(l, a.Source, true)
	if !ok {
		return false, nil
	}
	if a.Kind == linker.Symlink || a.Kind == linker.Junction {
		return true, nil
	}
	sourceFingerprint, err := fingerprint(source)
	if err != nil {
		return false, err
	}
	targetFingerprint, err := fingerprint(filepath.Join(l.GameRoot, a.Target))
	return err == nil && sourceFingerprint == targetFingerprint, err
}
func equal(a, b DeploymentArtifact) bool {
	return pathKey(a.Target) == pathKey(b.Target) && pathKey(a.Source) == pathKey(b.Source) && a.Kind == b.Kind && ((a.Fingerprint == nil && b.Fingerprint == nil) || (a.Fingerprint != nil && b.Fingerprint != nil && *a.Fingerprint == *b.Fingerprint))
}
func LoadState(l Layout) (DeploymentState, error) {
	state := DeploymentState{Artifacts: []DeploymentArtifact{}, CreatedDirs: []string{}}
	path := l.Paths().Deployment
	info, e := os.Lstat(path)
	if os.IsNotExist(e) {
		return state, checkLegacyDeployment(l)
	}
	if e != nil {
		return state, invalid(l, "deployment-v2.toml: "+e.Error())
	}
	if !info.Mode().IsRegular() {
		return state, invalid(l, "deployment-v2.toml is not a regular file")
	}
	if _, e = toml.DecodeFile(path, &state); e != nil {
		return state, invalid(l, "deployment-v2.toml: "+e.Error())
	}
	for i, p := range state.CreatedDirs {
		if filepath.IsAbs(p) && within(l.GameRoot, p) {
			rel, _ := filepath.Rel(l.GameRoot, p)
			if rel != "." {
				state.CreatedDirs[i] = rel
			}
		}
	}
	return state, nil
}
func SaveState(l Layout, state DeploymentState) error {
	release, err := acquireMutationLock(l)
	if err != nil {
		return ioError(fmt.Errorf("lock deployment state mutation: %w", err))
	}
	defer release()
	if err := CheckNoPendingSync(l); err != nil {
		return err
	}
	return saveState(l, state)
}

func saveState(l Layout, state DeploymentState) error {
	return writeDeploymentState(l, state)
}
func writeTOML(path string, value any) error {
	f, e := os.CreateTemp(filepath.Dir(path), ".deployment-write-")
	if e != nil {
		return ioError(e)
	}
	name := f.Name()
	defer os.Remove(name)
	e = toml.NewEncoder(f).Encode(value)
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e == nil {
		e = os.Rename(name, path)
	}
	if e == nil {
		e = syncDirectoryDurably(filepath.Dir(path))
	}
	return ioError(e)
}

// VerifyOwnership checks that every recorded artifact still matches the state
// the library owns. A replaced or missing artifact blocks destructive deletes.
func VerifyOwnership(l Layout) error {
	release, lockErr := acquireMutationLock(l)
	if lockErr != nil {
		return ioError(fmt.Errorf("lock ownership verification: %w", lockErr))
	}
	defer release()
	if err := CheckNoPendingSync(l); err != nil {
		return err
	}
	return verifyOwnership(l)
}

func verifyOwnership(l Layout) error {
	state, err := LoadState(l)
	if err != nil {
		return err
	}
	for _, artifact := range state.Artifacts {
		target := resolveRecorded(l.GameRoot, artifact.Target)
		owned, ownershipErr := recorded(l, artifact)
		if ownershipErr != nil {
			return ioError(ownershipErr)
		}
		if !owned {
			return models.Fail("InvalidLibrary", target, "artifact ownership is not pinned in this process")
		}
	}
	return nil
}

// SnapshotFingerprint exposes the content fingerprint for callers that need to
// verify ownership outside this package (deletion guards, tests).
func SnapshotFingerprint(path string) (string, error) { return fingerprint(path) }

// resolveRecorded makes a recorded relative path absolute against its root.
func resolveRecorded(root, path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(root, path)
}
