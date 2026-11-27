// Package linker implements filesystem link operations used by deployment.
package linker

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type ArtifactKind string

const (
	Symlink  ArtifactKind = "symlink"
	Junction ArtifactKind = "junction"
	Hardlink ArtifactKind = "hardlink"
	Copy     ArtifactKind = "copy"
)

type Capture func(*os.File) (release func(), matches func(string) (bool, error), err error)

type publicationHooks struct {
	afterStageCreate func(string, *os.File) error
	afterCapture     func(string) error
	afterStageClose  func(string, *os.File) error
	publish          func(*os.File, string, string) error
}

func ReadTarget(path string) (string, error) { return os.Readlink(path) }

// Create makes an artifact only when the destination does not exist.
func Create(source, target string, kind ArtifactKind) error {
	return create(source, target, kind, "", nil)
}

// CreateWithPublication publishes into an absent target. Copy capture pins the
// open stage object, not a later lookup of its pathname. Linux and Darwin still
// require the documented no-external-game-tree-mutation assumption between
// the final path identity check and the no-replace rename.
func CreateWithPublication(source, target string, kind ArtifactKind, stage string, capture Capture) error {
	return CreateWithPublicationBoundary(source, target, kind, stage, capture, nil)
}

// CreateWithPublicationBoundary provides a deterministic pause point after a
// copy stage is created. Production callers pass nil; E2E-tagged server builds
// use it only to stop the real process at the staging boundary.
func CreateWithPublicationBoundary(source, target string, kind ArtifactKind, stage string, capture Capture, duringStaging func() error) error {
	if capture == nil || (kind == Copy && stage == "") || (kind == Hardlink && stage != "") || (kind != Copy && kind != Hardlink) {
		return fmt.Errorf("safe publication supports staged copies and direct hardlinks only")
	}
	if kind == Copy && filepath.Clean(filepath.Dir(stage)) != filepath.Clean(filepath.Dir(target)) {
		return fmt.Errorf("staged copy must be created beside its target")
	}
	hooks := publicationHooks{}
	if duringStaging != nil {
		hooks.afterStageCreate = func(string, *os.File) error { return duringStaging() }
	}
	return createWithHooks(source, target, kind, stage, capture, hooks)
}

func create(source, target string, kind ArtifactKind, stage string, capture Capture) error {
	return createWithHooks(source, target, kind, stage, capture, publicationHooks{})
}

