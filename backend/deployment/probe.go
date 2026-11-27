package deployment

import (
	"errors"
	"github.com/martes/modkeeper/backend/linker"
	"os"
	"path/filepath"
	"syscall"
)

func probeMethods(l Layout) (linker.ArtifactKind, linker.ArtifactKind, error) {
	source, e := os.MkdirTemp(l.LibraryRoot, ".deployment-probe-")
	if e != nil {
		return "", "", e
	}
	defer os.RemoveAll(source)
	target, e := os.MkdirTemp(l.GameRoot, ".deployment-probe-")
	if e != nil {
		return "", "", e
	}
	defer os.RemoveAll(target)
	file := filepath.Join(source, "file")
	directory := filepath.Join(source, "directory")
	if e = os.WriteFile(file, []byte("probe"), 0600); e != nil {
		return "", "", e
	}
	if e = os.Mkdir(directory, 0700); e != nil {
		return "", "", e
	}
	probe := func(src, dest string, kinds []linker.ArtifactKind) (linker.ArtifactKind, error) {
		var last error
		for _, kind := range kinds {
			err := linker.Create(src, dest, kind)
			if err == nil {
				if err = os.Remove(dest); err != nil {
					return "", err
				}
				return kind, nil
			}
			if !os.IsPermission(err) && !errors.Is(err, syscall.EXDEV) && !errors.Is(err, syscall.EINVAL) && !errors.Is(err, syscall.ENOTSUP) {
				return "", err
			}
			last = err
		}
		return "", last
	}
	// The runtime selector only advertises methods with safe publication paths.
	fk, e := probe(file, filepath.Join(target, "file"), []linker.ArtifactKind{linker.Copy, linker.Hardlink})
	if e != nil {
		return "", "", e
	}
	dk, e := probe(directory, filepath.Join(target, "directory"), []linker.ArtifactKind{linker.Copy})
	return fk, dk, e
}
