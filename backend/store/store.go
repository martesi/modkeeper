// Package store reads and atomically persists app configuration.
package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/models"
)

type AppConfigStore struct {
	Path   string
	Config config.AppConfig
}

func ConfigPath(debug bool) (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", models.Fail(models.IOError, fmt.Sprintf("Unable to determine config directory: %v", err))
	}
	name := "config.toml"
	if debug {
		name = "config_debug.toml"
	}
	return filepath.Join(base, "Modkeeper", name), nil
}

func LoadFrom(path string) (config.AppConfig, error) {
	cfg := config.Default()
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return cfg, models.Fail(models.IOError, err.Error())
	}
	if _, err = toml.Decode(string(b), &cfg); err != nil {
		return config.AppConfig{}, models.Fail(models.ParseError, err.Error())
	}
	cfg.Normalize()
	return cfg, nil
}

func SaveTo(path string, cfg config.AppConfig) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return saveFailure(err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".config-*.tmp")
	if err != nil {
		return saveFailure(err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err = tmp.Chmod(0600); err == nil {
		err = toml.NewEncoder(tmp).Encode(cfg)
	}
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return saveFailure(err)
	}
	if err = os.Rename(tmpName, path); err != nil {
		return saveFailure(err)
	}
	return nil
}

// saveFailure keeps the previous message while preserving the stable wire code
// the Rust store emits for every write failure.
func saveFailure(err error) error {
	return models.Fail(models.ConfigSaveFailed, fmt.Sprintf("save config: %v", err))
}

func (s *AppConfigStore) Save() error { return SaveTo(s.Path, s.Config) }
