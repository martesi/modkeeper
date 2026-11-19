// Package library owns library manifests, workspace assembly, and library CRUD.
package library

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/deployment"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/registry"
	"github.com/martes/modkeeper/backend/spt"
	"github.com/martes/modkeeper/backend/store"
)

type manifest struct {
	ID         string                `toml:"id"`
	Name       string                `toml:"name"`
	GameRoot   string                `toml:"gameRoot"`
	SPTVersion string                `toml:"sptVersion"`
	Mods       map[string]models.Mod `toml:"mods"`
	IsDirty    bool                  `toml:"isDirty"`
}
type cache struct {
	Mods map[string]any `toml:"mods"`
}
type Library struct {
	manifest                        manifest
	Root, GameRoot                  string
	ModsDir, StagingDir, BackupsDir string
}

func layout(root string) (manifest, cache, string, string, string, error) {
	var m manifest
	var c cache
	// repo_root *is* the library root (`game/.mod_keeper`), matching Rust's
	// LibPathRules::new(repo_root).
	base := root
	if _, err := toml.DecodeFile(filepath.Join(base, "manifest.toml"), &m); err != nil {
		return m, c, "", "", "", err
	}
	if _, err := toml.DecodeFile(filepath.Join(base, "cache.toml"), &c); err != nil {
		return m, c, "", "", "", err
	}
	return m, c, filepath.Join(base, "mods"), filepath.Join(base, "staging"), filepath.Join(base, "backups"), nil
}

func resolveGameRoot(root, stored string) string {
	if filepath.IsAbs(stored) {
		return stored
	}
	if runtime.GOOS != "windows" && len(stored) >= 3 && stored[1] == ':' && (stored[2] == '\\' || stored[2] == '/') {
		if filepath.Base(root) == ".mod_keeper" {
			return filepath.Dir(root)
		}
		return stored
	}
	return filepath.Clean(filepath.Join(root, stored))
}

func versionOf(game string) (string, error) {
	rules, err := spt.Discover(game)
	if err != nil {
		return "", err
	}
	version, err := spt.ReadVersion(game)
	if err != nil {
		return "", err
	}
	if err := spt.ValidateVersion(rules, version); err != nil {
		return "", err
	}
	return version, nil
}

func Create(game, root, name string) (*Library, error) {
	if root == "" {
		root = filepath.Join(game, ".mod_keeper")
	}
	if name == "" {
		name = filepath.Base(filepath.Clean(game))
	}
	v, err := versionOf(game)
	if err != nil {
		return nil, err
	}
	base := root
	for _, d := range []string{"mods", "staging", "backups"} {
		if err = os.MkdirAll(filepath.Join(base, d), 0700); err != nil {
			return nil, err
		}
	}
	l := &Library{manifest: manifest{ID: config.NewID(), Name: name, GameRoot: game, SPTVersion: v, Mods: map[string]models.Mod{}}, Root: root, GameRoot: game, ModsDir: filepath.Join(base, "mods"), StagingDir: filepath.Join(base, "staging"), BackupsDir: filepath.Join(base, "backups")}
	return l, l.Persist()
}
func Load(root string) (*Library, error) {
	m, _, mods, staging, backups, err := layout(root)
	if err != nil {
		return nil, fmt.Errorf("InvalidLibrary: %s: %w", root, err)
	}
	game := resolveGameRoot(root, m.GameRoot)
	current, err := versionOf(game)
	if err != nil {
		return nil, err
	}
	major := func(v string) string { return strings.Split(v, ".")[0] }
	if major(current) != major(m.SPTVersion) {
		return nil, fmt.Errorf("InvalidLibrary: SPT major version changed from %s to %s", m.SPTVersion, current)
	}
	if m.Mods == nil {
		m.Mods = map[string]models.Mod{}
	}
	return &Library{manifest: m, Root: root, GameRoot: game, ModsDir: mods, StagingDir: staging, BackupsDir: backups}, nil
}
func (l *Library) Persist() error {
	base := l.Root
	m := l.manifest
	rel, err := filepath.Rel(l.GameRoot, l.Root)
	if err == nil && !strings.HasPrefix(rel, "..") {
		depth := strings.Count(rel, string(os.PathSeparator)) + 1
		m.GameRoot = strings.Repeat("../", depth)
		m.GameRoot = strings.TrimSuffix(m.GameRoot, "/")
	}
	// deployment.toml is owned by the deployment package; rewriting it here
	// erased the recorded artifacts and made delete/ownership checks vacuous.
	for file, v := range map[string]any{"manifest.toml": m, "cache.toml": l.cacheTOML()} {
		f, e := os.CreateTemp(base, ".tmp-*")
		if e != nil {
			return e
		}
		tmp := f.Name()
		e = toml.NewEncoder(f).Encode(v)
		ce := f.Close()
		if e == nil {
			e = ce
		}
		if e == nil {
			e = os.Rename(tmp, filepath.Join(base, file))
		}
		if e != nil {
			_ = os.Remove(tmp)
			return e
		}
	}
	return nil
}
func (l *Library) DTO() models.LibraryDTO {
	return models.LibraryDTO{ID: l.manifest.ID, Name: l.manifest.Name, GameRoot: l.GameRoot, RepoRoot: l.Root, SPTVersion: l.manifest.SPTVersion, Mods: l.manifest.Mods, IsDirty: l.manifest.IsDirty}
}

