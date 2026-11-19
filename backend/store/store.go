// Package store reads and atomically persists app configuration.
package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
)

type AppConfigStore struct {
	Path   string
	Config config.AppConfig
}

func ConfigPath(debug bool) (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("unable to determine config directory: %w", err)
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
		return cfg, err
	}
	if _, err = toml.Decode(string(b), &cfg); err != nil {
		return config.AppConfig{}, fmt.Errorf("parse app config: %w", err)
	}
	cfg.Normalize()
	return cfg, nil
}

func SaveTo(path string, cfg config.AppConfig) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("save config: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".config-*.tmp")
	if err != nil {
		return fmt.Errorf("save config: %w", err)
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
		return fmt.Errorf("save config: %w", err)
	}
	if err = os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("save config: %w", err)
	}
	return nil
}

func (s *AppConfigStore) Save() error { return SaveTo(s.Path, s.Config) }
