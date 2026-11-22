package stager

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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

func TestResolveErrorsUseTheWireContract(t *testing.T) {
	staging := t.TempDir()

	unknown := filepath.Join(t.TempDir(), "unknown.zip")
	writeZip(t, unknown, map[string]string{"readme.txt": "nothing"})

	running := filepath.Join(t.TempDir(), "running.zip")
	writeZip(t, running, map[string]string{"SPT/user/mods/Example/tool.exe": "exe"})

	cases := []struct {
		name      string
		input     string
		inspector ProcessInspector
		code      string
		data      any
	}{
		{
			name:  "unknown layout",
			input: unknown,
			code:  models.UnableToDetermineModId,
			data:  nil,
		},
		{
			name:      "mod tool is running",
			input:     running,
			inspector: inspectorFunc(func([]string) bool { return true }),
			code:      models.ProcessRunning,
			data:      nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Resolve([]string{tc.input}, staging, "SPT/user/mods", "BepInEx/plugins", tc.inspector)
			if err == nil {
				t.Fatal("expected an error")
			}
			requireWireError(t, err, tc.code, tc.data)
		})
	}
}

type inspectorFunc func([]string) bool

func (f inspectorFunc) IsRunning(paths []string) bool { return f(paths) }

func writeZip(t *testing.T, path string, files map[string]string) {
	t.Helper()
	out, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(out)
	for name, content := range files {
		entry, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
}