type Service struct {
	Store         *store.AppConfigStore
	Registry      *registry.TaskRegistry
	active        *Library
	warning       *string
	sendProgress  func(models.TaskProgressEvent) error
	sendWorkspace func(models.WorkspaceEvent) error
	tasks         sync.WaitGroup
	// copyMod is copyTree in production; tests inject failures to exercise the
	// upgrade snapshot restore path.
	copyMod   func(src, dst string) error
	modWrites sync.Mutex
}

// DeriveLibraryRoot returns the default library location for a game install.
func DeriveLibraryRoot(gameRoot string) string {
	return filepath.Join(gameRoot, ".mod_keeper")
}

// DeriveLibraryRootForSPT returns an isolated library location for an SPT version.
func DeriveLibraryRootForSPT(gameRoot, version string) string {
	return filepath.Join(gameRoot, ".mod_keeper-spt-"+version)
}

// ValidateLibraryStructure checks the on-disk files required by a library.
func ValidateLibraryStructure(root string) error {
	if _, err := os.Stat(filepath.Join(root, "manifest.toml")); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("InvalidLibrary: %s: manifest.toml is missing", root)
		}
		return fmt.Errorf("InvalidLibrary: %s: manifest.toml is invalid or unreadable: %w", root, err)
	}
	var m manifest
	if _, err := toml.DecodeFile(filepath.Join(root, "manifest.toml"), &m); err != nil {
		return fmt.Errorf("InvalidLibrary: %s: manifest.toml is invalid or unreadable: %w", root, err)
	}
	for _, dir := range []string{"mods", "backups", "staging"} {
		path := filepath.Join(root, dir)
		info, err := os.Stat(path)
		if os.IsNotExist(err) {
			return fmt.Errorf("InvalidLibrary: %s: missing required directory: %s", root, dir)
		}
		if err != nil {
			return fmt.Errorf("InvalidLibrary: %s: %w", root, err)
		}
		if !info.IsDir() {
			return fmt.Errorf("InvalidLibrary: %s: expected directory but found file: %s", root, dir)
		}
	}
	return nil
}

