// Package config defines the persisted, app-wide settings and library registry.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"path/filepath"
)

type AppConfig struct {
	KnownLibraries []KnownLibrary `toml:"knownLibraries"`
	AppState       AppState       `toml:"appState"`
	Settings       AppSettings    `toml:"settings"`
}

type KnownLibrary struct {
	ID          string `toml:"id"`
	LibraryRoot string `toml:"libraryRoot"`
}

type AppState struct {
	ActiveLibraryID *string `toml:"activeLibraryId"`
}

type AppSettings struct {
	Theme               ThemeMode `toml:"theme" json:"theme"`
	AccentColor         string    `toml:"accentColor" json:"accentColor"`
	Language            string    `toml:"language" json:"language"`
	EnableModsOnInstall bool      `toml:"enableModsOnInstall" json:"enableModsOnInstall"`
	ForgeEndpoint       string    `toml:"forgeEndpoint" json:"forgeEndpoint"`
}

type ThemeMode string

const (
	ThemeSystem ThemeMode = "system"
	ThemeLight  ThemeMode = "light"
	ThemeDark   ThemeMode = "dark"
)

func DefaultSettings() AppSettings {
	return AppSettings{Theme: ThemeSystem, AccentColor: "default", Language: "en-US", EnableModsOnInstall: true}
}

func Default() AppConfig {
	return AppConfig{KnownLibraries: []KnownLibrary{}, Settings: DefaultSettings()}
}

func (c *AppConfig) Normalize() {
	if c.KnownLibraries == nil {
		c.KnownLibraries = []KnownLibrary{}
	}
	defaults := DefaultSettings()
	if c.Settings.Theme == "" {
		c.Settings.Theme = defaults.Theme
	}
	if c.Settings.AccentColor == "" {
		c.Settings.AccentColor = defaults.AccentColor
	}
	if c.Settings.Language == "" || c.Settings.Language == "en" {
		c.Settings.Language = defaults.Language
	}
}

func (c *AppConfig) FindLibrary(id string) *KnownLibrary {
	for i := range c.KnownLibraries {
		if c.KnownLibraries[i].ID == id {
			return &c.KnownLibraries[i]
		}
	}
	return nil
}

func (c *AppConfig) FindLibraryByHandle(handle string) *KnownLibrary {
	if v := c.FindLibrary(handle); v != nil {
		return v
	}
	for i := range c.KnownLibraries {
		if filepath.Clean(c.KnownLibraries[i].LibraryRoot) == filepath.Clean(handle) {
			return &c.KnownLibraries[i]
		}
	}
	return nil
}

func (c *AppConfig) UpsertLibrary(v KnownLibrary) {
	c.RemoveLibrary(v.ID)
	c.KnownLibraries = append(c.KnownLibraries, v)
}

func (c *AppConfig) RemoveLibrary(id string) {
	out := c.KnownLibraries[:0]
	for _, v := range c.KnownLibraries {
		if v.ID != id {
			out = append(out, v)
		}
	}
	c.KnownLibraries = out
	if c.AppState.ActiveLibraryID != nil && *c.AppState.ActiveLibraryID == id {
		c.AppState.ActiveLibraryID = nil
	}
}

func NewID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	// UUID v4 layout.
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	s := hex.EncodeToString(b)
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}
