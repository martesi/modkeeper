package testenv

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

// RequireWireData asserts the JSON payload Wails sends for a returned error and
// returns its data field. Wails marshals the concrete error value, so a plain
// Go error, or a wrapper around a coded error, reaches the frontend as "{}"
// and the bridge rejects it as a transport failure. Marshaling the error itself
// keeps this assertion honest: a wrapped *models.Error must still serialize.
func RequireWireData(t testing.TB, err error, code string) json.RawMessage {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	raw, marshalErr := json.Marshal(err)
	if marshalErr != nil {
		t.Fatalf("marshal %T: %v", err, marshalErr)
	}
	var wire map[string]json.RawMessage
	if unmarshalErr := json.Unmarshal(raw, &wire); unmarshalErr != nil {
		t.Fatalf("unmarshal %s: %v", raw, unmarshalErr)
	}
	if len(wire) != 2 {
		t.Fatalf("wire payload %s must carry exactly code and data (error %T: %v)", raw, err, err)
	}
	if got := string(wire["code"]); got != `"`+code+`"` {
		t.Fatalf("wire code %s; want %q (payload %s)", got, code, raw)
	}
	data, ok := wire["data"]
	if !ok {
		t.Fatalf("payload %s omits data; the bridge requires the key", raw)
	}
	return data
}

// RequireWireError is RequireWireData with an exact expected data value.
func RequireWireError(t testing.TB, err error, code string, wantData any) {
	t.Helper()
	data := RequireWireData(t, err, code)
	want, marshalErr := json.Marshal(wantData)
	if marshalErr != nil {
		t.Fatalf("marshal want data: %v", marshalErr)
	}
	if string(data) != string(want) {
		t.Fatalf("wire data %s; want %s", data, want)
	}
}

// RequireInvalidLibraryPrefix asserts InvalidLibrary's two-element
// [path, reason] shape when the reason carries operating-system text.
func RequireInvalidLibraryPrefix(t testing.TB, err error, path, reasonPrefix string) {
	t.Helper()
	data := RequireWireData(t, err, models.InvalidLibrary)
	var pair []string
	if unmarshalErr := json.Unmarshal(data, &pair); unmarshalErr != nil || len(pair) != 2 {
		t.Fatalf("InvalidLibrary data %s; want [path, reason]", data)
	}
	if pair[0] != path {
		t.Fatalf("InvalidLibrary path %q; want %q", pair[0], path)
	}
	if !strings.HasPrefix(pair[1], reasonPrefix) {
		t.Fatalf("InvalidLibrary reason %q; want prefix %q", pair[1], reasonPrefix)
	}
}
