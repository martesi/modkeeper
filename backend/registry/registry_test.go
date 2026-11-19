package registry

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/store"
)

func TestConfigStoreRoundTripAndLegacyDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	cfg, err := store.LoadFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Settings.EnableModsOnInstall || cfg.Settings.Language != "en-US" {
		t.Fatalf("defaults: %+v", cfg.Settings)
	}
	cfg.Settings.EnableModsOnInstall = false
	cfg.Settings.AccentColor = "#e91e63"
	if err = store.SaveTo(path, cfg); err != nil {
		t.Fatal(err)
	}
	got, err := store.LoadFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Settings.EnableModsOnInstall || got.Settings.AccentColor != "#e91e63" {
		t.Fatalf("round trip: %+v", got.Settings)
	}
	if err = os.WriteFile(path, []byte("[settings]\ntheme='dark'\nlanguage='en'\n"), 0600); err != nil {
		t.Fatal(err)
	}
	got, err = store.LoadFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Settings.Language != "en-US" || !got.Settings.EnableModsOnInstall {
		t.Fatalf("legacy migration: %+v", got.Settings)
	}
}

func TestTaskRegistryGuardsAndStartupWait(t *testing.T) {
	r := NewTaskRegistry()
	if err := r.AssertActiveLibrary("lib"); err == nil {
		t.Fatal("expected no active library error")
	}
	r.SetActive("lib", true)
	if err := r.AssertActiveLibrary("lib"); err != nil {
		t.Fatal(err)
	}
	if err := r.AssertActiveLibrary("other"); err == nil {
		t.Fatal("expected active library mismatch")
	}
	if err := r.AcquireTaskID("task"); err != nil {
		t.Fatal(err)
	}
	if err := r.AcquireTaskID("task"); err == nil {
		t.Fatal("expected duplicate task ID error")
	}
	r.FinishTaskID("task")
	if err := r.AcquireTaskID("task"); err != nil {
		t.Fatal(err)
	}
	r.FinishStartupLoad(nil)
	if err := r.WaitForStartupLoad(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestCorruptConfigPreservedAndFailedSaveDoesNotMutate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.toml")
	bad := []byte("invalid = [")
	if err := os.WriteFile(path, bad, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.LoadFrom(path); err == nil {
		t.Fatal("expected parse failure")
	}
	got, _ := os.ReadFile(path)
	if string(got) != string(bad) {
		t.Fatal("corrupt file changed")
	}

	target := filepath.Join(t.TempDir(), "blocked")
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveTo(target, config.Default()); err == nil {
		t.Fatal("expected save failure")
	}
}

func TestMigrationUsesManifestIDsAndPathHandle(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "manifest.toml"), []byte(`id = "stable-id"`), 0600); err != nil {
		t.Fatal(err)
	}
	cfg := MigrateLegacy([]string{root}, root)
	if len(cfg.KnownLibraries) != 1 || cfg.KnownLibraries[0].ID != "stable-id" || cfg.AppState.ActiveLibraryID == nil {
		t.Fatalf("migration: %+v", cfg)
	}
	if cfg.FindLibraryByHandle(root) == nil {
		t.Fatal("path should be valid removal handle")
	}
}

func TestSettingsRollbackOnSaveError(t *testing.T) {
	s := Service{Store: &store.AppConfigStore{Path: filepath.Join(t.TempDir(), "missing", "directory"), Config: config.Default()}}
	// Make destination path a directory so rename cannot replace it.
	parent := filepath.Dir(s.Store.Path)
	if err := os.MkdirAll(parent, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(s.Store.Path, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveSettings(config.AppSettings{Theme: config.ThemeDark}); err == nil {
		t.Fatal("expected save failure")
	}
	if s.Store.Config.Settings.Theme != config.ThemeSystem {
		t.Fatal("settings were not rolled back")
	}
}
