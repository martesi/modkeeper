package backend

import (
	"fmt"
	"os"
	"path/filepath"
)

// DirectoryEntry describes a child visible in the server path browser.
type DirectoryEntry struct {
	Name  string
	IsDir bool
}

// ListDirectory returns the sorted children of an absolute directory path.
func (a *App) ListDirectory(path string) ([]DirectoryEntry, error) {
	if !filepath.IsAbs(path) {
		return nil, fmt.Errorf("directory path must be absolute: %q", path)
	}
	items, err := os.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("read directory %q: %w", path, err)
	}
	entries := make([]DirectoryEntry, 0, len(items))
	for _, item := range items {
		info, err := os.Stat(filepath.Join(path, item.Name()))
		entries = append(entries, DirectoryEntry{Name: item.Name(), IsDir: err == nil && info.IsDir()})
	}
	return entries, nil
}

// HomeDirectory returns the server process user's home directory.
func (a *App) HomeDirectory() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home directory: %w", err)
	}
	return home, nil
}
