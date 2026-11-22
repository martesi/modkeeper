package backend

import (
	"encoding/json"
	"errors"

	"github.com/martes/modkeeper/backend/models"
)

// Error preserves the Rust SError wire representation: {code, data}.
type Error = models.Error

func failure(code string, data any) *Error { return models.Fail(code, data) }

// MarshalError is the Wails service error marshaler. Wails otherwise serializes
// the concrete error value, so an uncoded or wrapper error reaches the frontend
// as "{}" and the bridge reports a transport failure. Coded errors keep their
// exact payload; anything else becomes an Unexpected code with the same human
// message.
func MarshalError(err error) []byte {
	if err == nil {
		return nil
	}
	var coded *models.Error
	if !errors.As(err, &coded) {
		coded = models.Fail(models.Unexpected, err.Error())
	}
	payload, marshalErr := json.Marshal(coded)
	if marshalErr != nil {
		return nil
	}
	return payload
}
