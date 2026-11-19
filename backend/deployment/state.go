// Package deployment reconciles library-owned artifacts without removing user files.
package deployment

import (
	"fmt"
	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/linker"
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
type Paths struct{ Mods, Staging, Backups, Manifest, Cache, Deployment string }

func (l Layout) Paths() Paths {
	return Paths{filepath.Join(l.LibraryRoot, "mods"), filepath.Join(l.LibraryRoot, "staging"), filepath.Join(l.LibraryRoot, "backups"), filepath.Join(l.LibraryRoot, "manifest.toml"), filepath.Join(l.LibraryRoot, "cache.toml"), filepath.Join(l.LibraryRoot, "deployment.toml")}
}

type DeploymentArtifact struct {
	Target      string              `toml:"target"`
	Source      string              `toml:"source"`
	Kind        linker.ArtifactKind `toml:"kind"`
	Fingerprint *string             `toml:"fingerprint,omitempty"`
}
type DeploymentState struct {
	Artifacts   []DeploymentArtifact `toml:"artifacts"`
	CreatedDirs []string             `toml:"created_dirs"`
}
type DeploymentPlan struct {
	Artifacts   []DeploymentArtifact
	Directories []string
}

// Error keeps the Rust error-code/data contract independent of library services.
type Error struct {
	Code string
	Data any
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %v", e.Code, e.Data) }
func collision(path string) error {
	return &Error{"FileCollision", []string{fmt.Sprintf("Deployment target already exists or cannot be safely removed: '%s'.", path)}}
}
func invalid(l Layout, detail string) error {
	return &Error{"InvalidLibrary", []string{l.LibraryRoot, detail}}
}
func ioError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := err.(*Error); ok {
		return err
	}
	return &Error{"IOError", err.Error()}
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
	if p == "" || filepath.IsAbs(p) || strings.Contains(p, "\\") || strings.Contains(p, ":") {
		return false
	}
	for _, c := range strings.Split(filepath.ToSlash(p), "/") {
		if c == ".." {
			return false
		}
	}
	return true
}
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
func fingerprint(p string) (string, error) {
	f, e := os.Open(p)
	if e != nil {
		return "", e
	}
	defer f.Close()
	h := blake3.New()
	if _, e = io.Copy(h, f); e != nil {
		return "", e
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}
func sameContents(a, b string) (bool, error) {
	ma, e := os.Stat(a)
	if os.IsNotExist(e) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	mb, e := os.Stat(b)
	if e != nil {
		return false, e
	}
	if !ma.Mode().IsRegular() || !mb.Mode().IsRegular() || ma.Size() != mb.Size() {
		return false, nil
	}
	ha, e := fingerprint(a)
	if e != nil {
		return false, e
	}
	hb, e := fingerprint(b)
	return ha == hb, e
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
	source, ok := sourcePath(l, a.Source, false)
	if !ok {
		return false, nil
	}
	target := filepath.Join(l.GameRoot, a.Target)
	m, e := os.Lstat(target)
	if os.IsNotExist(e) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	switch a.Kind {
	case linker.Symlink, linker.Junction:
		return linkMatches(source, target), nil
	case linker.Hardlink:
		sm, e := os.Stat(source)
		return e == nil && m.Mode().IsRegular() && os.SameFile(sm, m), nil
	case linker.Copy:
		if !m.Mode().IsRegular() || a.Fingerprint == nil {
			return false, nil
		}
		h, e := fingerprint(target)
		return e == nil && h == *a.Fingerprint, e
	}
	return false, nil
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
	return sameContents(source, filepath.Join(l.GameRoot, a.Target))
}
func equal(a, b DeploymentArtifact) bool {
	return a.Target == b.Target && a.Source == b.Source && a.Kind == b.Kind && ((a.Fingerprint == nil && b.Fingerprint == nil) || (a.Fingerprint != nil && b.Fingerprint != nil && *a.Fingerprint == *b.Fingerprint))
}
func LoadState(l Layout) (DeploymentState, error) {
	state := DeploymentState{Artifacts: []DeploymentArtifact{}, CreatedDirs: []string{}}
	_, e := toml.DecodeFile(l.Paths().Deployment, &state)
	if os.IsNotExist(e) {
		return state, nil
	}
	if e != nil {
		return state, invalid(l, "deployment.toml: "+e.Error())
	}
	migrated := false
	for i, p := range state.CreatedDirs {
		if filepath.IsAbs(p) && within(l.GameRoot, p) {
			rel, _ := filepath.Rel(l.GameRoot, p)
			if rel != "." {
				state.CreatedDirs[i] = rel
			}
		}
	}
	for i, a := range state.Artifacts {
		if a.Kind != linker.Copy || a.Fingerprint != nil || !contained(l.GameRoot, a.Target, false) {
			continue
		}
		source, ok := sourcePath(l, a.Source, true)
		if !ok {
			continue
		}
		target := filepath.Join(l.GameRoot, a.Target)
		m, e := os.Lstat(target)
		if e != nil || !m.Mode().IsRegular() {
			continue
		}
		ok, e = sameContents(source, target)
		if e != nil {
			return state, ioError(e)
		}
		if ok {
			h, e := fingerprint(target)
			if e != nil {
				return state, ioError(e)
			}
			state.Artifacts[i].Fingerprint = &h
			migrated = true
		}
	}
	if migrated {
		if e := SaveState(l, state); e != nil {
			return state, e
		}
	}
	return state, nil
}
func SaveState(l Layout, state DeploymentState) error { return writeTOML(l.Paths().Deployment, state) }
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
	return ioError(e)
}
