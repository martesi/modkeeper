// Package stager classifies and stages mod archive layouts.
package stager

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/martes/modkeeper/backend/archive"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/modfs"
)

type ProcessInspector interface {
	IsRunning(executables []string) bool
}
type StagedMod struct {
	Root, SourcePath, Name string
	IsStaging              bool
	FS                     modfs.ModFS
}

// Resolve extracts supported archives, scans their game-relative mod paths,
// and rejects unknown/ambiguous layouts.
func Resolve(inputs []string, stagingRoot, serverMods, clientPlugins string, inspector ProcessInspector) ([]StagedMod, error) {
	var out []StagedMod
	for _, input := range inputs {
		// The extractor atomically renames into an absent destination; creating
		// the root first makes every install fail with "destination exists".
		root := filepath.Join(stagingRoot, filepath.Base(input)+"-stage")
		_ = os.RemoveAll(root)
		if err := archive.Extract(input, root); err != nil {
			_ = os.RemoveAll(root)
			return nil, err
		}
		fs, err := modfs.Scan(root, serverMods, clientPlugins)
		if err != nil {
			_ = os.RemoveAll(root)
			return nil, err
		}
		if fs.ModType == "unknown" {
			_ = os.RemoveAll(root)
			return nil, models.Fail(models.UnableToDetermineModId)
		}
		exes := make([]string, len(fs.Executables))
		for i, x := range fs.Executables {
			exes[i] = filepath.Join(root, x)
		}
		if inspector != nil && inspector.IsRunning(exes) {
			_ = os.RemoveAll(root)
			return nil, models.Fail(models.ProcessRunning)
		}
		out = append(out, StagedMod{root, input, strings.TrimSuffix(filepath.Base(input), filepath.Ext(input)), true, fs})
	}
	return out, nil
}

// CleanUp removes only a staging directory; source archive paths are never targeted.
func CleanUp(isStaging bool, sourcePath string) error {
	if !isStaging {
		return nil
	}
	info, err := os.Lstat(sourcePath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("refusing to remove non-staging file")
	}
	return os.RemoveAll(sourcePath)
}
