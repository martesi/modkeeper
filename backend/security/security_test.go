package security

import (
	"errors"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
	"os"
	"path/filepath"
	"testing"
)

func TestDeletingUnknownOrUnsafeModIDsPreservesExternalFiles(t *testing.T) {
	env := testenv.New(t)
	outside := filepath.Join(env.Root, "outside")
	testenv.WriteTree(t, outside, map[string]string{"keep.txt": "user data"})
	for _, id := range []string{"../../outside", `..\..\outside`, outside, "..", ".", "", "mod:stream", `C:\outside`, "mod\x00stream"} {
		if _, err := SafeJoin(env.ModsDir, id); err == nil {
			t.Fatalf("accepted unsafe id %q", id)
		} else {
			var wire *models.Error
			if !errors.As(err, &wire) || wire.Code != models.ModNotFound {
				t.Fatalf("wrong error: %v", err)
			}
		}
		got, err := os.ReadFile(filepath.Join(outside, "keep.txt"))
		if err != nil || string(got) != "user data" {
			t.Fatalf("sentinel changed: %s %v", got, err)
		}
	}
	if err := os.Symlink(outside, filepath.Join(env.ModsDir, "escaped")); err != nil {
		t.Fatal(err)
	}
	if _, err := SafeJoin(env.ModsDir, "escaped"); err == nil {
		t.Fatal("accepted external symlink")
	}
	if err := os.Symlink(filepath.Join(outside, "missing"), filepath.Join(env.ModsDir, "dangling")); err != nil {
		t.Fatal(err)
	}
	if _, err := SafeJoin(env.ModsDir, "dangling"); err == nil {
		t.Fatal("accepted dangling symlink")
	}
	if _, err := os.Stat(env.ModsDir); err != nil {
		t.Fatal(err)
	}
}

func TestSafeJoinAcceptsLocalMod(t *testing.T) {
	env := testenv.New(t)
	want := env.AddMod("safe", "Example", models.ModTypeServer)
	got, err := SafeJoin(env.ModsDir, "safe")
	if err != nil || got != want {
		t.Fatalf("got %q %v", got, err)
	}
	got, err = SafeJoin(env.ModsDir, "new-mod")
	if err != nil || got != filepath.Join(env.ModsDir, "new-mod") {
		t.Fatalf("got %q %v", got, err)
	}
}
