package library

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/models"
)

var manifestFields = []string{"id", "name", "gameRoot", "repoRoot", "sptVersion", "mods", "isDirty"}
var modFields = []string{"id", "isActive", "type", "name"}

// Workspace assembles the frontend-facing state from the registered libraries'
// files. It mirrors Rust's assemble_workspace: manifests are read only, version
// validation never runs, and an unreadable manifest becomes a path-only stub
// instead of disappearing from the list. It does not wait for startup or
// consume the config warning; those belong to the commands that own them.
func (s *Service) Workspace() *models.LibraryWorkspace {
	s.libraryMu.RLock()
	defer s.libraryMu.RUnlock()
	w := &models.LibraryWorkspace{
		ActiveLibraryID:  s.Store.Config.AppState.ActiveLibraryID,
		Libraries:        []models.LibraryEntry{},
		ModsByLibraryID:  map[string][]models.ModSummary{},
		ToolsByLibraryID: map[string][]models.ToolSummary{},
		Settings:         s.GetSettings(),
	}
	for _, known := range s.Store.Config.KnownLibraries {
		m, ok := s.workspaceManifest(known)
		if !ok {
			w.Libraries = append(w.Libraries, models.StubEntry(known.LibraryRoot))
			continue
		}
		game := resolveGameRoot(known.LibraryRoot, m.GameRoot)
		libraryUpdatedAt := mtimeISO(filepath.Join(known.LibraryRoot, "manifest.toml"))
		w.Libraries = append(w.Libraries, models.SummaryEntry(models.LibrarySummary{
			ID:          known.ID,
			Name:        m.Name,
			GameRoot:    game,
			LibraryRoot: known.LibraryRoot,
			SPTVersion:  &m.SPTVersion,
			CacheStatus: s.workspaceCacheStatus(known),
			DeployStale: m.IsDirty,
			UpdatedAt:   libraryUpdatedAt,
		}))
		rows := make([]models.ModSummary, 0, len(m.Mods))
		for _, mod := range sortedMods(m.Mods) {
			installed := filepath.Join(known.LibraryRoot, "mods", mod.ID)
			rows = append(rows, modSummary(known.ID, installed, libraryUpdatedAt, mod))
		}
		w.ModsByLibraryID[known.ID] = rows
		w.ToolsByLibraryID[known.ID] = []models.ToolSummary{}
	}
	return w
}

// workspaceManifest prefers the active library's in-memory state because it is
// fresher than its files, matching Rust's assemble_workspace.
func (s *Service) workspaceManifest(known config.KnownLibrary) (manifest, bool) {
	if s.active != nil && s.active.manifest.ID == known.ID {
		return s.active.manifest, true
	}
	m, err := readStrictManifest(filepath.Join(known.LibraryRoot, "manifest.toml"))
	return m, err == nil
}

// readStrictManifest applies the field requirements of Rust's LibraryDTO and
// Mod. TOML decoding alone fills missing values with zeroes, which would turn a
// manifest Rust rejects into a plausible library.
func readStrictManifest(path string) (manifest, error) {
	var raw map[string]any
	if _, err := toml.DecodeFile(path, &raw); err != nil {
		return manifest{}, err
	}
	if err := missingFields(raw, manifestFields); err != nil {
		return manifest{}, err
	}
	mods, ok := raw["mods"].(map[string]any)
	if !ok {
		return manifest{}, fmt.Errorf("missing required field %q", "mods")
	}
	for id, value := range mods {
		entry, ok := value.(map[string]any)
		if !ok {
			return manifest{}, fmt.Errorf("mod %q is not a table", id)
		}
		if err := missingFields(entry, modFields); err != nil {
			return manifest{}, fmt.Errorf("mod %q: %w", id, err)
		}
		if !validModType(entry["type"]) {
			return manifest{}, fmt.Errorf("mod %q: invalid type", id)
		}
		if kind, present := entry["forgeKind"]; present && !validForgeKind(kind) {
			return manifest{}, fmt.Errorf("mod %q: invalid forgeKind", id)
		}
		if source, present := entry["source"]; present && !validModSource(source) {
			return manifest{}, fmt.Errorf("mod %q: invalid source", id)
		}
	}
	var m manifest
	if _, err := toml.DecodeFile(path, &m); err != nil {
		return manifest{}, err
	}
	return m, nil
}

