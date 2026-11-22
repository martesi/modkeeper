package deployment

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestDeploymentErrorsUseTheWireContract(t *testing.T) {
	l := fixture(t)
	message := "Deployment target already exists or cannot be safely removed: 'target'."
	targetPath := filepath.Join(l.LibraryRoot, "target")

	cases := []struct {
		name string
		run  func() error
		code string
		data any
	}{
		{
			name: "collision",
			run:  func() error { return collision("target") },
			code: models.FileCollision,
			data: []any{message},
		},
		{
			name: "invalid library",
			run:  func() error { return invalid(l, "deployment.toml: bad") },
			code: models.InvalidLibrary,
			data: []any{l.LibraryRoot, "deployment.toml: bad"},
		},
		{
			name: "io error",
			run:  func() error { return ioError(errors.New("disk full")) },
			code: models.IOError,
			data: "disk full",
		},
		{
			name: "io error preserves a coded error",
			run:  func() error { return ioError(models.Fail(models.FileOrDirectoryNotFound, targetPath)) },
			code: models.FileOrDirectoryNotFound,
			data: targetPath,
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

	t.Run("load state reports a corrupt deployment file", func(t *testing.T) {
		if err := os.WriteFile(l.Paths().Deployment, []byte("this is [ not toml"), 0600); err != nil {
			t.Fatal(err)
		}
		_, err := LoadState(l)
		testenv.RequireInvalidLibraryPrefix(t, err, l.LibraryRoot, "deployment.toml: ")
	})
}
