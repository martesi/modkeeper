// Package security validates manifest-controlled path components.
package security

import (
	"github.com/martes/modkeeper/backend/models"
	"os"
	"path/filepath"
	"strings"
)

func ValidateModID(id string) error {
	if id == "" || id == "." || id == ".." || filepath.IsAbs(id) || strings.ContainsAny(id, "/\\:\x00") {
		return models.Fail(models.ModNotFound, id)
	}
	return nil
}

// SafeJoin rejects existing links that escape the mods root. Callers must still
// preflight ownership and avoid following links during destructive operations.
func SafeJoin(libraryModsRoot, id string) (string, error) {
	if err := ValidateModID(id); err != nil {
		return "", err
	}
	root, err := filepath.Abs(libraryModsRoot)
	if err != nil {
		return "", models.Fail(models.IOError, err.Error())
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", models.Fail(models.IOError, err.Error())
	}
	joined := filepath.Join(root, id)
	resolved, err := filepath.EvalSymlinks(joined)
	if err != nil {
		// A dangling link must not be mistaken for an absent mod directory.
		if _, statErr := os.Lstat(joined); os.IsNotExist(statErr) {
			return joined, nil
		}
		return "", models.Fail(models.ModNotFound, id)
	}
	rel, err := filepath.Rel(resolvedRoot, resolved)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", models.Fail(models.ModNotFound, id)
	}
	return joined, nil
}
