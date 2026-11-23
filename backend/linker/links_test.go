package linker

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestFileSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("file symlinks are tested only on Unix")
	}
	d := t.TempDir()
	src, dst := filepath.Join(d, "source.txt"), filepath.Join(d, "target.txt")
	if err := os.WriteFile(src, []byte("hello linker"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Link(src, dst); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(dst)
	if err != nil || string(b) != "hello linker" {
		t.Fatalf("%q %v", b, err)
	}
	target, err := ReadTarget(dst)
	if err != nil || filepath.Base(target) != "source.txt" {
		t.Fatalf("%q %v", target, err)
	}
}
func TestDirectoryLink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("directory links use Windows junction semantics")
	}
	d := t.TempDir()
	src, dst := filepath.Join(d, "source_dir"), filepath.Join(d, "target_dir")
	_ = os.Mkdir(src, 0700)
	_ = os.WriteFile(filepath.Join(src, "data.txt"), []byte("nested"), 0600)
	if err := Link(src, dst); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dst, "data.txt"))
	if err != nil || string(b) != "nested" {
		t.Fatalf("%q %v", b, err)
	}
}
func TestUnlinkLogic(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("file symlink behavior is covered only on Unix")
	}
	d := t.TempDir()
	s, l := filepath.Join(d, "source"), filepath.Join(d, "link")
	_ = os.WriteFile(s, []byte("keep"), 0600)
	if err := Link(s, l); err != nil {
		t.Fatal(err)
	}
	if err := Unlink(l); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(l); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("link remains: %v", err)
	}
}
func TestLinkAlreadyExistsCorrectly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("file symlink behavior is covered only on Unix")
	}
	d := t.TempDir()
	s, l := filepath.Join(d, "s"), filepath.Join(d, "l")
	_ = os.WriteFile(s, nil, 0600)
	if err := Link(s, l); err != nil {
		t.Fatal(err)
	}
	if err := Link(s, l); err != nil {
		t.Fatal(err)
	}
}
func TestCollisionDetection(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("file symlink behavior is covered only on Unix")
	}
	d := t.TempDir()
	a, b, l := filepath.Join(d, "a"), filepath.Join(d, "b"), filepath.Join(d, "l")
	_ = os.WriteFile(a, nil, 0600)
	_ = os.WriteFile(b, nil, 0600)
	_ = Link(a, l)
	if err := Link(b, l); err == nil {
		t.Fatal("expected collision")
	}
}
func TestUnlinkNonExistentPath(t *testing.T) {
	if err := Unlink(filepath.Join(t.TempDir(), "ghost")); err != nil {
		t.Fatal(err)
	}
}
func TestHardlinkCreateAndRemove(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("hardlinks are tested only on Unix")
	}
	d := t.TempDir()
	s, l := filepath.Join(d, "source"), filepath.Join(d, "target")
	_ = os.WriteFile(s, []byte("hardlinked"), 0600)
	if err := Create(s, l, Hardlink); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(l)
	if err != nil || string(b) != "hardlinked" {
		t.Fatalf("%q %v", b, err)
	}
	if err := Remove(l, Hardlink); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(l); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("target remains: %v", err)
	}
}
