package deployment

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/martes/modkeeper/backend/linker"
)

const syncIntentVersion = 3

type syncIntent struct {
	Version     int                `toml:"version"`
	Token       string             `toml:"token"`
	JournalID   string             `toml:"journal_id,omitempty"`
	Receipt     string             `toml:"receipt,omitempty"`
	LibraryRoot string             `toml:"library_root"`
	GameRoot    string             `toml:"game_root"`
	Targets     []syncIntentTarget `toml:"targets"`
	Completed   bool               `toml:"completed,omitempty"`
}

type syncIntentTarget struct {
	Path  string `toml:"path"`
	Stage string `toml:"stage,omitempty"`
}

// recoverSyncIntent never infers ownership from a target's contents or name.
// A target found after an interrupted operation is retained and blocks retry.
func recoverSyncIntent(l Layout) error {
	if err := checkRetiredSyncIntents(l); err != nil {
		return err
	}
	paths, err := syncIntentJournalPaths(l)
	if err != nil {
		return ioError(err)
	}
	for _, path := range paths {
		records, journal, err := liveJournalRecords(l, path)
		if err != nil {
			return err
		}
		completed, completionErr := syncJournalCompletionState(records)
		if completionErr != nil {
			return syncIntentConflict(l, path)
		}
		for _, intent := range records {
			if intent.Completed || completed[intent.Token] || (journal != nil && journal.retired[intent.Token]) {
				continue
			}
			if err := recoverSyncIntentRecord(l, path, intent); err != nil {
				return err
			}
			if journal == nil {
				if err := adoptAuthenticatedSyncJournal(l, path, records); err != nil {
					return err
				}
				journal = liveSyncJournalFor(path)
			}
			if err := clearSyncIntent(l, intent.Token); err != nil {
				return err
			}
		}
	}
	return nil
}

func recoverSyncIntentRecord(l Layout, journalPath string, intent syncIntent) error {
	if err := validateSyncIntentShape(l, intent); err != nil {
		return syncIntentConflict(l, journalPath)
	}
	statePath := l.Paths().Deployment
	var committedState DeploymentState
	stateAuthenticated := false
	committed := false
	if _, stateErr := os.Lstat(statePath); stateErr == nil {
		state, loadErr := LoadState(l)
		if loadErr != nil {
			return loadErr
		}
		if !verifyDeploymentStateReceipt(l, state) {
			return collision(statePath)
		}
		committedState = state
		stateAuthenticated = true
		committed = state.SyncToken == intent.Token
	} else if !os.IsNotExist(stateErr) {
		return ioError(fmt.Errorf("inspect deployment state during recovery: %w", stateErr))
	}
	seen := map[string]bool{}
	stages := map[string]bool{}
	for _, target := range intent.Targets {
		rel := target.Path
		if !contained(l.GameRoot, rel, false) {
			return syncIntentConflict(l, journalPath)
		}
		key := pathKey(rel)
		if key == "." || seen[key] {
			return syncIntentConflict(l, journalPath)
		}
		seen[key] = true
		if target.Stage != "" {
			expected := stagePathForTarget(l.GameRoot, rel, intent.Token)
			if !contained(l.GameRoot, target.Stage, false) || pathKey(target.Stage) != pathKey(expected) {
				return syncIntentConflict(l, journalPath)
			}
			stages[pathKey(target.Stage)] = true
			stagePath := filepath.Join(l.GameRoot, target.Stage)
			if _, stageErr := os.Lstat(stagePath); stageErr == nil {
				return collision(target.Stage)
			} else if !os.IsNotExist(stageErr) {
				return ioError(fmt.Errorf("inspect interrupted sync stage %q: %w", target.Stage, stageErr))
			}
		}
		path := filepath.Join(l.GameRoot, rel)
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			if committed {
				for _, artifact := range committedState.Artifacts {
					if pathKey(artifact.Target) == pathKey(rel) {
						return collision(rel)
					}
				}
			}
			continue
		}
		if err != nil {
			return ioError(fmt.Errorf("inspect interrupted sync target %q: %w", rel, err))
		}
		if committed {
			ownedArtifact := false
			for _, artifact := range committedState.Artifacts {
				if pathKey(artifact.Target) == pathKey(rel) {
					owned, verifyErr := recorded(l, artifact)
					if verifyErr != nil {
						return ioError(verifyErr)
					}
					ownedArtifact = owned
					break
				}
			}
			if ownedArtifact {
				continue
			}
			isExpectedDirectory := info.IsDir() && info.Mode()&os.ModeSymlink == 0
			for _, artifact := range committedState.Artifacts {
				if within(rel, artifact.Target) {
					isExpectedDirectory = isExpectedDirectory && contained(l.GameRoot, artifact.Target, false)
					break
				}
			}
			for _, dir := range committedState.CreatedDirs {
				if pathKey(dir) == pathKey(rel) {
					isExpectedDirectory = info.IsDir() && info.Mode()&os.ModeSymlink == 0
				}
			}
			if isExpectedDirectory {
				continue
			}
		} else if stateAuthenticated {
			knownOwned := false
			for _, artifact := range committedState.Artifacts {
				if pathKey(artifact.Target) != pathKey(rel) {
					continue
				}
				owned, verifyErr := recorded(l, artifact)
				if verifyErr != nil {
					return ioError(verifyErr)
				}
				knownOwned = owned
				break
			}
			if knownOwned {
				continue
			}
			for _, dir := range committedState.CreatedDirs {
				if pathKey(dir) == pathKey(rel) && info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
					knownOwned = true
					break
				}
			}
			if knownOwned {
				continue
			}
		}
		return collision(rel)
	}
	for stage := range stages {
		if !seen[stage] {
			return syncIntentConflict(l, journalPath)
		}
	}
	return nil
}

