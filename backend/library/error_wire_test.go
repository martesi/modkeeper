package library

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/deployment"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/process"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestConvertedLibraryErrorsUseTheWireContract(t *testing.T) {
	env, svc := deleteFixture(t)
	svc.Inspector = process.Fake{}
	activeID := svc.active.manifest.ID

	empty, err := New(filepath.Join(env.Root, "empty", "config.toml"))
	if err != nil {
		t.Fatal(err)
	}

	missingManifestRoot := filepath.Join(env.Root, "missing-manifest")
	if err := os.MkdirAll(missingManifestRoot, 0700); err != nil {
		t.Fatal(err)
	}

	missingDirRoot := filepath.Join(env.Root, "missing-dir")
	if err := os.MkdirAll(missingDirRoot, 0700); err != nil {
		t.Fatal(err)
	}
	// The fixture is complete enough to pass the strict manifest reader so the
	// validation reaches the missing-directory check.
	manifestFixture := "id='x'\nname='x'\ngameRoot='/tmp'\nrepoRoot='/tmp'\nsptVersion='4.0.11'\nisDirty=false\n\n[mods]\n"
	if err := os.WriteFile(filepath.Join(missingDirRoot, "manifest.toml"), []byte(manifestFixture), 0600); err != nil {
		t.Fatal(err)
	}

	conflictDir := filepath.Join(env.Root, "conflict-library")
	conflictService, err := New(filepath.Join(env.Root, "conflict-config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	conflictService.Inspector = process.Fake{}
	if err := conflictService.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &conflictDir}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(conflictService.active.ModsDir, "conflict-mod"), []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		run  func() error
		code string
		data any
	}{
		{
			name: "validate reports a missing manifest",
			run:  func() error { return ValidateLibraryStructure(missingManifestRoot) },
			code: models.InvalidLibrary,
			data: []any{missingManifestRoot, "manifest.toml is missing"},
		},
		{
			name: "validate reports a missing directory",
			run:  func() error { return ValidateLibraryStructure(missingDirRoot) },
			code: models.InvalidLibrary,
			data: []any{missingDirRoot, "missing required directory: mods"},
		},
		{
			name: "sync without an active library",
			run: func() error {
				_, err := empty.SyncMods(models.SyncModsInput{TaskID: "task", LibraryID: "library"}, nil)
				return err
			},
			code: models.NoActiveLibrary,
			data: nil,
		},
		{
			name: "sync rejects empty ids",
			run: func() error {
				_, err := svc.SyncMods(models.SyncModsInput{}, nil)
				return err
			},
			code: models.ParseError,
			data: "taskId and libraryId are required",
		},
		{
			name: "sync rejects a non-active library",
			run: func() error {
				_, err := svc.SyncMods(models.SyncModsInput{TaskID: "task", LibraryID: "other"}, nil)
				return err
			},
			code: models.InvalidLibrary,
			data: []any{"other", "not the active library"},
		},
		{
			name: "bulk update rejects a non-active library",
			run: func() error {
				return svc.BulkUpdateMods(models.BulkUpdateModsInput{LibraryID: "other", ModIDs: []string{"mod"}, Action: models.BulkActionEnable})
			},
			code: models.InvalidLibrary,
			data: []any{"other", "not the active library"},
		},
		{
			name: "bulk update rejects an unknown action",
			run: func() error {
				return svc.BulkUpdateMods(models.BulkUpdateModsInput{LibraryID: activeID, ModIDs: []string{"mod"}, Action: "bogus"})
			},
			code: models.ParseError,
			data: "invalid bulk update",
		},
		{
			name: "bulk update reports a missing mod",
			run: func() error {
				return svc.BulkUpdateMods(models.BulkUpdateModsInput{LibraryID: activeID, ModIDs: []string{"missing-mod"}, Action: models.BulkActionEnable})
			},
			code: models.ModNotFound,
			data: "missing-mod",
		},
		{
			name: "cancel rejects a foreign library",
			run:  func() error { return svc.CancelTask("task", "other") },
			code: models.InvalidLibrary,
			data: []any{"other", "not the active library"},
		},
		{
			name: "activate rejects an unregistered library",
			run:  func() error { return svc.ActivateLibrary("missing") },
			code: models.InvalidLibrary,
			data: []any{"missing", "Library not registered"},
		},
		{
			name: "rename rejects an unregistered library",
			run:  func() error { return svc.RenameLibrary("missing", "name") },
			code: models.InvalidLibrary,
			data: []any{"missing", "Library not registered"},
		},
		{
			name: "delete rejects an unregistered library",
			run:  func() error { return svc.DeleteLibrary("missing", false) },
			code: models.InvalidLibrary,
			data: []any{"missing", "Library not registered"},
		},
		{
			name: "snapshot reports an installed path that is not a directory",
			run:  func() error { _, err := conflictService.snapshotMod("conflict-mod"); return err },
			code: models.ModIdConflict,
			data: []any{"conflict-mod", filepath.Join(conflictService.active.ModsDir, "conflict-mod")},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.run()
			if err == nil {
				t.Fatal("expected an error")
			}
			testenv.RequireWireError(t, err, tc.code, tc.data)
		})
	}

	t.Run("load rejects a library without a manifest", func(t *testing.T) {
		_, loadErr := Load(missingManifestRoot)
		testenv.RequireInvalidLibraryPrefix(t, loadErr, missingManifestRoot, "manifest.toml: ")
	})
}

func TestLoadReportsAWireCodedMajorVersionChange(t *testing.T) {
	_, svc := deleteFixture(t)
	manifestPath := filepath.Join(svc.active.Root, "manifest.toml")
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	updated := strings.Replace(string(raw), `sptVersion = "4.0.11"`, `sptVersion = "3.11.4"`, 1)
	if updated == string(raw) {
		t.Fatalf("manifest fixture lacks the expected version: %s", raw)
	}
	if err := os.WriteFile(manifestPath, []byte(updated), 0600); err != nil {
		t.Fatal(err)
	}

	_, loadErr := Load(svc.active.Root)
	testenv.RequireWireError(t, loadErr, models.InvalidLibrary, []any{
		svc.active.Root,
		"SPT major version changed from 3.11.4 to 4.0.11; create a new library for the new major version",
	})
}

func TestArchiveErrorKeepsDeploymentCodes(t *testing.T) {
	root := filepath.Join(t.TempDir(), "library")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "deployment.toml"), []byte("this is [ not toml"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := deployment.LoadState(deployment.Layout{LibraryRoot: root})
	if err == nil {
		t.Fatal("expected a deployment state error")
	}
	coded := archiveError(err)
	if coded.Code != models.InvalidLibrary {
		t.Fatalf("archiveError collapsed %T to %q", err, coded.Code)
	}
	if data, ok := coded.Data.([]any); !ok || len(data) != 2 || data[0] != root {
		t.Fatalf("archiveError data %#v; want [root reason]", coded.Data)
	}
}
