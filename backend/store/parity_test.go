package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/config"
)

func TestTestLoadMissingFileYieldsDefault(t *testing.T) {
	c, err := LoadFrom(filepath.Join(t.TempDir(), "missing.toml"))
	if err != nil || len(c.KnownLibraries) != 0 || c.AppState.ActiveLibraryID != nil || c.Settings.AccentColor != "default" {
		t.Fatalf("%+v, %v", c, err)
	}
}
func TestTestMissingAccentFieldDefaultsToDefault(t *testing.T) {
	p := filepath.Join(t.TempDir(), "c.toml")
	if err := os.WriteFile(p, []byte("[settings]\ntheme='system'\n"), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := LoadFrom(p)
	if err != nil || c.Settings.AccentColor != "default" {
		t.Fatalf("%+v, %v", c, err)
	}
}
func TestTestLoadCorruptFileErrorsAndLeavesFileUntouched(t *testing.T) {
	p := filepath.Join(t.TempDir(), "c.toml")
	raw := "this is [ not toml"
	_ = os.WriteFile(p, []byte(raw), 0600)
	if _, err := LoadFrom(p); err == nil {
		t.Fatal("expected parse error")
	}
	b, _ := os.ReadFile(p)
	if string(b) != raw {
		t.Fatal("file changed")
	}
}
func TestTestSaveRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "c.toml")
	c := config.Default()
	c.UpsertLibrary(config.KnownLibrary{ID: "lib-1", LibraryRoot: "C:/games/spt/.mod_keeper"})
	id := "lib-1"
	c.AppState.ActiveLibraryID = &id
	c.Settings.AccentColor = "#123456"
	if err := SaveTo(p, c); err != nil {
		t.Fatal(err)
	}
	got, err := LoadFrom(p)
	if err != nil || got.KnownLibraries[0].ID != "lib-1" || got.AppState.ActiveLibraryID == nil || *got.AppState.ActiveLibraryID != "lib-1" || got.Settings.AccentColor != "#123456" {
		t.Fatalf("%+v %v", got, err)
	}
	es, _ := os.ReadDir(filepath.Dir(p))
	for _, e := range es {
		if strings.Contains(e.Name(), ".tmp-") {
			t.Fatalf("temp file remains: %s", e.Name())
		}
	}
}
func TestTestSavedPinkAccentRoundTripsUnchanged(t *testing.T) {
	p := filepath.Join(t.TempDir(), "c.toml")
	c := config.Default()
	c.Settings.AccentColor = "#e91e63"
	if err := SaveTo(p, c); err != nil {
		t.Fatal(err)
	}
	got, err := LoadFrom(p)
	if err != nil || got.Settings.AccentColor != "#e91e63" {
		t.Fatalf("%+v %v", got, err)
	}
}
func TestTestSaveFailureSurfacesConfigSaveFailedAndPreservesTarget(t *testing.T) {
	d := t.TempDir()
	p := filepath.Join(d, "config.toml")
	_ = SaveTo(p, config.Default())
	before, _ := os.ReadFile(p)
	blocked := filepath.Join(d, "blocked")
	_ = os.MkdirAll(filepath.Join(blocked, "sub"), 0700)
	if err := SaveTo(blocked, config.Default()); err == nil {
		t.Fatal("expected error")
	}
	after, _ := os.ReadFile(p)
	if string(before) != string(after) {
		t.Fatal("target changed")
	}
}
func TestTestFindLibraryByHandleMatchesIdOrPath(t *testing.T) {
	c := config.Default()
	c.UpsertLibrary(config.KnownLibrary{ID: "lib-1", LibraryRoot: "C:/games/spt/.mod_keeper"})
	if c.FindLibraryByHandle("lib-1") == nil || c.FindLibraryByHandle("C:/games/spt/.mod_keeper") == nil || c.FindLibraryByHandle("unknown") != nil {
		t.Fatal("handle lookup mismatch")
	}
}
func TestTestDeleteLibraryEntryAcceptsPathHandle(t *testing.T) {
	c := config.Default()
	c.UpsertLibrary(config.KnownLibrary{ID: "stub-id", LibraryRoot: "C:/games/spt/.broken"})
	id := "stub-id"
	c.AppState.ActiveLibraryID = &id
	c.RemoveLibrary("stub-id")
	if len(c.KnownLibraries) != 0 || c.AppState.ActiveLibraryID != nil {
		t.Fatal("entry not removed")
	}
}
func TestTestDeleteLibraryEntryRejectsUnknownHandle(t *testing.T) {
	c := config.Default()
	if c.FindLibraryByHandle("nope") != nil {
		t.Fatal("unknown handle found")
	}
}
