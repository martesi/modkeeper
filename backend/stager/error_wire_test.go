package stager

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

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
			testenv.RequireWireError(t, err, tc.code, tc.data)
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