func validateSyncIntentShape(l Layout, intent syncIntent) error {
	if !syncIntentRootsMatch(l, intent) || intent.Token == "" || intent.Targets == nil || intent.Completed {
		return fmt.Errorf("invalid Sync intent metadata")
	}
	seen := map[string]bool{}
	for _, target := range intent.Targets {
		if !contained(l.GameRoot, target.Path, false) || pathKey(target.Path) == "." || seen[pathKey(target.Path)] {
			return fmt.Errorf("invalid Sync intent target path")
		}
		seen[pathKey(target.Path)] = true
		if target.Stage != "" {
			expected := stagePathForTarget(l.GameRoot, target.Path, intent.Token)
			if !contained(l.GameRoot, target.Stage, false) || pathKey(target.Stage) != pathKey(expected) {
				return fmt.Errorf("invalid Sync intent staging path")
			}
		}
	}
	return nil
}

func saveSyncIntent(l Layout, plan DeploymentPlan, state DeploymentState, purgeLinks []purgeLink) (string, error) {
	paths := map[string]bool{}
	stages := map[string]string{}
	for _, artifact := range plan.Artifacts {
		if !contained(l.GameRoot, artifact.Target, false) {
			return "", collision(artifact.Target)
		}
		paths[pathKey(artifact.Target)] = true
		source, ok := sourcePath(l, artifact.Source, true)
		if !ok {
			return "", collision(artifact.Source)
		}
		info, statErr := os.Stat(source)
		if statErr != nil {
			return "", ioError(statErr)
		}
		switch artifact.Kind {
		case linker.Copy:
			if info.IsDir() {
				return "", invalid(l, "safe interrupted publication does not support directory copies")
			}
			// Set the stage after the operation token is allocated below.
			stages[pathKey(artifact.Target)] = ""
		case linker.Hardlink:
			if !info.Mode().IsRegular() {
				return "", invalid(l, "safe hardlink publication requires a regular source file")
			}
		case linker.Symlink:
		case linker.Junction:
			if runtime.GOOS != "windows" {
				return "", invalid(l, "junction deployment is only supported on Windows")
			}
		default:
			return "", invalid(l, "unsupported deployment artifact kind")
		}
	}
	for _, artifact := range state.Artifacts {
		if !contained(l.GameRoot, artifact.Target, false) {
			return "", collision(artifact.Target)
		}
		paths[pathKey(artifact.Target)] = true
	}
	for _, dir := range state.CreatedDirs {
		if !contained(l.GameRoot, dir, true) {
			return "", collision(dir)
		}
		key := pathKey(dir)
		if _, exists := paths[key]; !exists {
			paths[key] = false
		}
	}
	for _, dir := range plan.Directories {
		if !contained(l.GameRoot, dir, true) {
			return "", collision(dir)
		}
		key := pathKey(dir)
		if _, err := os.Lstat(filepath.Join(l.GameRoot, dir)); os.IsNotExist(err) {
			paths[key] = true
		} else if err != nil {
			return "", ioError(fmt.Errorf("inspect planned directory %q: %w", dir, err))
		}
	}
	for _, link := range purgeLinks {
		rel, err := filepath.Rel(l.GameRoot, link.path)
		if err != nil || !contained(l.GameRoot, rel, false) {
			return "", collision(link.path)
		}
		paths[pathKey(rel)] = true
	}
	libraryRoot, err := filepath.Abs(l.LibraryRoot)
	if err != nil {
		return "", ioError(err)
	}
	gameRoot, err := filepath.Abs(l.GameRoot)
	if err != nil {
		return "", ioError(err)
	}
	operationToken, err := token()
	if err != nil {
		return "", ioError(fmt.Errorf("create sync intent token: %w", err))
	}
	statePath := l.Paths().Deployment
	if _, err := os.Lstat(statePath); err == nil {
		owned, verifyErr := verifyLiveDeploymentState(l)
		if verifyErr != nil {
			return "", verifyErr
		}
		if !owned {
			persisted, loadErr := LoadState(l)
			if loadErr != nil {
				return "", loadErr
			}
			owned = verifyDeploymentStateReceipt(l, persisted)
		}
		if !owned {
			return "", collision(statePath)
		}
	} else if !os.IsNotExist(err) {
		return "", ioError(fmt.Errorf("inspect deployment state before sync: %w", err))
	}
	for targetKey := range stages {
		stage := stagePathForTarget(l.GameRoot, targetKey, operationToken)
		if !contained(l.GameRoot, stage, false) {
			return "", collision(stage)
		}
		if _, err := os.Lstat(filepath.Join(l.GameRoot, stage)); err == nil {
			return "", collision(stage)
		} else if !os.IsNotExist(err) {
			return "", ioError(fmt.Errorf("inspect sync staging target %q: %w", stage, err))
		}
		stages[targetKey] = stage
		paths[pathKey(stage)] = true
	}
	intent := syncIntent{
		Version: syncIntentVersion, Token: operationToken,
		LibraryRoot: filepath.Clean(libraryRoot), GameRoot: filepath.Clean(gameRoot),
		Targets: make([]syncIntentTarget, 0, len(paths)),
	}
	for _, rel := range sortedKeys(paths) {
		target := syncIntentTarget{Path: rel, Stage: stages[rel]}
		path := filepath.Join(l.GameRoot, rel)
		if _, err := os.Lstat(path); err == nil {
			// A present target is never adopted during recovery.
		} else if !os.IsNotExist(err) {
			return "", ioError(fmt.Errorf("inspect pre-sync target %q: %w", rel, err))
		} else if isLink(path) {
			return "", collision(rel)
		}
		intent.Targets = append(intent.Targets, target)
	}
	journalPath, err := syncIntentPathForNewOperation(l, operationToken)
	if err != nil {
		return operationToken, err
	}
	if err := appendSyncIntentRecord(l, journalPath, intent, nil); err != nil {
		return operationToken, err
	}
	return operationToken, nil
}

