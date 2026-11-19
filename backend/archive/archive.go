// Package archive safely and transactionally extracts mod archives.
package archive

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/bodgit/sevenzip"
	"github.com/martes/modkeeper/backend/models"
)

type entry struct {
	name string
	dir  bool
	mode os.FileMode
	open func() (io.ReadCloser, error)
}

func Extract(archivePath, destination string) error {
	ext := strings.ToLower(filepath.Ext(archivePath))
	var entries []entry
	switch ext {
	case ".zip":
		r, err := zip.OpenReader(archivePath)
		if err != nil {
			return fail("UnhandledCompression", err)
		}
		defer r.Close()
		for _, f := range r.File {
			f := f
			entries = append(entries, entry{f.Name, f.FileInfo().IsDir(), f.Mode(), f.Open})
		}
	case ".7z":
		r, err := sevenzip.OpenReader(archivePath)
		if err != nil {
			return fail("UnhandledCompression", err)
		}
		defer r.Close()
		for _, f := range r.File {
			f := f
			entries = append(entries, entry{f.Name, f.FileInfo().IsDir(), f.Mode(), f.Open})
		}
	default:
		return fail("UnhandledCompression", fmt.Errorf("unsupported archive extension: %s", ext))
	}
	parent := filepath.Dir(filepath.Clean(destination))
	tmp, err := os.MkdirTemp(parent, ".extract-*")
	if err != nil {
		return fail("IOError", err)
	}
	defer os.RemoveAll(tmp)
	for _, e := range entries {
		name := filepath.ToSlash(e.name)
		clean := filepath.Clean(filepath.FromSlash(name))
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || strings.Contains(name, `\`) {
			return fail("UnhandledCompression", fmt.Errorf("unsafe archive path: %s", name))
		}
		if e.mode&os.ModeSymlink != 0 {
			return fail("UnhandledCompression", fmt.Errorf("symlink archive entry: %s", name))
		}
		out := filepath.Join(tmp, clean)
		if !within(tmp, out) {
			return fail("UnhandledCompression", fmt.Errorf("unsafe archive path: %s", name))
		}
		if e.dir {
			err = os.MkdirAll(out, 0755)
		} else if err = os.MkdirAll(filepath.Dir(out), 0755); err == nil {
			var src io.ReadCloser
			src, err = e.open()
			if err == nil {
				var dst *os.File
				dst, err = os.OpenFile(out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, e.mode.Perm()&0777)
				if err == nil {
					_, err = io.Copy(dst, src)
					if closeErr := dst.Close(); err == nil {
						err = closeErr
					}
				}
				_ = src.Close()
			}
		}
		if err != nil {
			return fail("UnhandledCompression", err)
		}
	}
	if _, err = os.Lstat(destination); err == nil {
		return fail("IOError", fmt.Errorf("destination already exists"))
	}
	if err = os.Rename(tmp, destination); err != nil {
		return fail("IOError", err)
	}
	return nil
}
func within(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
func fail(code string, err error) error {
	return fmt.Errorf("%w", &models.Error{Code: code, Data: err.Error()})
}
