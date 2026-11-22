package library

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/models"
)

// Workspace assembles the frontend-facing state from the registered libraries'
// files. It mirrors Rust's assemble_workspace: manifests are read only, version
// validation never runs, and an unreadable manifest becomes a path-only stub
// instead of disappearing from the list.
func (s *Service) Workspace() (*models.LibraryWorkspace, error) {
	s.startupMu.Lock()
	startupStarted := s.startupStarted
	s.startupMu.Unlock()
	if startupStarted {
		// Rust's get_library_workspace returns the startup handshake error
		// instead of inventing an empty workspace.
		if err := s.Registry.WaitForStartupLoad(context.Background()); err != nil {
			return nil, models.Fail(models.AsyncRuntimeError, err.Error())
		}
	}
	s.libraryMu.RLock()
	defer s.libraryMu.RUnlock()
	w := &models.LibraryWorkspace{
		ActiveLibraryID:  s.Store.Config.AppState.ActiveLibraryID,
		Libraries:        []models.LibraryEntry{},
		ModsByLibraryID:  map[string][]models.ModSummary{},
		ToolsByLibraryID: map[string][]models.ToolSummary{},
		Settings:         s.Store.Config.Settings,
		ConfigWarning:    s.takeWarning(),
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
	return w, nil
}

// workspaceManifest prefers the active library's in-memory state because it is
// fresher than its files, matching Rust's assemble_workspace.
func (s *Service) workspaceManifest(known config.KnownLibrary) (manifest, bool) {
	if s.active != nil && s.active.manifest.ID == known.ID {
		return s.active.manifest, true
	}
	var m manifest
	if _, err := toml.DecodeFile(filepath.Join(known.LibraryRoot, "manifest.toml"), &m); err != nil {
		return m, false
	}
	return m, true
}

// workspaceCacheStatus mirrors Rust's per-library cache probe. The active
// library is trusted without a file read; every other library reports a failed
// state with the parse error instead of hiding itself behind a stub.
func (s *Service) workspaceCacheStatus(known config.KnownLibrary) models.CacheStatus {
	cachePath := filepath.Join(known.LibraryRoot, "cache.toml")
	if s.active == nil || s.active.manifest.ID != known.ID {
		var c cache
		if _, err := toml.DecodeFile(cachePath, &c); err != nil {
			message := err.Error()
			return models.CacheStatus{State: models.CacheStateFailed, Message: &message}
		}
	}
	rebuilt := mtimeISO(cachePath)
	return models.CacheStatus{State: models.CacheStateReady, LastRebuiltAt: &rebuilt}
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