func New(path string) (*Service, error) {
	c, e := store.LoadFrom(path)
	if e != nil {
		return nil, e
	}
	return &Service{Store: &store.AppConfigStore{Path: path, Config: c}, Registry: registry.NewTaskRegistry()}, nil
}
func (s *Service) Start() error {
	if id := s.Store.Config.AppState.ActiveLibraryID; id != nil {
		if k := s.Store.Config.FindLibrary(*id); k != nil {
			go func() {
				l, e := Load(k.LibraryRoot)
				if e == nil {
					s.active = l
					s.Registry.SetActive(l.manifest.ID, true)
				} else {
					s.warning = strPtr(e.Error())
				}
				s.Registry.FinishStartupLoad(e)
			}()
			return nil
		}
	}
	s.Registry.FinishStartupLoad(nil)
	return nil
}
func strPtr(s string) *string { return &s }
func (s *Service) Workspace() *models.LibraryWorkspace {
	w := &models.LibraryWorkspace{ActiveLibraryID: s.Store.Config.AppState.ActiveLibraryID, Libraries: []models.LibraryEntry{}, ModsByLibraryID: map[string][]models.ModSummary{}, ToolsByLibraryID: map[string][]models.ToolSummary{}, Settings: s.Store.Config.Settings, ConfigWarning: s.warning}
	for _, k := range s.Store.Config.KnownLibraries {
		m, _, mods, _, _, e := layout(k.LibraryRoot)
		if e != nil {
			w.Libraries = append(w.Libraries, models.StubEntry(k.LibraryRoot))
			continue
		}
		game := resolveGameRoot(k.LibraryRoot, m.GameRoot)
		stamp := time.Now().UTC().Format(time.RFC3339)
		w.Libraries = append(w.Libraries, models.SummaryEntry(models.LibrarySummary{ID: k.ID, Name: m.Name, GameRoot: game, LibraryRoot: k.LibraryRoot, SPTVersion: &m.SPTVersion, CacheStatus: models.CacheStatus{State: models.CacheStateReady}, DeployStale: m.IsDirty, UpdatedAt: stamp}))
		rows := []models.ModSummary{}
		for _, v := range m.Mods {
			installed := filepath.Join(mods, v.ID)
			rows = append(rows, models.ModSummary{ID: v.ID, LibraryID: k.ID, Name: v.Name, Type: v.Type, IsEnabled: v.Enabled, InstalledPath: &installed, Source: &v.Source, UpdatedAt: stamp})
		}
		w.ModsByLibraryID[k.ID] = rows
		w.ToolsByLibraryID[k.ID] = []models.ToolSummary{}
	}
	s.warning = nil
	w.ConfigWarning = s.warning
	return w
}
func (s *Service) CreateLibrary(in models.CreateLibraryInput) error {
	root := ""
	if in.LibraryRoot != nil {
		root = *in.LibraryRoot
	}
	name := ""
	if in.Name != nil {
		name = *in.Name
	}
	if root == "" {
		root = DeriveLibraryRoot(in.GameRoot)
	}
	if _, statErr := os.Stat(root); statErr == nil {
		existing, loadErr := Load(root)
		if loadErr != nil && in.LibraryRoot == nil && strings.Contains(loadErr.Error(), "SPT major version changed") {
			version, versionErr := versionOf(in.GameRoot)
			if versionErr != nil {
				return versionErr
			}
			root = DeriveLibraryRootForSPT(in.GameRoot, version)
			if _, versionedErr := os.Stat(root); versionedErr == nil {
				existing, loadErr = Load(root)
				if loadErr == nil {
					l := existing
					prev := s.Store.Config
					s.Store.Config.UpsertLibrary(config.KnownLibrary{ID: l.manifest.ID, LibraryRoot: root})
					s.Store.Config.AppState.ActiveLibraryID = &l.manifest.ID
					if err := s.Store.Save(); err != nil {
						s.Store.Config = prev
						return err
					}
					s.active = l
					s.Registry.SetActive(l.manifest.ID, true)
					return nil
				}
				return fmt.Errorf("InvalidLibrary: %s: %w", root, loadErr)
			} else if !os.IsNotExist(versionedErr) {
				return versionedErr
			}
			statErr = os.ErrNotExist
		}
		if loadErr != nil && in.LibraryRoot != nil {
			// The Wails setup flow may pass a pre-created empty destination
			// tree. Accept that explicit scaffold, but do not adopt a malformed
			// default-root library.
			empty := true
			for _, dir := range []string{"mods", "backups", "staging"} {
				entries, readErr := os.ReadDir(filepath.Join(root, dir))
				if readErr != nil || len(entries) != 0 {
					empty = false
					break
				}
			}
			if empty {
				for _, dir := range []string{"mods", "backups", "staging"} {
					_ = os.Remove(filepath.Join(root, dir))
				}
				_ = os.Remove(root)
				statErr = os.ErrNotExist
			}
		}
		if statErr == nil {
			if loadErr != nil {
				return fmt.Errorf("InvalidLibrary: %s: %w", root, loadErr)
			}
			l := existing
			prev := s.Store.Config
			s.Store.Config.UpsertLibrary(config.KnownLibrary{ID: l.manifest.ID, LibraryRoot: root})
			s.Store.Config.AppState.ActiveLibraryID = &l.manifest.ID
			if err := s.Store.Save(); err != nil {
				s.Store.Config = prev
				return err
			}
			s.active = l
			s.Registry.SetActive(l.manifest.ID, true)
			return nil
		}
	}
	if _, statErr := os.Stat(root); statErr != nil && !os.IsNotExist(statErr) {
		return statErr
	}
	l, e := Create(in.GameRoot, root, name)
	if e != nil {
		return e
	}
	prev := s.Store.Config
	s.Store.Config.UpsertLibrary(config.KnownLibrary{ID: l.manifest.ID, LibraryRoot: l.Root})
	s.Store.Config.AppState.ActiveLibraryID = &l.manifest.ID
	if e = s.Store.Save(); e != nil {
		s.Store.Config = prev
		return e
	}
	s.active = l
	s.Registry.SetActive(l.manifest.ID, true)
	return nil
}
func (s *Service) ActivateLibrary(id string) error {
	k := s.Store.Config.FindLibrary(id)
	if k == nil {
		return fmt.Errorf("InvalidLibrary: Library not registered")
	}
	l, e := Load(k.LibraryRoot)
	if e != nil {
		return e
	}
	prev := s.Store.Config
	s.Store.Config.AppState.ActiveLibraryID = &id
	if e = s.Store.Save(); e != nil {
		s.Store.Config = prev
		return e
	}
	s.active = l
	s.Registry.SetActive(id, true)
	return nil
}
func (s *Service) RenameLibrary(id, name string) error {
	k := s.Store.Config.FindLibrary(id)
	if k == nil {
		return fmt.Errorf("InvalidLibrary: Library not registered")
	}
	m, _, _, _, _, e := layout(k.LibraryRoot)
	if e != nil {
		return e
	}
	m.Name = name
	b := filepath.Join(k.LibraryRoot, "manifest.toml")
	f, e := os.CreateTemp(filepath.Dir(b), ".tmp-*")
	if e != nil {
		return e
	}
	tmp := f.Name()
	e = toml.NewEncoder(f).Encode(m)
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e == nil {
		e = os.Rename(tmp, b)
	}
	if e != nil {
		_ = os.Remove(tmp)
	}
	if e == nil && s.active != nil && s.active.manifest.ID == id {
		s.active.manifest.Name = name
	}
	return e
}
func (s *Service) DeleteLibrary(id string, deleteFiles bool) error {
	k := s.Store.Config.FindLibraryByHandle(id)
	if k == nil {
		return fmt.Errorf("InvalidLibrary: Library not registered")
	}
	// Validate the purge and every recorded deployment artifact BEFORE touching
	// config or disk, matching the Rust delete ordering.
	var depLayout deployment.Layout
	var mods []models.Mod
	if deleteFiles {
		m, _, _, _, _, err := layout(k.LibraryRoot)
		if err == nil {
			gameRoot := resolveGameRoot(k.LibraryRoot, m.GameRoot)
			rules, discoverErr := spt.Discover(gameRoot)
			if discoverErr != nil {
				return discoverErr
			}
			depLayout = deployment.Layout{LibraryRoot: k.LibraryRoot, GameRoot: gameRoot, Rules: rules}
			if err := deployment.VerifyOwnership(depLayout); err != nil {
				return err
			}
			if err := deployment.ValidatePurge(depLayout); err != nil {
				return err
			}
			mods = sortedMods(m.Mods)
		}
	}
	prev := s.Store.Config
	s.Store.Config.RemoveLibrary(k.ID)
	if e := s.Store.Save(); e != nil {
		s.Store.Config = prev
		return e
	}
	if s.active != nil && s.active.manifest.ID == k.ID {
		s.active = nil
		s.Registry.SetActive("", false)
	}
	if deleteFiles {
		if depLayout.LibraryRoot != "" {
			if err := deployment.Purge(depLayout, mods); err != nil {
				return err
			}
		}
		// Remove only the known library payload. Any unrecorded content keeps
		// its parent directory in place.
		for _, dir := range []string{"mods", "staging", "backups"} {
			_ = os.Remove(filepath.Join(k.LibraryRoot, dir))
		}
		for _, file := range []string{"manifest.toml", "cache.toml", "deployment.toml"} {
			_ = os.Remove(filepath.Join(k.LibraryRoot, file))
		}
		if entries, e := os.ReadDir(k.LibraryRoot); e == nil && len(entries) == 0 {
			return os.Remove(k.LibraryRoot)
		}
	}
	return nil
}
func (s *Service) GetSettings() config.AppSettings { return s.Store.Config.Settings }
func (s *Service) SaveSettings(v config.AppSettings) (config.AppSettings, error) {
	old := s.Store.Config.Settings
	s.Store.Config.Settings = v
	if e := s.Store.Save(); e != nil {
		s.Store.Config.Settings = old
		return config.AppSettings{}, e
	}
	return v, nil
}

