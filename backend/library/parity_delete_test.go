package library

import (
	"archive/zip"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/deployment"
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/modfs"
	"github.com/martes/modkeeper/backend/spt"
	"github.com/martes/modkeeper/backend/testenv"
)

func deleteFixture(t *testing.T) (*testenv.Env, *Service) {
	t.Helper()
	env := testenv.New(t)
	svc, err := New(filepath.Join(env.Root, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	libRoot := filepath.Join(env.Root, "library")
	if err := svc.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &libRoot}); err != nil {
		t.Fatal(err)
	}
	return env, svc
}

// deployedFixture installs one server mod into the library and deploys it, so
// deployment.toml records real artifacts.
func deployedFixture(t *testing.T) (*testenv.Env, *Service, deployment.Layout, models.Mod) {
	t.Helper()
	env, svc := deleteFixture(t)
	root := svc.active.Root
	modDir := filepath.Join(root, "mods", "mod-1")
	file := filepath.Join(modDir, "SPT", "user", "mods", "Example", "content.txt")
	if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("v1"), 0644); err != nil {
		t.Fatal(err)
	}
	fs, err := modfs.Scan(modDir, "SPT/user/mods", "BepInEx/plugins")
	if err != nil {
		t.Fatal(err)
	}
	finalDir := filepath.Join(root, "mods", fs.ID)
	if err := os.Rename(modDir, finalDir); err != nil {
		t.Fatal(err)
	}
	m := models.Mod{ID: fs.ID, Name: "Example", Enabled: true, Type: models.ModTypeServer}
	rules, err := spt.Discover(env.GameRoot)
	if err != nil {
		t.Fatal(err)
	}
	depLayout := deployment.Layout{LibraryRoot: root, GameRoot: env.GameRoot, Rules: rules}
	plan, err := deployment.PlanWithKinds([]models.Mod{m}, depLayout, linker.Symlink, linker.Symlink)
	if err != nil {
		t.Fatal(err)
	}
	if err := deployment.Deploy(depLayout, plan); err != nil {
		t.Fatal(err)
	}
	svc.active.manifest.Mods[m.ID] = m
	if err := svc.active.Persist(); err != nil {
		t.Fatal(err)
	}
	return env, svc, depLayout, m
}

func deployedFile(t *testing.T, env *testenv.Env, depLayout deployment.Layout) string {
	t.Helper()
	return filepath.Join(env.GameRoot, depLayout.Rules.ServerMods, "Example", "content.txt")
}

// redirect replaces a deployed directory with a symlink to a foreign directory.
func redirect(t *testing.T, env *testenv.Env, depLayout deployment.Layout) string {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("requires symlinks")
	}
	foreign := filepath.Join(env.GameRoot, "redirected")
	if err := os.MkdirAll(foreign, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(foreign, "content.txt"), []byte("foreign"), 0644); err != nil {
		t.Fatal(err)
	}
	deployed := filepath.Join(env.GameRoot, depLayout.Rules.ServerMods, "Example")
	if err := os.RemoveAll(deployed); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(foreign, deployed); err != nil {
		t.Fatal(err)
	}
	return foreign
}

func libraryRegistered(svc *Service, id string) bool {
	return svc.Store.Config.FindLibrary(id) != nil
}

func TestDeletingALibraryRefusesADeploymentPathRedirectedWithinTheGameRoot(t *testing.T) {
	env, svc, depLayout, _ := deployedFixture(t)
	foreign := redirect(t, env, depLayout)

	err := svc.DeleteLibrary(svc.active.manifest.ID, true)
	if err == nil || !strings.Contains(err.Error(), "InvalidLibrary") {
		t.Fatalf("expected InvalidLibrary, got %v", err)
	}
	if !libraryRegistered(svc, svc.active.manifest.ID) {
		t.Fatal("library entry was removed despite refusal")
	}
	if got, err := os.ReadFile(filepath.Join(foreign, "content.txt")); err != nil || string(got) != "foreign" {
		t.Fatalf("foreign target touched: %q %v", got, err)
	}
}

func TestRemovingAModRefusesADeploymentPathRedirectedWithinTheGameRoot(t *testing.T) {
	env, svc, depLayout, mod := deployedFixture(t)
	redirect(t, env, depLayout)

	err := svc.BulkUpdateMods(models.BulkUpdateModsInput{
		LibraryID: svc.active.manifest.ID,
		ModIDs:    []string{mod.ID},
		Action:    models.BulkActionDelete,
	})
	if err == nil || !strings.Contains(err.Error(), "InvalidLibrary") {
		t.Fatalf("expected InvalidLibrary, got %v", err)
	}
	if _, ok := svc.active.manifest.Mods[mod.ID]; !ok {
		t.Fatal("mod was removed despite refusal")
	}
}

