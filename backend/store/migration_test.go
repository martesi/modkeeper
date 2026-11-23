package store_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/registry"
)

func TestMigrationAdoptsManifestIds(t *testing.T) {
	first, second := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(first, "manifest.toml"), []byte(`id = "stable-one"`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(second, "manifest.toml"), []byte(`id = "stable-two"`), 0600); err != nil {
		t.Fatal(err)
	}
	got := registry.MigrateLegacy([]string{first, second}, first)
	if len(got.KnownLibraries) != 2 || got.KnownLibraries[0].ID != "stable-one" || got.KnownLibraries[1].ID != "stable-two" {
		t.Fatalf("migration: %+v", got)
	}
	if got.AppState.ActiveLibraryID == nil || *got.AppState.ActiveLibraryID != "stable-one" {
		t.Fatalf("active id: %+v", got.AppState.ActiveLibraryID)
	}
}

func TestMigrationMintsIdOnlyWithoutReadableManifest(t *testing.T) {
	orphan := t.TempDir()
	got := registry.MigrateLegacy([]string{orphan}, "")
	if len(got.KnownLibraries) != 1 || got.KnownLibraries[0].LibraryRoot != orphan || got.KnownLibraries[0].ID == "" || got.AppState.ActiveLibraryID != nil {
		t.Fatalf("migration: %+v", got)
	}
}