// workspaceCacheStatus mirrors Rust's per-library cache probe. The active
// library is trusted without a file read; every other library reports a failed
// state with the reason instead of hiding itself behind a stub.
func (s *Service) workspaceCacheStatus(known config.KnownLibrary) models.CacheStatus {
	cachePath := filepath.Join(known.LibraryRoot, "cache.toml")
	if s.active == nil || s.active.manifest.ID != known.ID {
		if err := readStrictCache(cachePath); err != nil {
			message := err.Error()
			return models.CacheStatus{State: models.CacheStateFailed, Message: &message}
		}
	}
	rebuilt := mtimeISO(cachePath)
	return models.CacheStatus{State: models.CacheStateReady, LastRebuiltAt: &rebuilt}
}

// readStrictCache applies the field requirements of Rust's LibraryCache and
// ModFS: `mods` is mandatory and every entry needs id, modType, files and
// executables with the expected types.
func readStrictCache(path string) error {
	var raw map[string]any
	if _, err := toml.DecodeFile(path, &raw); err != nil {
		return fmt.Errorf("cache.toml: %w", err)
	}
	mods, ok := raw["mods"].(map[string]any)
	if !ok {
		return fmt.Errorf("cache.toml: missing required field %q", "mods")
	}
	for id, value := range mods {
		entry, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("cache.toml: mod %q is not a table", id)
		}
		if err := missingFields(entry, []string{"id", "modType", "files", "executables"}); err != nil {
			return fmt.Errorf("cache.toml: mod %q: %w", id, err)
		}
		if !validModType(entry["modType"]) {
			return fmt.Errorf("cache.toml: mod %q: invalid modType", id)
		}
	}
	// The typed pass rejects wrong value shapes (for example a string where a
	// file list belongs) that the presence check cannot see.
	var typed struct {
		Mods map[string]struct {
			ID          string   `toml:"id"`
			ModType     string   `toml:"modType"`
			Files       []string `toml:"files"`
			Executables []string `toml:"executables"`
		} `toml:"mods"`
	}
	if _, err := toml.DecodeFile(path, &typed); err != nil {
		return fmt.Errorf("cache.toml: %w", err)
	}
	return nil
}

func missingFields(table map[string]any, fields []string) error {
	for _, field := range fields {
		if _, ok := table[field]; !ok {
			return fmt.Errorf("missing required field %q", field)
		}
	}
	return nil
}

// validModType accepts Rust's exact lowercase values and the named aliases from
// its serde attributes; arbitrary casing is not accepted.
func validModType(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	switch text {
	case "client", "server", "both", "unknown", "Client", "Server", "Both", "Unknown":
		return true
	}
	return false
}

func validForgeKind(value any) bool {
	text, ok := value.(string)
	return ok && (text == "mod" || text == "addon")
}

func validModSource(value any) bool {
	text, ok := value.(string)
	return ok && (text == "local" || text == "forge")
}

func modSummary(libraryID, installed, libraryUpdatedAt string, m models.Mod) models.ModSummary {
	installedAt := m.InstalledAt
	if installedAt == nil {
		installedAt = fileCreatedAt(installed)
	}
	updatedAt := libraryUpdatedAt
	if _, err := os.Stat(installed); err == nil {
		updatedAt = mtimeISO(installed)
	}
	source := m.Source
	return models.ModSummary{
		ID:                m.ID,
		LibraryID:         libraryID,
		Name:              m.Name,
		Type:              m.Type,
		IsEnabled:         m.Enabled,
		InstalledPath:     &installed,
		InstalledAt:       installedAt,
		UpdatedAt:         updatedAt,
		Version:           m.Version,
		ForgeID:           m.ForgeID,
		ForgeGUID:         m.ForgeGUID,
		Source:            &source,
		ForgeKind:         m.ForgeKind,
		ForgeVersionID:    m.ForgeVersionID,
		ForgeMetaCachedAt: m.ForgeMetaCachedAt,
	}
}

// mtimeISO matches Rust's mtime_iso: the file's modification time in UTC, or
// now when the file cannot be inspected.
func mtimeISO(path string) string {
	info, err := os.Stat(path)
	if err != nil {
		return isoUTC(time.Now())
	}
	return isoUTC(info.ModTime())
}

// fileCreatedAt matches Rust's file_created_at: creation time when the
// filesystem records one, otherwise the modification time.
func fileCreatedAt(path string) *string {
	if created, ok := createdTime(path); ok {
		stamp := isoUTC(created)
		return &stamp
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	stamp := isoUTC(info.ModTime())
	return &stamp
}

// isoUTC matches Rust's to_iso8601_utc: whole seconds, UTC, Z suffix.
// RFC3339 emits exactly that shape because it has no fractional seconds.
func isoUTC(t time.Time) string { return t.UTC().Format(time.RFC3339) }
