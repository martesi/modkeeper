package deployment

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

func requireWireError(t *testing.T, err error, code string, wantData any) {
	t.Helper()
	var coded *models.Error
	if !errors.As(err, &coded) {
		t.Fatalf("got %T (%v); want *models.Error with code %s", err, err, code)
	}
	raw, marshalErr := json.Marshal(coded)
	if marshalErr != nil {
		t.Fatalf("marshal %v: %v", coded, marshalErr)
	}
	var wire map[string]json.RawMessage
	if unmarshalErr := json.Unmarshal(raw, &wire); unmarshalErr != nil {
		t.Fatalf("unmarshal %s: %v", raw, unmarshalErr)
	}
	if len(wire) != 2 {
		t.Fatalf("wire shape %s must carry exactly code and data", raw)
	}
	if got := string(wire["code"]); got != `"`+code+`"` {
		t.Fatalf("wire code %s; want %q (payload %s)", got, code, raw)
	}
	data, ok := wire["data"]
	if !ok {
		t.Fatalf("payload %s omits data; the bridge requires the key", raw)
	}
	want, marshalErr := json.Marshal(wantData)
	if marshalErr != nil {
		t.Fatalf("marshal want data: %v", marshalErr)
	}
	if string(data) != string(want) {
		t.Fatalf("wire data %s; want %s", data, want)
	}
}

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
			requireWireError(t, err, tc.code, tc.data)
		})
	}

	t.Run("load state reports a corrupt deployment file", func(t *testing.T) {
		if err := os.WriteFile(l.Paths().Deployment, []byte("this is [ not toml"), 0600); err != nil {
			t.Fatal(err)
		}
		_, err := LoadState(l)
		var coded *models.Error
		if !errors.As(err, &coded) || coded.Code != models.InvalidLibrary {
			t.Fatalf("got %T (%v); want InvalidLibrary", err, err)
		}
		pair, ok := coded.Data.([]any)
		if !ok || len(pair) != 2 || pair[0] != l.LibraryRoot {
			t.Fatalf("data %#v; want [root reason]", coded.Data)
		}
		reason, _ := pair[1].(string)
		if !strings.HasPrefix(reason, "deployment.toml: ") {
			t.Fatalf("reason %q; want deployment.toml prefix", reason)
		}
	})
}
