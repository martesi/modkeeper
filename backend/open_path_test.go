package backend

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

func TestOpenPathValidatesPathBeforeOpeningTheFileManager(t *testing.T) {
	app := &App{}
	tests := []struct {
		name string
		path string
	}{
		{name: "empty", path: ""},
		{name: "whitespace", path: "   "},
		{name: "missing", path: filepath.Join(t.TempDir(), "missing")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := app.OpenPath(test.path)
			assertErrorCode(t, err, models.FileOrDirectoryNotFound)
		})
	}
}

func assertErrorCode(t *testing.T, err error, code string) {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	var typed *models.Error
	if !errors.As(err, &typed) {
		t.Fatalf("expected a typed models.Error, got %T: %v", err, err)
	}
	if typed.Code != code {
		t.Fatalf("expected error code %q, got %q", code, typed.Code)
	}
}
