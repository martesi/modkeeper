package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

func TestMarshalErrorKeepsCodedPayloadsAndCodesPlainErrors(t *testing.T) {
	coded := models.Fail(models.InvalidLibrary, "root", "reason")
	want, err := json.Marshal(coded)
	if err != nil {
		t.Fatal(err)
	}

	plain := errors.New("boom")
	wantPlain, err := json.Marshal(&models.Error{Code: models.Unexpected, Data: "boom"})
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		err  error
		want string
	}{
		{name: "coded", err: coded, want: string(want)},
		{name: "wrapped coded", err: fmt.Errorf("install failed: %w", coded), want: string(want)},
		{name: "plain", err: plain, want: string(wantPlain)},
		{name: "nil", err: nil, want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := string(MarshalError(tc.err)); got != tc.want {
				t.Fatalf("MarshalError = %s; want %s", got, tc.want)
			}
		})
	}
}
