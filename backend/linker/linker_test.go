package linker

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestLinkAndUnlink(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source"), filepath.Join(dir, "target")
	if err := os.WriteFile(source, []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Link(source, target); err != nil {
		t.Fatal(err)
	}
	got, err := ReadTarget(target)
	if err != nil || got != source {
		t.Fatalf("ReadTarget() = %q, %v", got, err)
	}
	if err := Link(source, target); err != nil {
		t.Fatalf("idempotent Link: %v", err)
	}
	if err := Unlink(target); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("target remains: %v", err)
	}
}

func TestStagedCopyPreservesSubstitutedStage(t *testing.T) {
	for _, point := range []string{"after-create", "after-capture", "after-close"} {
		t.Run(point, func(t *testing.T) {
			dir := t.TempDir()
			source := filepath.Join(dir, "source")
			stage := filepath.Join(dir, "stage")
			target := filepath.Join(dir, "target")
			if err := os.WriteFile(source, []byte("source bytes"), 0o600); err != nil {
				t.Fatal(err)
			}
			replace := func(path string) error {
				if err := os.Remove(path); err != nil {
					return err
				}
				return os.WriteFile(path, []byte("foreign stage"), 0o600)
			}
			capture := func(file *os.File) (func(), func(string) (bool, error), error) {
				pinned, err := file.Stat()
				if err != nil {
					return nil, nil, err
				}
				return func() {}, func(path string) (bool, error) {
					current, err := os.Lstat(path)
					return err == nil && os.SameFile(pinned, current), err
				}, nil
			}
			hooks := publicationHooks{}
			switch point {
			case "after-create":
				hooks.afterStageCreate = func(path string, _ *os.File) error { return replace(path) }
			case "after-capture":
				hooks.afterCapture = replace
			case "after-close":
				hooks.afterStageClose = func(path string, file *os.File) error {
					if err := file.Close(); err != nil {
						return err
					}
					return replace(path)
				}
			}
			if err := createWithHooks(source, target, Copy, stage, capture, hooks); err == nil {
				t.Fatal("substituted stage was published")
			}
			if _, err := os.Lstat(target); !os.IsNotExist(err) {
				t.Fatalf("target exists after failed publication: %v", err)
			}
			got, err := os.ReadFile(stage)
			if err != nil || string(got) != "foreign stage" {
				t.Fatalf("foreign stage was not preserved: %q, %v", got, err)
			}
		})
	}
}

func TestStagedCopyFsyncFailureLeavesPublishedTargetAndNoCleanup(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source")
	stage := filepath.Join(dir, "stage")
	target := filepath.Join(dir, "target")
	if err := os.WriteFile(source, []byte("source bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	fsyncFailure := errors.New("injected parent directory fsync failure")
	hooks := publicationHooks{publish: func(file *os.File, from, to string) error {
		if err := publishStagedNoReplace(file, from, to); err != nil {
			return err
		}
		return fsyncFailure
	}}
	err := createWithHooks(source, target, Copy, stage, nil, hooks)
	if !errors.Is(err, fsyncFailure) {
		t.Fatalf("publication error = %v", err)
	}
	got, err := os.ReadFile(target)
	if err != nil || string(got) != "source bytes" {
		t.Fatalf("published target was not preserved: %q, %v", got, err)
	}
	if _, err := os.Lstat(stage); !os.IsNotExist(err) {
		t.Fatalf("stage unexpectedly remains after rename: %v", err)
	}
}

func TestCaptureFailurePreservesNamedStage(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source")
	stage := filepath.Join(dir, "stage")
	target := filepath.Join(dir, "target")
	if err := os.WriteFile(source, []byte("source bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	captureFailure := errors.New("injected capture failure")
	capture := func(*os.File) (func(), func(string) (bool, error), error) {
		return nil, nil, captureFailure
	}
	err := createWithHooks(source, target, Copy, stage, capture, publicationHooks{})
	if !errors.Is(err, captureFailure) {
		t.Fatalf("capture error = %v", err)
	}
	got, err := os.ReadFile(stage)
	if err != nil || string(got) != "source bytes" {
		t.Fatalf("stage was not preserved after uncertain capture: %q, %v", got, err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("target exists after capture failure: %v", err)
	}
}

func TestCreateRejectsExistingTarget(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "occupied")
	if err := os.WriteFile(target, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Create("source", target, Symlink); err == nil {
		t.Fatal("expected existing-target error")
	}
}

func TestCopyUsesExclusiveStagedPublication(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source")
	target := filepath.Join(dir, "target")
	if err := os.WriteFile(source, []byte("source bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Create(source, target, Copy); err != nil {
		t.Fatal(err)
	}
	sourceInfo, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	targetInfo, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if os.SameFile(sourceInfo, targetInfo) {
		t.Fatal("ordinary copy unexpectedly requires or creates a hardlink")
	}
	if err := os.WriteFile(source, []byte("updated"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Create(source, target, Copy); err == nil {
		t.Fatal("expected no-replace publication to reject occupied target")
	}
	got, err := os.ReadFile(target)
	if err != nil || string(got) != "source bytes" {
		t.Fatalf("occupied target changed: %q, %v", got, err)
	}
}

func TestNoReplacePublicationPreservesRacingTarget(t *testing.T) {
	dir := t.TempDir()
	stage := filepath.Join(dir, "stage")
	target := filepath.Join(dir, "target")
	if err := os.WriteFile(stage, []byte("staged"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("foreign"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := publishNoReplace(stage, target); err == nil {
		t.Fatal("expected no-replace publication to reject racing target")
	}
	got, err := os.ReadFile(target)
	if err != nil || string(got) != "foreign" {
		t.Fatalf("racing target changed: %q, %v", got, err)
	}
}
