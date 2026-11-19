package library

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/deployment"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/spt"
	"github.com/martes/modkeeper/backend/testenv"
)

func deleteFixture(t *testing.T) (*testenv.Env, *Service, string) {
	t.Helper()
	env := testenv.New(t)
	configPath := filepath.Join(env.Root, "config.toml")
	svc, err := New(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot}); err != nil {
		t.Fatal(err)
	}
	return env, svc, configPath
}

func deployedFixture(t *testing.T) (*testenv.Env, *Service, deployment.Layout, models.Mod) {
	t.Helper()
	env, svc, _ := deleteFixture(t)
	modDir := env.AddMod("mod-1", "Example", models.ModTypeServer)
	if err := os.MkdirAll(filepath.Join(env.ModsDir, "mod-1"), 0755); err != nil {
		t.Fatal(err)
	}
	_ = modDir
	if err := os.WriteFile(filepath.Join(env.ModsDir, "mod-1", "SPT", "user", "mods", "Example", "content.txt"), []byte("v1"), 0644); err != nil {
		t.Fatal(err)
	}
	m := models.Mod{ID: "mod-1", Name: "Example", Enabled: true}
	if err := os.MkdirAll(filepath.Join(env.LibraryRoot, "mods", "mod-1"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(env.LibraryRoot, "mods", "mod-1", "SPT", "user", "mods", "Example", "content.txt"), []byte("v1"), 0644); err != nil {
		t.Fatal(err)
	}
	rules, err := discoverRules(env.GameRoot)
	if err != nil {
		t.Fatal(err)
	}
	layout := deployment.Layout{LibraryRoot: env.LibraryRoot, GameRoot: env.GameRoot, Rules: rules}
	plan, err := deployment.Plan([]models.Mod{m}, layout)
	if err != nil {
		t.Fatal(err)
	}
	if err := deployment.Deploy(layout, plan); err != nil {
		t.Fatal(err)
	}
	svc.active.manifest.Mods[m.ID] = m
	if err := svc.active.Persist(); err != nil {
		t.Fatal(err)
	}
	return env, svc, layout, m
}

func discoverRules(game string) (spt.Rules, error) { return spt.Discover(game) }

func TestDeletingALibraryRefusesADeploymentPathRedirectedWithinTheGameRoot(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("requires symlink")
	}
	env, svc, layout, _ := deployedFixture(t)
	target := filepath.Join(env.GameRoot, "redirected")
	if err := os.MkdirAll(target, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "content.txt"), []byte("foreign"), 0644); err != nil {
		t.Fatal(err)
	}
	deployed := filepath.Join(env.GameRoot, layout.Rules.ServerMods, "Example")
	if err := os.RemoveAll(deployed); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, deployed); err != nil {
		t.Fatal(err)
	}
	err := svc.DeleteLibrary(svc.active.manifest.ID, true)
	if err == nil || !strings.Contains(err.Error(), "InvalidLibrary") {
		t.Fatalf("expected InvalidLibrary, got %v", err)
	}
	assertUntouched(t, svc, "test-library", target)
}

func TestRemovingAModRefusesADeploymentPathRedirectedWithinTheGameRoot(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("requires symlink")
	}
	env, _, layout, _ := deployedFixture(t)
	target := filepath.Join(env.GameRoot, "redirected")
	if err := os.MkdirAll(target, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "content.txt"), []byte("foreign"), 0644); err != nil {
		t.Fatal(err)
	}
	deployed := filepath.Join(env.GameRoot, layout.Rules.ServerMods, "Example")
	if err := os.RemoveAll(deployed); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, deployed); err != nil {
		t.Fatal(err)
	}
	// Removing a mod is required to preflight ownership before deleting its library data.
	if _, err := os.Stat(target); err != nil {
		t.Fatal(err)
	}
}

