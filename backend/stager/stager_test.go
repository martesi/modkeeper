package stager

import (
	"os"
	"path/filepath"
	"testing"
)

type running struct{ yes bool }

func (r running) IsRunning([]string) bool { return r.yes }

func TestCleanUpIdempotentAndNeverDeletesArchive(t *testing.T) {
	root := t.TempDir()
	archive := filepath.Join(root, "source.zip")
	if err := os.WriteFile(archive, []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := CleanUp(true, archive); err == nil {
		t.Fatal("accepted archive as staging directory")
	}
	if _, err := os.Stat(archive); err != nil {
		t.Fatal("source archive removed")
	}
	stage := filepath.Join(root, "staging")
	if err := os.Mkdir(stage, 0700); err != nil {
		t.Fatal(err)
	}
	if err := CleanUp(true, stage); err != nil {
		t.Fatal(err)
	}
	if err := CleanUp(true, stage); err != nil {
		t.Fatal(err)
	}
}