func TestRemovingAModPreflightsSharedDirectoriesBeforeUnlinkingArtifacts(t *testing.T) {
	env, svc, depLayout, mod := deployedFixture(t)
	// A foreign file in a shared directory must survive any mod-level removal.
	shared := filepath.Join(env.GameRoot, "BepInEx", "plugins", "shared")
	if err := os.MkdirAll(shared, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(shared, "kept"), []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := svc.BulkUpdateMods(models.BulkUpdateModsInput{
		LibraryID: svc.active.manifest.ID, ModIDs: []string{mod.ID}, Action: models.BulkActionDelete,
	}); err != nil {
		t.Fatal(err)
	}
	if _, ok := svc.active.manifest.Mods[mod.ID]; ok {
		t.Fatal("mod still registered after delete")
	}
	if got, err := os.ReadFile(filepath.Join(shared, "kept")); err != nil || string(got) != "keep" {
		t.Fatalf("shared directory was purged: %q %v", got, err)
	}
	_ = depLayout
}

func TestDeletingALibraryValidatesPurgeBeforeRemovingDeployment(t *testing.T) {
	_, svc, _, _ := deployedFixture(t)
	// An orphaned quarantine artifact makes the purge retry unsafe.
	orphan := filepath.Join(svc.active.Root, ".mkp-orphan")
	if err := os.WriteFile(orphan, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	id := svc.active.manifest.ID
	if err := svc.DeleteLibrary(id, true); err == nil {
		t.Fatal("delete succeeded despite an orphaned quarantine")
	}
	if !libraryRegistered(svc, id) {
		t.Fatal("library entry was removed before validation")
	}
}

func TestDeletingALibraryValidatesPurgeWalksBeforeRemovingDeployment(t *testing.T) {
	env, svc, depLayout, _ := deployedFixture(t)
	deployed := filepath.Join(env.GameRoot, depLayout.Rules.ServerMods, "Example")
	// Replace the owned directory symlink with a real directory: the recorded
	// artifact no longer matches, so the walk must refuse before any unlink.
	if err := os.RemoveAll(deployed); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(deployed, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deployed, "content.txt"), []byte("replaced"), 0644); err != nil {
		t.Fatal(err)
	}
	deployed = filepath.Join(deployed, "content.txt")
	id := svc.active.manifest.ID
	if err := svc.DeleteLibrary(id, true); err == nil || !strings.Contains(err.Error(), "InvalidLibrary") {
		t.Fatalf("expected InvalidLibrary, got %v", err)
	}
	if !libraryRegistered(svc, id) {
		t.Fatal("library entry was removed despite refusal")
	}
	if got, _ := os.ReadFile(deployed); string(got) != "replaced" {
		t.Fatalf("deployed artifact changed: %q", got)
	}
}

func TestCreatingANewMajorLibraryAllowsAnAlreadyRemovedOldTree(t *testing.T) {
	env := testenv.New(t)
	svc, err := New(filepath.Join(env.Root, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	oldRoot := filepath.Join(env.Root, "library-4")
	if err := svc.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &oldRoot}); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(oldRoot); err != nil {
		t.Fatal(err)
	}
	// A new major install lives under SPT_Runtime; the old tree is already gone.
	if err := os.RemoveAll(filepath.Join(env.GameRoot, "SPT")); err != nil {
		t.Fatal(err)
	}
	env.WriteServerExe("SPT_Runtime")
	newRoot := filepath.Join(env.GameRoot, ".mod_keeper-spt-5.0.0")
	if err := svc.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &newRoot}); err != nil {
		t.Fatalf("create after removed old tree: %v", err)
	}
}

func TestCrossMajorMigrationPurgesLegacyLinksFromTheOldServerRoot(t *testing.T) {
	env, svc, depLayout, _ := deployedFixture(t)
	legacy := deployedFile(t, env, depLayout)
	if _, err := os.Stat(legacy); err != nil {
		t.Fatal(err)
	}
	// The recorded deployment belongs to the 4.x server root. Deleting the
	// library must remove those links before the entry disappears.
	id := svc.active.manifest.ID
	if err := svc.DeleteLibrary(id, true); err != nil {
		t.Fatalf("DeleteLibrary: %v", err)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatalf("legacy link survived deletion: %v", err)
	}
	if libraryRegistered(svc, id) {
		t.Fatal("library entry survived deletion")
	}
}

func TestTestUpgradeSnapshotRestoresPriorContents(t *testing.T) {
	_, svc, _, mod := deployedFixture(t)
	archive := writeUpgradeZip(t)
	failed := false
	svc.copyMod = func(src, dst string) error {
		if !failed {
			failed = true
			return os.ErrPermission
		}
		return copyTree(src, dst)
	}
	if _, err := svc.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "snap-1", LibraryID: svc.active.manifest.ID, ArchivePaths: []string{archive},
	}, nil); err != nil {
		t.Fatal(err)
	}
	svc.Wait()
	content := filepath.Join(svc.active.ModsDir, mod.ID, "SPT", "user", "mods", "Example", "content.txt")
	if got, err := os.ReadFile(content); err != nil || string(got) != "v1" {
		t.Fatalf("snapshot did not restore v1: %q %v", got, err)
	}
	entries, err := os.ReadDir(svc.active.BackupsDir)
	if err == nil {
		for _, entry := range entries {
			if strings.Contains(entry.Name(), "snapshot") {
				t.Fatalf("snapshot left behind: %s", entry.Name())
			}
		}
	}
}

func writeUpgradeZip(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "upgrade.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("SPT/user/mods/Example/content.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("v2")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}
