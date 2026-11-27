package deployment

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/martes/modkeeper/backend/linker"
)

type pinnedObject interface {
	matches(path string) (bool, error)
	matchesInfo(os.FileInfo) bool
	fingerprint() (string, error)
	close() error
}

type liveArtifact struct {
	object      pinnedObject
	libraryRoot string
}

var liveArtifacts = struct {
	sync.Mutex
	byTarget map[string]*liveArtifact
}{byTarget: map[string]*liveArtifact{}}

var liveDirectories = struct {
	sync.Mutex
	byPath map[string]liveDirectory
}{byPath: map[string]liveDirectory{}}

type liveDirectory struct {
	object      pinnedObject
	libraryRoot string
}

func pinCreatedDirectory(l Layout, rel string) error {
	path := filepath.Join(l.GameRoot, rel)
	object, err := pinObject(path)
	if err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || !object.matchesInfo(info) {
		_ = object.close()
		if err != nil {
			return err
		}
		return fmt.Errorf("created directory changed before it could be pinned")
	}
	key := targetKey(l, rel)
	root, err := filepath.Abs(l.LibraryRoot)
	if err != nil {
		_ = object.close()
		return err
	}
	liveDirectories.Lock()
	previous := liveDirectories.byPath[key]
	liveDirectories.byPath[key] = liveDirectory{object: object, libraryRoot: syncJournalKey(root)}
	liveDirectories.Unlock()
	if previous.object != nil {
		_ = previous.object.close()
	}
	return nil
}

func removePinnedDirectory(l Layout, rel string) (bool, error) {
	key := targetKey(l, rel)
	liveDirectories.Lock()
	entry := liveDirectories.byPath[key]
	delete(liveDirectories.byPath, key)
	liveDirectories.Unlock()
	if entry.object == nil {
		return false, nil
	}
	defer entry.object.close()
	path := filepath.Join(l.GameRoot, rel)
	owned, err := entry.object.matches(path)
	if err != nil || !owned {
		return false, err
	}
	entries, err := os.ReadDir(path)
	if os.IsNotExist(err) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if len(entries) != 0 {
		return false, nil
	}
	if err := os.Remove(path); err != nil {
		return false, err
	}
	return true, nil
}

func targetKey(l Layout, target string) string {
	root, err := filepath.EvalSymlinks(l.GameRoot)
	if err != nil {
		root = filepath.Clean(l.GameRoot)
	}
	key := filepath.Clean(filepath.Join(root, target))
	if runtime.GOOS == "windows" {
		key = strings.ToLower(key)
	}
	return key
}

func captureLiveArtifact(l Layout, target string) func(*os.File) (func(), func(string) (bool, error), error) {
	return func(file *os.File) (func(), func(string) (bool, error), error) {
		object, err := pinOpenFile(file)
		if err != nil {
			return nil, nil, err
		}
		current := object
		var registered bool
		release := func() {
			if registered {
				forgetLiveArtifact(l, target)
			} else {
				_ = current.close()
			}
		}
		matches := func(path string) (bool, error) {
			owned, err := current.matches(path)
			if err != nil || !owned {
				return owned, err
			}
			// Bind the long-lived pin to a read-only handle for the
			// published path. The staged writer handle remains open only across
			// the publication boundary, so it cannot constrain later readers on
			// Windows.
			published, err := pinPublishedFile(path)
			if err != nil {
				return false, err
			}
			info, err := os.Lstat(path)
			if err != nil || !current.matchesInfo(info) || !published.matchesInfo(info) {
				_ = published.close()
				if err != nil {
					return false, err
				}
				return false, nil
			}
			_, _, err = registerLiveArtifact(l, target, published)
			if err != nil {
				_ = published.close()
				return false, err
			}
			_ = current.close()
			current = published
			registered = true
			return true, nil
		}
		return release, matches, nil
	}
}

func captureLivePathArtifact(l Layout, target string) func(string) (func(), error) {
	return func(path string) (func(), error) {
		object, err := pinObject(path)
		if err != nil {
			return nil, err
		}
		release, _, err := registerLiveArtifact(l, target, object)
		return release, err
	}
}

