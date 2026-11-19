package library

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
)

func TestTestDeriveLibraryRoot(t *testing.T) {
	game := t.TempDir()
	if got := DeriveLibraryRoot(game); got != filepath.Join(game, ".mod_keeper") {
		t.Fatalf("got %q", got)
	}
}

func TestTestDefaultLibraryRootMovesToAVersionedRootAfterAnSptMajorChange(t *testing.T) {
	game := t.TempDir()
	if got := DeriveLibraryRootForSPT(game, "4.2.1"); got != filepath.Join(game, ".mod_keeper-spt-4.2.1") {
		t.Fatalf("got %q", got)
	}
}

func TestTestValidateLibraryStructureValid(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "manifest.toml"), []byte("id = 'test'\nname = 'Test'\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"mods", "backups", "staging"} {
		if err := os.Mkdir(filepath.Join(root, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := ValidateLibraryStructure(root); err != nil {
		t.Fatal(err)
	}
}

func TestTestValidateLibraryStructureMissingManifest(t *testing.T) {
	err := ValidateLibraryStructure(t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "InvalidLibrary") || !strings.Contains(err.Error(), "manifest.toml is missing") {
		t.Fatalf("expected InvalidLibrary missing manifest error, got %v", err)
	}
}

func TestTestValidateLibraryStructureMissingDirectory(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "manifest.toml"), []byte("id = 'test'\n"), 0600); err != nil {
		t.Fatal(err)
	}
	err := ValidateLibraryStructure(root)
	if err == nil || !strings.Contains(err.Error(), "InvalidLibrary") || !strings.Contains(err.Error(), "mods") {
		t.Fatalf("expected InvalidLibrary missing mods error, got %v", err)
	}
}

func TestTestDefaultLibraryRootStoresRelativeGameRoot(t *testing.T) {
	game := t.TempDir()
	root := DeriveLibraryRoot(game)
	if err := os.MkdirAll(filepath.Join(game, "SPT", "user", "sptRegistry"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(game, "SPT", "user", "sptRegistry", "registry.json"), []byte(`{"SPT_Version":"SPT 4.2.1"}`), 0600); err != nil {
		t.Fatal(err)
	}
	lib, err := Create(game, root, "Example")
	if err != nil {
		t.Fatal(err)
	}
	var persisted manifest
	if _, err := toml.DecodeFile(filepath.Join(lib.Root, "manifest.toml"), &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.GameRoot != ".." {
		t.Fatalf("stored root = %q", persisted.GameRoot)
	}
}
