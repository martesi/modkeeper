package library

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/modmanager"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestLibraryStructureAndStoredRelativeRoot(t *testing.T) {
	game := t.TempDir()
	os.MkdirAll(filepath.Join(game, "SPT", "user", "sptRegistry"), 0700)
	os.WriteFile(filepath.Join(game, "SPT", "user", "sptRegistry", "registry.json"), []byte(`{"SPT_Version":"SPT 4.2.1"}`), 0600)
	root := filepath.Join(game, ".mod_keeper")
	l, err := Create(game, root, "Example")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(l.ModsDir); err != nil {
		t.Fatal(err)
	}
	got, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if got.GameRoot != game || got.manifest.SPTVersion != "4.2.1" {
		t.Fatalf("loaded: %+v", got)
	}
	var stored manifest
	if _, err = toml.DecodeFile(filepath.Join(root, "manifest.toml"), &stored); err != nil {
		t.Fatal(err)
	}
	if stored.GameRoot != ".." {
		t.Fatalf("stored game root %q", stored.GameRoot)
	}
}

func TestWindowsAbsoluteGameRootResolvesOnLinux(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".mod_keeper")
	if got := resolveGameRoot(root, `C:\Games\Example`); got != filepath.Dir(root) {
		t.Fatalf("got %q", got)
	}
}

func TestSPTMajorMismatchRejected(t *testing.T) {
	game := t.TempDir()
	os.MkdirAll(filepath.Join(game, "SPT", "user", "sptRegistry"), 0700)
	registryPath := filepath.Join(game, "SPT", "user", "sptRegistry", "registry.json")
	os.WriteFile(registryPath, []byte(`{"SPT_Version":"4.2.1"}`), 0600)
	root := filepath.Join(game, ".mod_keeper")
	l, err := Create(game, root, "test")
	if err != nil {
		t.Fatal(err)
	}
	l.manifest.SPTVersion = "3.9.0"
	if err = l.Persist(); err != nil {
		t.Fatal(err)
	}
	if _, err = Load(root); err == nil {
		t.Fatal("expected major mismatch")
	}
}

func TestVersionedRootName(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".mod_keeper-spt-4.2.1")
	if filepath.Base(root) != ".mod_keeper-spt-4.2.1" {
		t.Fatal(root)
	}
}

func TestTestCacheRebuildRenamesMismatchedFolder(t *testing.T) {
	env := testenv.New(t)
	wrong := filepath.Join(env.ModsDir, "wrong-folder-name")
	if err := os.MkdirAll(wrong, 0755); err != nil {
		t.Fatal(err)
	}
	manifest := "id = 'right-id'\nisActive = true\ntype = 'server'\nname = 'Example'\n"
	if err := os.WriteFile(filepath.Join(wrong, "manifest.toml"), []byte(manifest), 0644); err != nil {
		t.Fatal(err)
	}
	renamed, err := modmanager.NormalizeModFolders(env.ModsDir, "SPT/user/mods", "BepInEx/plugins", map[string]models.Mod{
		"right-id": {ID: "right-id", Name: "Example"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(renamed) != 1 {
		t.Fatalf("renames: %+v", renamed)
	}
	if _, err := os.Stat(filepath.Join(env.ModsDir, "right-id", "manifest.toml")); err != nil {
		t.Fatalf("mismatched folder was not renamed: %v", err)
	}
	if _, err := os.Stat(wrong); !os.IsNotExist(err) {
		t.Fatalf("old folder still present: %v", err)
	}
}