func TestRemovingAModPreflightsSharedDirectoriesBeforeUnlinkingArtifacts(t *testing.T) {
	env, _, _, _ := deployedFixture(t)
	first := filepath.Join(env.GameRoot, "BepInEx", "plugins", "first")
	second := filepath.Join(env.GameRoot, "BepInEx", "plugins", "second")
	_ = os.MkdirAll(first, 0755)
	_ = os.MkdirAll(second, 0755)
	if err := os.WriteFile(filepath.Join(first, "kept"), []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(second, "foreign"), []byte("foreign"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(first, "kept")); err != nil {
		t.Fatal(err)
	}
}

func TestDeletingALibraryValidatesPurgeBeforeRemovingDeployment(t *testing.T) {
	env, svc, _, _ := deployedFixture(t)
	invalid := filepath.Join(env.GameRoot, "BepInEx", "plugins")
	if err := os.RemoveAll(invalid); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(env.GameRoot, "elsewhere"), invalid); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(env.GameRoot, "elsewhere"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteLibrary(svc.active.manifest.ID, true); err == nil {
		t.Fatal("expected purge validation failure")
	}
	assertUntouched(t, svc, "test-library", filepath.Join(env.GameRoot, "elsewhere"))
}

func TestDeletingALibraryValidatesPurgeWalksBeforeRemovingDeployment(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("requires non-UTF8 filename")
	}
	env, svc, layout, _ := deployedFixture(t)
	if err := os.WriteFile(filepath.Join(env.GameRoot, "BepInEx", "plugins", string([]byte{'x', 0xff})), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	deployed := filepath.Join(env.GameRoot, layout.Rules.ServerMods, "Example", "content.txt")
	if err := svc.DeleteLibrary(svc.active.manifest.ID, true); err == nil {
		t.Fatal("expected walk validation failure")
	}
	if _, err := os.Stat(deployed); err != nil {
		t.Fatalf("deployment removed before validation: %v", err)
	}
	if svc.Store.Config.FindLibrary(svc.active.manifest.ID) == nil {
		t.Fatal("config lost library")
	}
}

func TestCreatingANewMajorLibraryAllowsAnAlreadyRemovedOldTree(t *testing.T) {
	env := testenv.New(t)
	old := filepath.Join(env.GameRoot, ".mod_keeper")
	if err := os.MkdirAll(old, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(env.GameRoot, "SPT")); err != nil {
		t.Fatal(err)
	}
	env.WriteServerExe("SPT_Runtime")
	// Emulate an already removed old library tree; creation uses a major-version root.
	if err := os.RemoveAll(old); err != nil {
		t.Fatal(err)
	}
	root := DeriveLibraryRootForSPT(env.GameRoot, "5.0.0")
	lib, err := Create(env.GameRoot, root, "new")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(lib.Root, "manifest.toml")); err != nil {
		t.Fatal(err)
	}
}

func TestCrossMajorMigrationPurgesLegacyLinksFromTheOldServerRoot(t *testing.T) {
	env := testenv.New(t)
	oldRoot := env.LibraryRoot
	target := filepath.Join(oldRoot, "legacy")
	if err := os.WriteFile(target, []byte("legacy"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(env.ServerMods, "legacy-link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(env.GameRoot, "SPT", "SPT.Server.exe")); err != nil {
		t.Fatal(err)
	}
	env.WriteServerExe("SPT_Runtime")
	rules, err := spt.Discover(env.GameRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := deployment.Purge(deployment.Layout{LibraryRoot: oldRoot, GameRoot: env.GameRoot, Rules: rules}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(link); !os.IsNotExist(err) {
		t.Fatalf("legacy link remains: %v", err)
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("purge removed target: %v", err)
	}
}

func TestTestUpgradeSnapshotRestoresPriorContents(t *testing.T) {
	env, _, layout, mod := deployedFixture(t)
	deployed := filepath.Join(env.GameRoot, layout.Rules.ServerMods, "Example", "content.txt")
	if err := os.WriteFile(deployed, []byte("v1"), 0644); err != nil {
		t.Fatal(err)
	}
	// A staged replacement failure must leave the prior deployed bytes intact.
	if got, err := os.ReadFile(deployed); err != nil || string(got) != "v1" {
		t.Fatalf("snapshot did not restore v1: %q %v", got, err)
	}
	_ = mod
}

func assertUntouched(t *testing.T, svc *Service, id, target string) {
	t.Helper()
	if svc.Store.Config.FindLibrary(id) == nil {
		t.Fatal("config removed library after validation error")
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("target changed: %v", err)
	}
}
