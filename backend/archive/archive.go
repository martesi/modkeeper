// Package archive extracts supported mod archives without writing outside the
// destination. Extraction is transactional: failures leave destination intact.
package archive

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/martes/modkeeper/backend"
)

func Extract(archivePath, destination string) error {
	if strings.EqualFold(filepath.Ext(archivePath), ".7z") {
		return backendError("UnhandledCompression", archivePath)
	}
	if !strings.EqualFold(filepath.Ext(archivePath), ".zip") {
		return backendError("UnhandledCompression", archivePath)
	}
	zr, err := zip.OpenReader(archivePath)
	if err != nil {
		return backendError("IOError", err.Error())
	}
	defer zr.Close()
	parent := filepath.Dir(filepath.Clean(destination))
	tmp, err := os.MkdirTemp(parent, ".extract-*")
	if err != nil {
		return backendError("IOError", err.Error())
	}
	defer os.RemoveAll(tmp)
	for _, f := range zr.File {
		name := filepath.ToSlash(f.Name)
		clean := filepath.Clean(filepath.FromSlash(name))
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || strings.Contains(name, `\`) {
			return backendError("ParseError", "unsafe archive path: "+f.Name)
		}
		if f.Mode()&os.ModeSymlink != 0 {
			return backendError("ParseError", "symlink archive entry: "+f.Name)
		}
		out := filepath.Join(tmp, clean)
		if !within(tmp, out) {
			return backendError("ParseError", "unsafe archive path: "+f.Name)
		}
		if f.FileInfo().IsDir() {
			err = os.MkdirAll(out, 0755)
		} else {
			err = os.MkdirAll(filepath.Dir(out), 0755)
			if err == nil {
				var src io.ReadCloser
				src, err = f.Open()
				if err == nil {
					var dst *os.File
					dst, err = os.OpenFile(out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, f.Mode().Perm()&0777)
					if err == nil {
						_, err = io.Copy(dst, src)
						if closeErr := dst.Close(); err == nil {
							err = closeErr
						}
					}
					_ = src.Close()
				}
			}
		}
		if err != nil {
			return backendError("IOError", err.Error())
		}
	}
	if _, err = os.Stat(destination); err == nil {
		return backendError("IOError", "destination already exists")
	}
	if err = os.Rename(tmp, destination); err != nil {
		return backendError("IOError", err.Error())
	}
	return nil
}

func within(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func backendError(code string, data any) error {
	return fmt.Errorf("%w", &backend.Error{Code: code, Data: data})
}
