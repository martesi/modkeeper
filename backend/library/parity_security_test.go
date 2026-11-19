package library

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

// TestDeletingUnknownOrUnsafeModIdsPreservesExternalFiles is the library-level
// half of the Rust security suite: forged ids must never reach the filesystem,
// even when the delete path is the one handling them.
func TestDeletingUnknownOrUnsafeModIdsPreservesExternalFiles(t *testing.T) {
	env, svc := deleteFixture(t)
	sentinel := filepath.Join(env.Root, "sentinel.txt")
	if err := os.WriteFile(sentinel, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	libraryID := svc.active.manifest.ID

	unsafe := []string{
		"", "../sentinel.txt", "../../sentinel.txt",
		sentinel, "mod/../../sentinel.txt", `..\sentinel.txt`,
		"mod:stream", filepath.Join("..", "sentinel.txt"),
	}
	for _, id := range unsafe {
		err := svc.BulkUpdateMods(models.BulkUpdateModsInput{
			LibraryID: libraryID, ModIDs: []string{id}, Action: models.BulkActionDelete,
		})
		if err == nil {
			t.Fatalf("unsafe id %q was accepted", id)
		}
		if got, readErr := os.ReadFile(sentinel); readErr != nil || string(got) != "keep" {
			t.Fatalf("sentinel touched by %q: %q %v", id, got, readErr)
		}
	}

	// A forged library handle must not remove the registration or its files.
	if err := svc.DeleteLibrary("../"+libraryID, false); err == nil {
		t.Fatal("unsafe library handle was accepted")
	}
	if !libraryRegistered(svc, libraryID) {
		t.Fatal("library entry removed by an unsafe handle")
	}
	if got, err := os.ReadFile(sentinel); err != nil || strings.TrimSpace(string(got)) != "keep" {
		t.Fatalf("sentinel touched by delete: %q %v", got, err)
	}
}
