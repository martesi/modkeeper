package library

import (
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/process"
)

type recordingInspector struct {
	mu      sync.Mutex
	running bool
	err     error
	paths   []string
}

func (r *recordingInspector) IsRunning(paths []string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.paths = append(r.paths, paths...)
	return r.running, r.err
}

func TestDeleteFilesRefusesWhileTheGameOrServerRuns(t *testing.T) {
	_, svc := deleteFixture(t)
	id := svc.active.manifest.ID
	inspector := &recordingInspector{running: true}
	svc.Inspector = inspector

	err := svc.DeleteLibrary(id, true)
	var coded *models.Error
	if !errors.As(err, &coded) || coded.Code != models.GameOrServerRunning {
		t.Fatalf("delete with files returned %v; want GameOrServerRunning", err)
	}
	if !libraryRegistered(svc, id) {
		t.Fatal("library entry was removed despite the running-process refusal")
	}
	wantPaths := []string{
		filepath.Join(svc.active.GameRoot, "EscapeFromTarkov.exe"),
		filepath.Join(svc.active.GameRoot, "SPT", "SPT.Server.exe"),
	}
	for _, want := range wantPaths {
		found := false
		for _, got := range inspector.paths {
			if got == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("inspected paths %v do not include %s", inspector.paths, want)
		}
	}
}

func TestDeleteEntryIgnoresTheRunningProcessGuard(t *testing.T) {
	_, svc := deleteFixture(t)
	id := svc.active.manifest.ID
	svc.Inspector = process.Fake{Running: true}

	if err := svc.DeleteLibrary(id, false); err != nil {
		t.Fatalf("delete without files returned %v; want success", err)
	}
	if libraryRegistered(svc, id) {
		t.Fatal("library entry was not removed")
	}
}

func TestDeleteFilesProceedsWhenNothingIsRunning(t *testing.T) {
	_, svc := deleteFixture(t)
	id := svc.active.manifest.ID
	svc.Inspector = process.Fake{}

	if err := svc.DeleteLibrary(id, true); err != nil {
		t.Fatalf("delete with files returned %v; want success", err)
	}
	if libraryRegistered(svc, id) {
		t.Fatal("library entry was not removed")
	}
}

func TestSyncRefusesWhileTheGameOrServerRuns(t *testing.T) {
	_, svc := deleteFixture(t)
	id := svc.active.manifest.ID
	svc.Inspector = process.Fake{Running: true}

	_, err := svc.SyncMods(models.SyncModsInput{TaskID: "sync-task", LibraryID: id}, nil)
	var coded *models.Error
	if !errors.As(err, &coded) || coded.Code != models.GameOrServerRunning {
		t.Fatalf("sync returned %v; want GameOrServerRunning", err)
	}
	if acquireErr := svc.Registry.AcquireTask("sync-task", id, func() {}); acquireErr != nil {
		t.Fatalf("a refused sync still reserved its task id: %v", acquireErr)
	}
	svc.Registry.FinishTaskID("sync-task")
}

func TestSyncProceedsWhenNothingIsRunning(t *testing.T) {
	_, svc := deleteFixture(t)
	id := svc.active.manifest.ID
	svc.Inspector = process.Fake{}

	accepted, err := svc.SyncMods(models.SyncModsInput{TaskID: "sync-task", LibraryID: id}, nil)
	if err != nil {
		t.Fatalf("sync returned %v; want acceptance", err)
	}
	svc.Wait()
	if accepted == nil || !accepted.Accepted {
		t.Fatalf("accepted %#v; want an accepted operation", accepted)
	}
}

func TestProcessInspectionFailureIsNotTreatedAsSafe(t *testing.T) {
	expected := errors.New("Unable to inspect running processes")
	cases := []struct {
		name string
		run  func(svc *Service, id string) error
	}{
		{
			name: "delete with files",
			run: func(svc *Service, id string) error {
				return svc.DeleteLibrary(id, true)
			},
		},
		{
			name: "sync",
			run: func(svc *Service, id string) error {
				_, err := svc.SyncMods(models.SyncModsInput{TaskID: "sync-task", LibraryID: id}, nil)
				return err
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, svc := deleteFixture(t)
			id := svc.active.manifest.ID
			svc.Inspector = process.Fake{Err: expected}

			err := tc.run(svc, id)
			if !errors.Is(err, expected) {
				t.Fatalf("returned %v; want the inspection failure", err)
			}
			var coded *models.Error
			if errors.As(err, &coded) {
				t.Fatalf("inspection failure collapsed into the guard code %q", coded.Code)
			}
			if tc.name == "delete with files" && !libraryRegistered(svc, id) {
				t.Fatal("library entry was removed despite the inspection failure")
			}
		})
	}
}

func TestGuardInspectionErrorMentionsTheOperation(t *testing.T) {
	_, svc := deleteFixture(t)
	svc.Inspector = process.Fake{Err: errors.New("access denied")}
	err := svc.DeleteLibrary(svc.active.manifest.ID, true)
	if err == nil || !strings.Contains(err.Error(), "inspect running processes") {
		t.Fatalf("returned %v; want inspection context", err)
	}
}
