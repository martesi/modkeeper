package linker

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLinkAndUnlink(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source"), filepath.Join(dir, "target")
	if err := os.WriteFile(source, []byte("data"), 0o600); err != nil { t.Fatal(err) }
	if err := Link(source, target); err != nil { t.Fatal(err) }
	got, err := ReadTarget(target)
	if err != nil || got != source { t.Fatalf("ReadTarget() = %q, %v", got, err) }
	if err := Link(source, target); err != nil { t.Fatalf("idempotent Link: %v", err) }
	if err := Unlink(target); err != nil { t.Fatal(err) }
	if _, err := os.Lstat(target); !os.IsNotExist(err) { t.Fatalf("target remains: %v", err) }
}

func TestCreateRejectsExistingTarget(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "occupied")
	if err := os.WriteFile(target, nil, 0o600); err != nil { t.Fatal(err) }
	if err := Create("source", target, Symlink); err == nil { t.Fatal("expected existing-target error") }
}
