package modmanager

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/modfs"
)

func TestAddPreservesInstallStateAndLocalOverwriteClearsForge(t *testing.T) {
	root := t.TempDir()
	stamp := "2024-01-01T00:00:00Z"
	l := &Library{Root: root, Mods: map[string]models.Mod{"id": {ID: "id", Name: "Keep", Enabled: true, InstalledAt: &stamp, Source: "forge", Forge: &models.ForgeIdentity{ID: 3, GUID: "x"}}}, Cache: LibraryCache{Mods: map[string]modfs.ModFS{}}}
	if err := AddMod(l, "id", "New", "server", "", false, nil); err != nil {
		t.Fatal(err)
	}
	m := l.Mods["id"]
	if !m.Enabled || m.InstalledAt == nil || *m.InstalledAt != stamp || m.Forge != nil || m.Source != "local" {
		t.Fatalf("unexpected updated mod: %#v", m)
	}
}

func TestRemoveUnknownDoesNotTouchDisk(t *testing.T) {
	root := t.TempDir()
	sentinel := filepath.Join(root, "sentinel")
	if err := os.WriteFile(sentinel, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	l := &Library{Root: root, Mods: map[string]models.Mod{}, Cache: LibraryCache{}}
	if err := RemoveMod(l, "missing"); err == nil {
		t.Fatal("expected unknown id refusal")
	}
	if _, err := os.Stat(sentinel); err != nil {
		t.Fatal("filesystem changed")
	}
}

func TestToggleIsIdempotent(t *testing.T) {
	root := t.TempDir()
	l := &Library{Root: root, Mods: map[string]models.Mod{"id": {ID: "id", Name: "mod", Enabled: true}}, Cache: LibraryCache{}}
	if err := os.MkdirAll(filepath.Join(root, "id"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := ToggleMod(l, "id", true); err != nil {
		t.Fatal(err)
	}
	if err := ToggleMod(l, "id", true); err != nil {
		t.Fatal(err)
	}
	if !l.Mods["id"].Enabled {
		t.Fatal("toggle changed requested state")
	}
}
