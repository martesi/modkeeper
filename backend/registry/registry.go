// Package registry owns stable library registration and settings persistence.
package registry

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
	"modkeeper/backend/config"
	"modkeeper/backend/store"
)

type Service struct{ Store *store.AppConfigStore }

func (s *Service) GetSettings() config.AppSettings { return s.Store.Config.Settings }
func (s *Service) SaveSettings(settings config.AppSettings) (config.AppSettings, error) {
	old := s.Store.Config.Settings
	s.Store.Config.Settings = settings
	s.Store.Config.Normalize()
	if err := s.Store.Save(); err != nil {
		s.Store.Config.Settings = old
		return config.AppSettings{}, err
	}
	return s.Store.Config.Settings, nil
}

// MigrateLegacy adopts stable IDs from manifest.toml when available. It does
// not open or validate a library. The limited TOML scan intentionally reads
// only the manifest's top-level id field.
func MigrateLegacy(paths []string, activePath string) config.AppConfig {
	cfg := config.Default()
	for _, path := range paths {
		id := manifestID(filepath.Join(path, "manifest.toml"))
		if id == "" {
			id = config.NewID()
		}
		cfg.UpsertLibrary(config.KnownLibrary{ID: id, LibraryRoot: path})
		if filepath.Clean(activePath) == filepath.Clean(path) {
			active := id
			cfg.AppState.ActiveLibraryID = &active
		}
	}
	return cfg
}

func manifestID(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var raw map[string]any
	// Keep manifest parsing intentionally conservative: manifests are TOML.
	if _, err := toml.Decode(string(b), &raw); err != nil {
		return ""
	}
	id, _ := raw["id"].(string)
	return id
}

func (s *Service) Register(id, root string) error {
	if id == "" || root == "" {
		return fmt.Errorf("library id and root are required")
	}
	s.Store.Config.UpsertLibrary(config.KnownLibrary{ID: id, LibraryRoot: root})
	return s.Store.Save()
}
