package library

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/modmanager"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestRecoverInterruptedInstallArtifactsUnit(t *testing.T) {
	env := testenv.New(t)
	l, err := Create(env.GameRoot, env.LibraryRoot, "recovery")
	if err != nil {
		t.Fatal(err)
	}
	oldMod := models.Mod{ID: "RecoverMe", Name: "old", Type: models.ModTypeServer, Source: models.ModSourceLocal}
	newMod := models.Mod{ID: "RecoverMe", Name: "new", Type: models.ModTypeServer, Source: models.ModSourceLocal}
	oldTree := filepath.Join(l.ModsDir, oldMod.ID)
	snapshot := installSnapshotPath(l, oldMod.ID)
	if err := os.MkdirAll(oldTree, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldTree, "version"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(snapshot, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(snapshot, "version"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	l.manifest.Mods[oldMod.ID] = newMod
	if err := l.Persist(); err != nil {
		t.Fatal(err)
	}
	transaction := installTransaction{
		Version: 1, ID: oldMod.ID, Phase: installPrepared, HadOld: true, OldMod: &oldMod, NewMod: newMod,
	}
	if err := writeInstallTransaction(testMarkerPath(l, transaction), transaction); err != nil {
		t.Fatal(err)
	}
	if err := recoverInterruptedInstall(l); err != nil {
		t.Fatal(err)
	}
	assertFileContents(t, filepath.Join(oldTree, "version"), "old")
	if l.manifest.Mods[oldMod.ID].Name != "old" {
		t.Fatalf("prepared upgrade manifest entry=%+v", l.manifest.Mods[oldMod.ID])
	}

	// The commit marker is removed before the snapshot. A second crash at that
	// boundary must discard only the orphan snapshot and keep files plus metadata.
	if err := os.WriteFile(filepath.Join(oldTree, "version"), []byte("committed"), 0600); err != nil {
		t.Fatal(err)
	}
	l.manifest.Mods[oldMod.ID] = newMod
	if err := l.Persist(); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(snapshot, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(snapshot, "version"), []byte("obsolete"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeInstallTransaction(installCommittedMarkerPath(l, oldMod.ID), installTransaction{
		Version: 1, ID: oldMod.ID, Phase: installCommitted, HadOld: true, OldMod: &oldMod, NewMod: newMod,
	}); err != nil {
		t.Fatal(err)
	}
	sentinel := errors.New("simulated process stop")
	if err := recoverInterruptedInstallWithHook(l, func(string) error { return sentinel }); !errors.Is(err, sentinel) {
		t.Fatalf("recovery boundary error=%v", err)
	}
	for _, path := range []string{
		installPreparedMarkerPath(l, oldMod.ID), installCommittedMarkerPath(l, oldMod.ID),
	} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("marker remains after cleanup boundary: %s: %v", path, err)
		}
	}
	if err := recoverInterruptedInstall(l); err != nil {
		t.Fatal(err)
	}
	assertFileContents(t, filepath.Join(oldTree, "version"), "committed")
	if l.manifest.Mods[oldMod.ID].Name != "new" {
		t.Fatalf("repeated recovery manifest entry=%+v", l.manifest.Mods[oldMod.ID])
	}
	if _, err := os.Stat(snapshot); !os.IsNotExist(err) {
		t.Fatalf("orphan snapshot remains: %v", err)
	}

	// A prepared fresh import is rolled back even if the new manifest was
	// already persisted. It must not leave a listed mod with no files.
	fresh := models.Mod{ID: "FreshMod", Name: "fresh", Type: models.ModTypeServer, Source: models.ModSourceLocal}
	freshTree := filepath.Join(l.ModsDir, fresh.ID)
	if err := os.MkdirAll(freshTree, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(freshTree, "version"), []byte("fresh"), 0600); err != nil {
		t.Fatal(err)
	}
	l.manifest.Mods[fresh.ID] = fresh
	if err := l.Persist(); err != nil {
		t.Fatal(err)
	}
	if err := writeInstallTransaction(installPreparedMarkerPath(l, fresh.ID), installTransaction{
		Version: 1, ID: fresh.ID, Phase: installPrepared, NewMod: fresh,
	}); err != nil {
		t.Fatal(err)
	}
	if err := recoverInterruptedInstall(l); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(freshTree); !os.IsNotExist(err) {
		t.Fatalf("fresh interrupted tree remains: %v", err)
	}
	if _, listed := l.manifest.Mods[fresh.ID]; listed {
		t.Fatal("fresh interrupted install remains in manifest")
	}

	// A committed marker keeps a replacement and reconciles its manifest entry.
	committed := models.Mod{ID: "CommittedMod", Name: "committed", Type: models.ModTypeServer, Source: models.ModSourceLocal}
	committedTree := filepath.Join(l.ModsDir, committed.ID)
	if err := os.MkdirAll(committedTree, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(committedTree, "version"), []byte("committed"), 0600); err != nil {
		t.Fatal(err)
	}
	l.manifest.Mods[committed.ID] = committed
	if err := l.Persist(); err != nil {
		t.Fatal(err)
	}
	if err := writeInstallTransaction(installPreparedMarkerPath(l, committed.ID), installTransaction{
		Version: 1, ID: committed.ID, Phase: installPrepared, NewMod: committed,
	}); err != nil {
		t.Fatal(err)
	}
	if err := writeInstallTransaction(installCommittedMarkerPath(l, committed.ID), installTransaction{
		Version: 1, ID: committed.ID, Phase: installCommitted, NewMod: committed,
	}); err != nil {
		t.Fatal(err)
	}
	if err := recoverInterruptedInstall(l); err != nil {
		t.Fatal(err)
	}
	assertFileContents(t, filepath.Join(committedTree, "version"), "committed")
	if l.manifest.Mods[committed.ID].Name != "committed" {
		t.Fatalf("committed manifest entry=%+v", l.manifest.Mods[committed.ID])
	}

	staged := filepath.Join(l.StagingDir, "interrupted")
	nearMiss := filepath.Join(l.ModsDir, "RecoverMe-user-data")
	for _, dir := range []string{staged, nearMiss} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "keep"), []byte("user"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	temp, err := os.MkdirTemp(l.BackupsDir, ".modkeeper-snapshot-tmp-")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(temp, "partial"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := recoverInterruptedInstall(l); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(temp); !os.IsNotExist(err) {
		t.Fatalf("snapshot temp %q survived recovery: %v", temp, err)
	}
	if _, err := os.Stat(filepath.Join(nearMiss, "keep")); err != nil {
		t.Fatalf("similar user directory removed: %v", err)
	}
}

func testMarkerPath(l *Library, transaction installTransaction) string {
	if transaction.Phase == installCommitted {
		return installCommittedMarkerPath(l, transaction.ID)
	}
	return installPreparedMarkerPath(l, transaction.ID)
}

func assertFileContents(t *testing.T, path, want string) {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil || string(body) != want {
		t.Fatalf("%s content=%q; want %q: %v", path, body, want, err)
	}
}

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
