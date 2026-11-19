// Package modfs scans extracted mod trees.
package modfs

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/zeebo/blake3"
)

type ModFS struct {
	ID          string   `json:"id"`
	ModType     string   `json:"modType"`
	Files       []string `json:"files"`
	Executables []string `json:"executables"`
}

// Scan uses root-relative paths and caller-provided SPT directory prefixes.
func Scan(root string, serverMods, clientPlugins string) (ModFS, error) {
	out := ModFS{Files: []string{}, Executables: []string{}}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil { return err }
		if entry.IsDir() { return nil }
		rel, err := filepath.Rel(root, path)
		if err != nil { return err }
		rel = filepath.ToSlash(rel)
		out.Files = append(out.Files, rel)
		if strings.EqualFold(filepath.Ext(rel), ".exe") { out.Executables = append(out.Executables, rel) }
		return nil
	})
	if err != nil { return out, err }
	sort.Strings(out.Files)
	sort.Strings(out.Executables)
	var ids []string
	client, server := false, false
	for _, file := range out.Files {
		if rel, err := filepath.Rel(filepath.Clean(serverMods), filepath.Clean(file)); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			server = true
			ids = append(ids, strings.Split(filepath.ToSlash(rel), "/")[0])
		}
		if strings.EqualFold(filepath.Ext(file), ".dll") && strings.HasPrefix(filepath.ToSlash(file), strings.TrimSuffix(filepath.ToSlash(clientPlugins), "/")+"/") {
			client = true
			ids = append(ids, strings.TrimPrefix(filepath.ToSlash(file), strings.TrimSuffix(filepath.ToSlash(clientPlugins), "/")+"/"))
		}
	}
	switch { case client && server: out.ModType="both"; case client: out.ModType="client"; case server: out.ModType="server"; default: out.ModType="unknown" }
	if len(ids)==0 { return out, errors.New("UnableToDetermineModId") }
	sort.Strings(ids)
	sum := blake3.Sum256([]byte(strings.ToLower(strings.Join(ids, ""))))
	out.ID = base64.RawURLEncoding.EncodeToString(sum[:16])
	return out, nil
}