func registerLiveArtifact(l Layout, target string, object pinnedObject) (func(), func(string) (bool, error), error) {
	key := targetKey(l, target)
	root, err := filepath.Abs(l.LibraryRoot)
	if err != nil {
		return nil, nil, err
	}
	entry := &liveArtifact{object: object, libraryRoot: syncJournalKey(root)}
	liveArtifacts.Lock()
	previous := liveArtifacts.byTarget[key]
	liveArtifacts.byTarget[key] = entry
	liveArtifacts.Unlock()
	if previous != nil {
		_ = previous.object.close()
	}
	release := func() {
		liveArtifacts.Lock()
		if liveArtifacts.byTarget[key] == entry {
			delete(liveArtifacts.byTarget, key)
		}
		liveArtifacts.Unlock()
		_ = object.close()
	}
	return release, object.matches, nil
}

func forgetLiveArtifact(l Layout, target string) {
	key := targetKey(l, target)
	liveArtifacts.Lock()
	entry := liveArtifacts.byTarget[key]
	delete(liveArtifacts.byTarget, key)
	liveArtifacts.Unlock()
	if entry != nil {
		_ = entry.object.close()
	}
}

func releaseLiveArtifactsForLibrary(l Layout) error {
	root, err := filepath.Abs(l.LibraryRoot)
	if err != nil {
		return ioError(err)
	}
	rootKey := syncJournalKey(root)
	liveArtifacts.Lock()
	var entries []*liveArtifact
	for key, entry := range liveArtifacts.byTarget {
		if entry.libraryRoot == rootKey {
			entries = append(entries, entry)
			delete(liveArtifacts.byTarget, key)
		}
	}
	liveArtifacts.Unlock()
	var closeErrs []error
	for _, entry := range entries {
		closeErrs = append(closeErrs, entry.object.close())
	}
	liveDirectories.Lock()
	var directories []liveDirectory
	for key, directory := range liveDirectories.byPath {
		if directory.libraryRoot == rootKey {
			directories = append(directories, directory)
			delete(liveDirectories.byPath, key)
		}
	}
	liveDirectories.Unlock()
	for _, directory := range directories {
		closeErrs = append(closeErrs, directory.object.close())
	}
	return errors.Join(closeErrs...)
}

func liveObjectMatches(l Layout, artifact DeploymentArtifact, target string) (bool, error) {
	key := targetKey(l, artifact.Target)
	liveArtifacts.Lock()
	entry := liveArtifacts.byTarget[key]
	liveArtifacts.Unlock()
	if entry == nil {
		return false, nil
	}
	return entry.object.matches(target)
}

func liveObjectFingerprint(l Layout, target string) (string, error) {
	key := targetKey(l, target)
	liveArtifacts.Lock()
	entry := liveArtifacts.byTarget[key]
	liveArtifacts.Unlock()
	if entry == nil {
		return "", fmt.Errorf("live deployment object is not pinned")
	}
	return entry.object.fingerprint()
}

func liveArtifactMatches(l Layout, artifact DeploymentArtifact, target string) (bool, error) {
	ok, err := liveObjectMatches(l, artifact, target)
	if err != nil || !ok {
		return ok, err
	}
	source, ok := sourcePath(l, artifact.Source, false)
	if !ok {
		return false, nil
	}
	switch artifact.Kind {
	case linker.Symlink, linker.Junction:
		_, kind, err := inspectLink(target)
		return err == nil && kind == artifact.Kind && linkMatches(source, target), err
	case linker.Hardlink:
		source, ok = sourcePath(l, artifact.Source, true)
		if !ok {
			return false, nil
		}
		sourceInfo, sourceErr := os.Stat(source)
		targetInfo, targetErr := os.Lstat(target)
		return sourceErr == nil && targetErr == nil && os.SameFile(sourceInfo, targetInfo), nil
	case linker.Copy:
		// The open, process-local pin proves object continuity. The fingerprint
		// only detects edits to that same pinned object; it never adopts a file.
		info, err := os.Lstat(target)
		if err != nil || !info.Mode().IsRegular() || artifact.Fingerprint == nil {
			return false, err
		}
		hash, err := liveObjectFingerprint(l, artifact.Target)
		return err == nil && hash == *artifact.Fingerprint, err
	default:
		return false, nil
	}
}