func createWithHooks(source, target string, kind ArtifactKind, stage string, capture Capture, hooks publicationHooks) error {
	if _, err := os.Lstat(target); err == nil {
		return fmt.Errorf("target already exists: %s", target)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	switch kind {
	case Symlink:
		if stage != "" || capture != nil {
			return fmt.Errorf("symlink publication must use direct exclusive creation")
		}
		return os.Symlink(source, target)
	case Junction:
		return fmt.Errorf("junction creation is not supported")
	case Hardlink:
		if capture == nil {
			return os.Link(source, target)
		}
		in, err := os.Open(source)
		if err != nil {
			return err
		}
		defer in.Close()
		release, matches, err := capture(in)
		if err != nil {
			return err
		}
		if release == nil || matches == nil {
			return fmt.Errorf("hardlink capture did not return live ownership checks")
		}
		if err := os.Link(source, target); err != nil {
			release()
			return err
		}
		ok, err := matches(target)
		if err != nil || !ok {
			release()
			if err != nil {
				return fmt.Errorf("verify hardlink publication: %w", err)
			}
			return fmt.Errorf("published hardlink differs from captured source")
		}
		return nil
	case Copy:
		info, err := os.Stat(source)
		if err != nil {
			return err
		}
		if info.IsDir() {
			if stage != "" || capture != nil {
				return fmt.Errorf("staged directory publication is disabled")
			}
			return os.Mkdir(target, info.Mode().Perm())
		}
		in, err := os.Open(source)
		if err != nil {
			return err
		}
		defer in.Close()
		var staged *os.File
		if stage != "" {
			staged, err = createStageFile(stage)
		} else {
			staged, stage, err = createTemporaryStage(target)
		}
		if err != nil {
			return err
		}
		stage = staged.Name()
		if hooks.afterStageCreate != nil {
			if err := hooks.afterStageCreate(stage, staged); err != nil {
				_ = staged.Close()
				return err
			}
		}
		if _, err = io.Copy(staged, in); err == nil {
			err = staged.Chmod(info.Mode().Perm())
		}
		if err == nil {
			err = staged.Sync()
		}
		if err != nil {
			// The durable intent owns recovery from here. Never remove a pathname
			// whose object identity is no longer proved by the open handle.
			_ = staged.Close()
			return err
		}
		originalInfo, err := staged.Stat()
		if err != nil {
			_ = staged.Close()
			return err
		}
		var release func()
		var matches func(string) (bool, error)
		release = func() {}
		if capture != nil {
			release, matches, err = capture(staged)
			if err != nil {
				_ = staged.Close()
				return err
			}
			if release == nil || matches == nil {
				_ = staged.Close()
				return fmt.Errorf("copy capture did not return live ownership checks")
			}
		}
		if hooks.afterCapture != nil {
			if err = hooks.afterCapture(stage); err != nil {
				release()
				_ = staged.Close()
				return err
			}
		}
		if hooks.afterStageClose != nil {
			if err = hooks.afterStageClose(stage, staged); err != nil {
				release()
				_ = staged.Close()
				return err
			}
		}
		currentInfo, err := os.Lstat(stage)
		if err != nil || !os.SameFile(originalInfo, currentInfo) {
			release()
			_ = staged.Close()
			if err != nil {
				return fmt.Errorf("staging object changed before publication: %w", err)
			}
			return fmt.Errorf("staging object changed before publication")
		}
		publish := hooks.publish
		if publish == nil {
			publish = publishStagedNoReplace
		}
		if err = publish(staged, stage, target); err != nil {
			release()
			_ = staged.Close()
			return err
		}
		closeErr := staged.Close()
		if closeErr != nil {
			release()
			return fmt.Errorf("close published stage handle: %w", closeErr)
		}
		if matches != nil {
			ok, matchErr := matches(target)
			if matchErr != nil || !ok {
				release()
				if matchErr != nil {
					return fmt.Errorf("verify published object: %w", matchErr)
				}
				return fmt.Errorf("published object differs from captured stage")
			}
		}
		return nil
	default:
		return fmt.Errorf("unknown artifact kind: %s", kind)
	}
}

func createTemporaryStage(target string) (*os.File, string, error) {
	for attempt := 0; attempt < 8; attempt++ {
		var suffix [16]byte
		if _, err := rand.Read(suffix[:]); err != nil {
			return nil, "", err
		}
		path := filepath.Join(filepath.Dir(target), ".modkeeper-stage-"+hex.EncodeToString(suffix[:]))
		file, err := createStageFile(path)
		if err == nil {
			return file, path, nil
		}
		if !os.IsExist(err) {
			return nil, "", err
		}
	}
	return nil, "", fmt.Errorf("could not allocate a unique temporary stage")
}

func Remove(target string, kind ArtifactKind) error {
	info, err := os.Lstat(target)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		return os.RemoveAll(target)
	}
	return os.Remove(target)
}

func Link(source, target string) error {
	if dest, err := os.Readlink(target); err == nil {
		if dest == source {
			return nil
		}
		return fmt.Errorf("target exists and is not linked to source: %s", target)
	} else if !os.IsNotExist(err) {
		if _, statErr := os.Lstat(target); statErr == nil {
			return fmt.Errorf("target exists and is not linked to source: %s", target)
		}
	}
	return Create(source, target, Symlink)
}

func Unlink(target string) error { return Remove(target, Symlink) }