// modList returns manifest mods in deterministic order for deployment planning.
func (l *Library) modList() []models.Mod { return sortedMods(l.manifest.Mods) }

func sortedMods(source map[string]models.Mod) []models.Mod {
	ids := make([]string, 0, len(source))
	for id := range source {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	mods := make([]models.Mod, 0, len(ids))
	for _, id := range ids {
		mods = append(mods, source[id])
	}
	return mods
}

// cacheTOML preserves the on-disk cache instead of clobbering it on every save.
func (l *Library) cacheTOML() any {
	var existing cache
	if _, err := toml.DecodeFile(filepath.Join(l.Root, "cache.toml"), &existing); err == nil {
		return existing
	}
	return cache{Mods: map[string]any{}}
}

func (s *Service) copyModTree(src, dst string) error {
	if s.copyMod != nil {
		return s.copyMod(src, dst)
	}
	return copyTree(src, dst)
}

// snapshotMod copies an installed mod to a bounded backup path before an
// upgrade. A successful upgrade removes it; a failed one restores it.
func (s *Service) snapshotMod(id string) (string, error) {
	source := filepath.Join(s.active.ModsDir, id)
	if _, err := os.Stat(source); err != nil {
		return "", nil
	}
	snapshot := filepath.Join(s.active.BackupsDir, id+".snapshot")
	if err := os.RemoveAll(snapshot); err != nil {
		return "", err
	}
	if err := copyTree(source, snapshot); err != nil {
		return "", err
	}
	return snapshot, nil
}

func (s *Service) restoreMod(id, snapshot string) error {
	if snapshot == "" {
		return nil
	}
	destination := filepath.Join(s.active.ModsDir, id)
	if err := os.RemoveAll(destination); err != nil {
		return err
	}
	if err := copyTree(snapshot, destination); err != nil {
		return err
	}
	return os.RemoveAll(snapshot)
}
