package backend

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/forge"
	"github.com/martes/modkeeper/backend/models"
)

// requireMarshaledForgeError proves a bound Forge command failure keeps its
// domain code on the Wails wire contract instead of becoming Unexpected.
func requireMarshaledForgeError(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	payload := MarshalError(err)
	var fields map[string]json.RawMessage
	if unmarshalErr := json.Unmarshal(payload, &fields); unmarshalErr != nil {
		t.Fatalf("marshal %v: %s: %v", err, payload, unmarshalErr)
	}
	if _, ok := fields["code"]; !ok {
		t.Fatalf("missing code field: %s (%v)", payload, err)
	}
	if _, ok := fields["data"]; !ok {
		t.Fatalf("missing data field: %s (%v)", payload, err)
	}
	var code string
	if unmarshalErr := json.Unmarshal(fields["code"], &code); unmarshalErr != nil {
		t.Fatalf("decode code %s: %v", payload, unmarshalErr)
	}
	if code != want {
		t.Fatalf("wire code = %q, want %q: %s (%v)", code, want, payload, err)
	}
}

func TestBoundForgeFailuresMarshalWithCodedWire(t *testing.T) {
	t.Run("NoActiveLibrary", func(t *testing.T) {
		app := NewAppAt(filepath.Join(t.TempDir(), "config.toml"))
		if app.InitErr != nil {
			t.Fatal(app.InitErr)
		}
		// Force the Forge service guard itself, not the library resolver that
		// already returns a coded error.
		app.Forge.ActiveVersion = nil
		_, err := app.ForgeSearch("", 1, 1, 20)
		requireMarshaledForgeError(t, err, models.NoActiveLibrary)
	})

	t.Run("ParseError", func(t *testing.T) {
		app := NewAppAt(filepath.Join(t.TempDir(), "config.toml"))
		if app.InitErr != nil {
			t.Fatal(app.InitErr)
		}
		_, err := app.ForgeModDetail(models.ForgeKind("invalid"), 1)
		requireMarshaledForgeError(t, err, models.ParseError)
	})

	t.Run("IOError", func(t *testing.T) {
		app, _, _, _ := newForgeTestApp(t)
		server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
		app.Forge.BaseURL = server.URL
		server.Close()

		_, err := app.ForgeSearch("", 1, 1, 20)
		requireMarshaledForgeError(t, err, models.IOError)
	})

	t.Run("install admission without hooks", func(t *testing.T) {
		app := NewAppAt(filepath.Join(t.TempDir(), "config.toml"))
		if app.InitErr != nil {
			t.Fatal(app.InitErr)
		}
		app.Forge.Hooks.Admit = nil
		_, err := app.ForgeDownloadVersion(forge.ForgeDownloadVersionInput{
			TaskID:    "forge-no-admission",
			LibraryID: "library",
			Kind:      models.ForgeKindMod,
			ItemID:    1,
			VersionID: 2,
		})
		requireMarshaledForgeError(t, err, models.NoActiveLibrary)
	})
}
