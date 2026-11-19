package library

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

// TestSpt416ImportsDeploysAndRemovesMods is the end-to-end SPT 4.x lifecycle on
// the synthetic layout: install an archive, deploy it into the game tree, then
// remove the mod and reconcile the deployment away.
func TestSpt416ImportsDeploysAndRemovesMods(t *testing.T) {
	env := testenv.New(t)
	svc, err := New(filepath.Join(env.Root, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	libRoot := filepath.Join(env.Root, "library")
	if err := svc.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &libRoot}); err != nil {
		t.Fatal(err)
	}
	libraryID := svc.active.manifest.ID

	archive := spt416Zip(t, "SptMod")
	if _, err := svc.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "spt416-install", LibraryID: libraryID, ArchivePaths: []string{archive},
	}, nil); err != nil {
		t.Fatal(err)
	}
	svc.Wait()
	if len(svc.active.manifest.Mods) != 1 {
		t.Fatalf("installed mods: %d", len(svc.active.manifest.Mods))
	}
	var modID string
	for id := range svc.active.manifest.Mods {
		modID = id
	}

	if _, err := svc.SyncMods(models.SyncModsInput{TaskID: "spt416-sync", LibraryID: libraryID}, nil); err != nil {
		t.Fatal(err)
	}
	svc.Wait()
	deployed := filepath.Join(env.GameRoot, "SPT", "user", "mods", "SptMod", "SptMod.dll")
	if _, err := os.Stat(deployed); err != nil {
		t.Fatalf("mod not deployed: %v", err)
	}

	if err := svc.BulkUpdateMods(models.BulkUpdateModsInput{
		LibraryID: libraryID, ModIDs: []string{modID}, Action: models.BulkActionDelete,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SyncMods(models.SyncModsInput{TaskID: "spt416-sync-2", LibraryID: libraryID}, nil); err != nil {
		t.Fatal(err)
	}
	svc.Wait()
	if _, err := os.Stat(deployed); !os.IsNotExist(err) {
		t.Fatalf("removed mod still deployed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(env.GameRoot, "SPT", "user", "mods", "SptMod")); !os.IsNotExist(err) {
		t.Fatalf("deployed directory survived removal: %v", err)
	}
}

func spt416Zip(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "spt416.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("SPT/user/mods/" + name + "/" + name + ".dll")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("binary")); err != nil {
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
