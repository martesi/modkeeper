package registry

import (
	"encoding/json"
	"errors"
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

func TestRegistryErrorsUseTheInvalidLibraryTuple(t *testing.T) {
	t.Run("assert active library with no active library", func(t *testing.T) {
		err := NewTaskRegistry().AssertActiveLibrary("lib-1")
		requireWireError(t, err, models.NoActiveLibrary, nil)
	})

	t.Run("assert a non-active library", func(t *testing.T) {
		registry := NewTaskRegistry()
		registry.SetActive("lib-1", true)
		err := registry.AssertActiveLibrary("lib-2")
		requireWireError(t, err, models.InvalidLibrary, []any{"lib-2", "not the active library"})
	})

	t.Run("cancel a task from another library", func(t *testing.T) {
		registry := NewTaskRegistry()
		if err := registry.AcquireTask("task", "lib-1", func() {}); err != nil {
			t.Fatal(err)
		}
		err := registry.CancelTask("task", "lib-2")
		requireWireError(t, err, models.InvalidLibrary, []any{"lib-2", "not the active library"})
	})
}
