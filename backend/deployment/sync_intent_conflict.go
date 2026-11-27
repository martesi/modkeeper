// Package deployment reports preserved Sync journal conflicts.
package deployment

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const retiredSyncIntentPrefix = ".sync-intent-retired-"

func checkRetiredSyncIntents(l Layout) error {
	entries, err := os.ReadDir(l.LibraryRoot)
	if err != nil {
		return ioError(fmt.Errorf("inspect retired Sync intents: %w", err))
	}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, retiredSyncIntentPrefix) && strings.HasSuffix(name, ".toml") {
			return syncIntentConflict(l, filepath.Join(l.LibraryRoot, name))
		}
	}
	return nil
}

func syncIntentRootsMatch(l Layout, intent syncIntent) bool {
	libraryRoot, libraryErr := filepath.Abs(l.LibraryRoot)
	gameRoot, gameErr := filepath.Abs(l.GameRoot)
	return libraryErr == nil && gameErr == nil &&
		intent.Version == syncIntentVersion &&
		filepath.Clean(intent.LibraryRoot) == filepath.Clean(libraryRoot) &&
		filepath.Clean(intent.GameRoot) == filepath.Clean(gameRoot)
}

func syncIntentConflict(l Layout, path string) error {
	targets := map[string]bool{}
	if records, err := readSyncIntentRecords(path); err == nil {
		for _, intent := range records {
			for _, target := range intent.Targets {
				if safeRelative(target.Path) {
					targets[target.Path] = true
				}
				if target.Stage != "" && safeRelative(target.Stage) {
					targets[target.Stage] = true
				}
			}
		}
	}
	if len(targets) == 0 {
		if state, err := LoadState(l); err == nil {
			for _, artifact := range state.Artifacts {
				if safeRelative(artifact.Target) {
					targets[artifact.Target] = true
				}
			}
		}
	}
	if len(targets) == 0 {
		return invalid(l, fmt.Sprintf("Sync recovery is blocked by preserved record '%s'. Inspect deployment targets and state. Move or remove this record outside Modkeeper only after verifying those files.", path))
	}
	return invalid(l, fmt.Sprintf("Sync recovery is blocked by preserved record '%s' for game targets %q. Inspect these targets and deployment state. Move or remove this record outside Modkeeper only after verifying those files.", path, sortedKeys(targets)))
}
