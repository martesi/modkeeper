//go:build windows

package process

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

type fakeSnapshot struct {
	names  []string
	first  error
	next   error
	close  error
	index  int
	closed bool
}

func (s *fakeSnapshot) First() (string, bool, error) {
	if s.first != nil {
		return "", false, s.first
	}
	return s.current()
}

func (s *fakeSnapshot) Next() (string, bool, error) {
	if s.next != nil {
		return "", false, s.next
	}
	s.index++
	return s.current()
}

func (s *fakeSnapshot) current() (string, bool, error) {
	if s.index >= len(s.names) {
		return "", true, nil
	}
	return s.names[s.index], false, nil
}

func (s *fakeSnapshot) Close() error {
	s.closed = true
	return s.close
}

func TestSnapshotMatchesConfiguredGameAndServerBasenamesCaseInsensitively(t *testing.T) {
	paths := []string{
		`C:\Games\EscapeFromTarkov.exe`,
		`C:\Games\SPT\SPT.Server.exe`,
	}
	for _, processName := range []string{"escapefromtarkov.EXE", "spt.server.exe"} {
		t.Run(processName, func(t *testing.T) {
			snapshot := &fakeSnapshot{names: []string{processName}}
			running, err := inspectProcessSnapshot(func() (processSnapshot, error) {
				return snapshot, nil
			}, paths)
			if err != nil || !running {
				t.Fatalf("inspection = %v, %v; want running", running, err)
			}
			if !snapshot.closed {
				t.Fatal("process snapshot was not closed")
			}
		})
	}
}

func TestSnapshotIgnoresNonmatchesAndSecureSystem(t *testing.T) {
	snapshot := &fakeSnapshot{names: []string{
		"EscapeFromTarkov.exe.old",
		"SPT.Server.exe.bak",
		"Secure System",
		"unrelated.exe",
	}}
	running, err := inspectProcessSnapshot(func() (processSnapshot, error) {
		return snapshot, nil
	}, []string{`C:\Games\EscapeFromTarkov.exe`, `C:\Games\SPT\SPT.Server.exe`})
	if err != nil || running {
		t.Fatalf("inspection = %v, %v; want not running", running, err)
	}
}

func TestSnapshotInspectionFailsClosed(t *testing.T) {
	paths := []string{`C:\Games\EscapeFromTarkov.exe`}
	snapshotErr := errors.New("snapshot denied")
	if running, err := inspectProcessSnapshot(func() (processSnapshot, error) {
		return nil, snapshotErr
	}, paths); running || !errors.Is(err, snapshotErr) {
		t.Fatalf("snapshot creation failure = %v, %v; want false and error", running, err)
	}

	for _, tc := range []struct {
		name string
		make func(error) *fakeSnapshot
	}{
		{name: "first", make: func(err error) *fakeSnapshot { return &fakeSnapshot{first: err} }},
		{name: "next", make: func(err error) *fakeSnapshot { return &fakeSnapshot{names: []string{"unrelated.exe"}, next: err} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			wantErr := errors.New("enumeration failed")
			snapshot := tc.make(wantErr)
			running, err := inspectProcessSnapshot(func() (processSnapshot, error) {
				return snapshot, nil
			}, paths)
			if running || !errors.Is(err, wantErr) {
				t.Fatalf("inspection failure = %v, %v; want false and error", running, err)
			}
			if !snapshot.closed {
				t.Fatal("process snapshot was not closed after enumeration failure")
			}
		})
	}

	t.Run("close", func(t *testing.T) {
		wantErr := errors.New("close failed")
		snapshot := &fakeSnapshot{names: []string{"unrelated.exe"}, close: wantErr}
		running, err := inspectProcessSnapshot(func() (processSnapshot, error) {
			return snapshot, nil
		}, paths)
		if running || !errors.Is(err, wantErr) {
			t.Fatalf("close failure = %v, %v; want false and error", running, err)
		}
	})
}

// The live snapshot must match a configured path by basename, even when its
// directory differs. This confirms the Windows implementation uses no handles
// or file identity to refine a name match.
func TestWindowsSnapshotMatchesConfiguredBasenameFromAnotherDirectory(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Skipf("test binary path unavailable: %v", err)
	}
	configuredPath := filepath.Join(t.TempDir(), filepath.Base(exe))
	running, err := (Windows{}).IsRunning([]string{configuredPath})
	if err != nil || !running {
		t.Fatalf("same-basename process = %v, %v; want running", running, err)
	}
}

func TestWindowsSnapshotDoesNotMatchUnrelatedSecureSystemOrPartialNames(t *testing.T) {
	missingGame := fmt.Sprintf("not-running-game-%d.exe", os.Getpid())
	missingServer := fmt.Sprintf("not-running-server-%d.exe", os.Getpid())
	running, err := (Windows{}).IsRunning([]string{
		filepath.Join(`C:\Games`, missingGame),
		filepath.Join(`C:\Games\SPT`, missingServer),
	})
	if err != nil {
		t.Fatal(err)
	}
	if running {
		t.Fatal("unrelated native processes matched configured executable basenames")
	}
}
