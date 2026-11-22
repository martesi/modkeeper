package library

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
		Settings:         s.Store.Config.Settings,
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
	return readWorkspaceManifest(filepath.Join(known.LibraryRoot, "manifest.toml"))
}

// readWorkspaceManifest applies the field requirements of Rust's LibraryDTO and
// Mod. TOML decoding alone fills missing values with zeroes, which would turn a
// manifest Rust rejects into a plausible summary.
func readWorkspaceManifest(path string) (manifest, bool) {
	var raw map[string]any
	if _, err := toml.DecodeFile(path, &raw); err != nil {
		return manifest{}, false
	}
	if missingFields(raw, manifestFields) != nil {
		return manifest{}, false
	}
	mods, ok := raw["mods"].(map[string]any)
	if !ok {
		return manifest{}, false
	}
	for _, value := range mods {
		entry, ok := value.(map[string]any)
		if !ok || missingFields(entry, modFields) != nil {
			return manifest{}, false
		}
		if !validModType(entry["type"]) {
			return manifest{}, false
		}
		if kind, present := entry["forgeKind"]; present && !oneOf(kind, "mod", "addon") {
			return manifest{}, false
		}
		if source, present := entry["source"]; present && !oneOf(source, "local", "forge") {
			return manifest{}, false
		}
	}
	var m manifest
	if _, err := toml.DecodeFile(path, &m); err != nil {
		return manifest{}, false
	}
	return m, true
}

// workspaceCacheStatus mirrors Rust's per-library cache probe. The active
// library is trusted without a file read; every other library reports a failed
// state with the reason instead of hiding itself behind a stub.
func (s *Service) workspaceCacheStatus(known config.KnownLibrary) models.CacheStatus {
	cachePath := filepath.Join(known.LibraryRoot, "cache.toml")
	if s.active == nil || s.active.manifest.ID != known.ID {
		if err := readWorkspaceCache(cachePath); err != nil {
			message := err.Error()
			return models.CacheStatus{State: models.CacheStateFailed, Message: &message}
		}
	}
	rebuilt := mtimeISO(cachePath)
	return models.CacheStatus{State: models.CacheStateReady, LastRebuiltAt: &rebuilt}
}

// readWorkspaceCache applies the field requirements of Rust's LibraryCache and
// ModFS: `mods` is mandatory and every entry needs id, modType, files and
// executables with the expected types.
func readWorkspaceCache(path string) error {
	var raw map[string]any
	if _, err := toml.DecodeFile(path, &raw); err != nil {
		return err
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
		return err
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

func validModType(value any) bool { return oneOf(value, "client", "server", "both", "unknown") }

func oneOf(value any, allowed ...string) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	for _, candidate := range allowed {
		if strings.EqualFold(text, candidate) {
			return true
		}
	}
	return false
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
