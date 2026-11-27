package linker

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestProbeWindowsConsumerMustRead(t *testing.T) {
	d := t.TempDir()
	result, err := Probe(d, d, ProbeOptions{Mode: LinkMode, Consumer: WindowsConsumer, WindowsReader: func(path string) ([]byte, error) {
		if _, err := os.ReadFile(path); err != nil {
			t.Fatal(err)
		}
		return nil, ErrConsumerUnavailable
	}})
	if err != nil {
		t.Fatal(err)
	}
	if result.File != "" || result.Directory != "" {
		t.Fatalf("unsafe approval: %+v", result)
	}
}

func TestProbeCrossDeviceFallsBackAndCleansUp(t *testing.T) {
	src, dst := t.TempDir(), t.TempDir()
	result, err := probe(src, dst, ProbeOptions{Mode: AutomaticMode, Consumer: NativeConsumer}, func(source, target string, kind ArtifactKind) error {
		if kind == Symlink {
			return os.ErrPermission
		}
		if kind == Hardlink {
			return crossDeviceError
		}
		return Create(source, target, kind)
	})
	if err != nil || result.File != Copy {
		t.Fatalf("%+v %v", result, err)
	}
	for _, path := range []string{src, dst} {
		entries, err := os.ReadDir(path)
		if err != nil || len(entries) != 0 {
			t.Fatalf("scratch remains in %s: %v %v", path, entries, err)
		}
	}
}

func TestProbeModesAndMissingConsumer(t *testing.T) {
	d := t.TempDir()
	for _, tc := range []struct {
		mode     Mode
		consumer Consumer
		file     ArtifactKind
	}{
		{AutomaticMode, NativeConsumer, Symlink},
		{LinkMode, NativeConsumer, Symlink},
		{CopyMode, NativeConsumer, Copy},
		{LinkMode, UnknownConsumer, ""},
	} {
		result, err := Probe(d, d, ProbeOptions{Mode: tc.mode, Consumer: tc.consumer})
		if err != nil {
			t.Fatal(err)
		}
		if result.File != tc.file && !(runtime.GOOS == "windows" && tc.consumer == NativeConsumer && (tc.mode == AutomaticMode || tc.mode == LinkMode) && (result.File == Hardlink || tc.mode == AutomaticMode && result.File == Copy)) {
			t.Fatalf("%s %s: %+v", tc.mode, tc.consumer, result)
		}
	}
	if runtime.GOOS != "windows" {
		result, err := Probe(d, d, ProbeOptions{Mode: LinkMode, Consumer: WindowsConsumer})
		if err != nil || result.File != "" {
			t.Fatalf("missing Windows reader: %+v %v", result, err)
		}
	}
	if runtime.GOOS == "windows" {
		result, err := Probe(d, d, ProbeOptions{Mode: CopyMode, Consumer: WindowsConsumer})
		if err != nil || result.File != Copy || result.Directory != Copy {
			t.Fatalf("native Windows reader: %+v %v", result, err)
		}
	}
	entries, err := os.ReadDir(d)
	if err != nil || len(entries) != 0 {
		t.Fatalf("scratch remains: %v %v", entries, err)
	}
}

func TestProbeRejectsEmptyDirectories(t *testing.T) {
	d := t.TempDir()
	for _, pair := range [][2]string{{"", d}, {d, ""}} {
		if _, err := Probe(pair[0], pair[1], ProbeOptions{Mode: CopyMode, Consumer: NativeConsumer}); err == nil {
			t.Fatalf("accepted %q", pair)
		}
	}
}

func TestProbeRelativeSourceDifferentParents(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation privilege on Windows")
	}
	src, err := os.MkdirTemp(".", "probe-relative-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(src) })
	result, err := Probe(src, t.TempDir(), ProbeOptions{Mode: LinkMode, Consumer: NativeConsumer})
	if err != nil || result.File != Symlink || result.Directory != Symlink {
		t.Fatalf("relative source: %+v %v", result, err)
	}
}

func TestProbePropagatesConsumerAndStatErrors(t *testing.T) {
	d := t.TempDir()
	bad := errors.New("consumer I/O failure")
	_, err := Probe(d, d, ProbeOptions{Mode: CopyMode, Consumer: WindowsConsumer, WindowsReader: func(string) ([]byte, error) { return nil, bad }})
	if !errors.Is(err, bad) {
		t.Fatalf("consumer error: %v", err)
	}
	_, err = probe(d, d, ProbeOptions{Mode: LinkMode, Consumer: NativeConsumer}, func(src, dst string, kind ArtifactKind) error {
		if kind == Symlink {
			return os.ErrPermission
		}
		return nil
	})
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stat error: %v", err)
	}
}

func TestProbeRejectsFakeHardlinkAndDirectory(t *testing.T) {
	d := t.TempDir()
	result, err := probe(d, d, ProbeOptions{Mode: LinkMode, Consumer: NativeConsumer}, func(src, dst string, kind ArtifactKind) error {
		if kind == Symlink {
			return os.ErrPermission
		}
		return Create(src, dst, Copy)
	})
	if err != nil || result.File != "" || result.Directory != "" {
		t.Fatalf("fake hardlink: %+v %v", result, err)
	}
}

func TestProbeCleanupErrors(t *testing.T) {
	d := t.TempDir()
	bad := errors.New("cleanup failed")
	_, err := probeWithCleanup(d, d, ProbeOptions{Mode: CopyMode, Consumer: NativeConsumer}, Create, func(path string) error {
		if err := os.RemoveAll(path); err != nil {
			return err
		}
		return bad
	})
	if !errors.Is(err, bad) {
		t.Fatalf("cleanup error: %v", err)
	}
}

func TestProbeRejectsUnreadableDirectory(t *testing.T) {
	d := t.TempDir()
	result, err := Probe(d, d, ProbeOptions{Mode: CopyMode, Consumer: WindowsConsumer, WindowsReader: func(path string) ([]byte, error) {
		if filepath.Base(path) == "sentinel" {
			return nil, ErrConsumerUnavailable
		}
		return os.ReadFile(path)
	}})
	if err != nil || result.File != Copy || result.Directory != "" {
		t.Fatalf("unreadable directory: %+v %v", result, err)
	}
}

func TestProbeHardlinkFallbackAndCollision(t *testing.T) {
	d := t.TempDir()
	var attempts []ArtifactKind
	create := func(src, dst string, kind ArtifactKind) error {
		attempts = append(attempts, kind)
		if kind == Symlink {
			return os.ErrPermission
		}
		return Create(src, dst, kind)
	}
	result, err := probe(d, d, ProbeOptions{Mode: LinkMode, Consumer: NativeConsumer}, create)
	if err != nil || result.File != Hardlink {
		t.Fatalf("%+v %v", result, err)
	}
	if len(attempts) < 2 || attempts[0] != Symlink || attempts[1] != Hardlink {
		t.Fatalf("order: %v", attempts)
	}
	for _, kind := range attempts {
		if kind == Copy {
			t.Fatal("link mode attempted copy")
		}
	}
	_, err = probe(d, d, ProbeOptions{Mode: AutomaticMode, Consumer: NativeConsumer}, func(src, dst string, kind ArtifactKind) error {
		return &os.PathError{Op: "create", Path: filepath.Base(dst), Err: os.ErrExist}
	})
	if !errors.Is(err, os.ErrExist) {
		t.Fatalf("collision: %v", err)
	}
}
