// Package linker implements filesystem link operations used by deployment.
package linker

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

type ArtifactKind string

const (
	Symlink ArtifactKind = "symlink"
	Junction ArtifactKind = "junction"
	Hardlink ArtifactKind = "hardlink"
	Copy ArtifactKind = "copy"
)

func ReadTarget(path string) (string, error) { return os.Readlink(path) }

// Create makes an artifact only when the destination does not exist.
func Create(source, target string, kind ArtifactKind) error {
	if _, err := os.Lstat(target); err == nil {
		return fmt.Errorf("target already exists: %s", target)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	switch kind {
	case Symlink:
		return os.Symlink(source, target)
	case Junction:
		if runtime.GOOS != "windows" {
			return fmt.Errorf("junctions are only supported on Windows")
		}
		return os.Symlink(source, target)
	case Hardlink:
		return os.Link(source, target)
	case Copy:
		info, err := os.Stat(source)
		if err != nil { return err }
		if info.IsDir() { return os.Mkdir(target, info.Mode().Perm()) }
		data, err := os.ReadFile(source)
		if err != nil { return err }
		return os.WriteFile(target, data, info.Mode().Perm())
	default:
		return fmt.Errorf("unknown artifact kind: %s", kind)
	}
}

func Remove(target string, kind ArtifactKind) error {
	info, err := os.Lstat(target)
	if os.IsNotExist(err) { return nil }
	if err != nil { return err }
	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 { return os.RemoveAll(target) }
	return os.Remove(target)
}

func Link(source, target string) error {
	if dest, err := os.Readlink(target); err == nil {
		if dest == source { return nil }
		return fmt.Errorf("target exists and is not linked to source: %s", target)
	} else if !os.IsNotExist(err) {
		if _, statErr := os.Lstat(target); statErr == nil {
			return fmt.Errorf("target exists and is not linked to source: %s", target)
		}
	}
	return Create(source, target, Symlink)
}

func Unlink(target string) error { return Remove(target, Symlink) }