func stagePathForTarget(root, target, token string) string {
	key := pathKey(target)
	digest := sha256.Sum256([]byte(key))
	name := ".modkeeper-stage-" + token + "-" + hex.EncodeToString(digest[:6])
	full := filepath.Join(root, filepath.Dir(filepath.FromSlash(key)), name)
	rel, err := filepath.Rel(root, full)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(rel)
}

// CheckNoPendingSync blocks all public destructive entry points. Internal Sync
// stages use private helpers after validating the same durable intent.
func CheckNoPendingSync(l Layout) error {
	if err := checkRetiredSyncIntents(l); err != nil {
		return err
	}
	paths, err := syncIntentJournalPaths(l)
	if err != nil {
		return ioError(err)
	}
	for _, path := range paths {
		records, journal, err := liveJournalRecords(l, path)
		if err != nil {
			return err
		}
		if journal == nil {
			completed, stateErr := syncJournalCompletionState(records)
			if stateErr != nil {
				return syncIntentConflict(l, path)
			}
			for _, record := range records {
				if !record.Completed && !completed[record.Token] {
					return syncIntentConflict(l, path)
				}
			}
			continue
		}
		for _, record := range records {
			if !journal.retired[record.Token] {
				return syncIntentConflict(l, path)
			}
		}
	}
	return nil
}

func clearSyncIntent(l Layout, token string) error {
	path, err := syncIntentPathForToken(l, token)
	if err != nil {
		return err
	}
	_, journal, err := liveJournalRecords(l, path)
	if err != nil || journal == nil {
		if err != nil {
			return err
		}
		return syncIntentConflict(l, path)
	}
	found := false
	for _, record := range journal.records {
		if record.Token == token {
			found = true
			break
		}
	}
	if !found {
		return syncIntentConflict(l, path)
	}
	return appendSyncIntentCompletion(l, path, token)
}
