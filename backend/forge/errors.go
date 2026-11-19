package forge

import "fmt"

// Error preserves SError until the foundation models.Error is available.
type Error struct {
	Code string `json:"code"`
	Data any    `json:"data"`
}

func (e *Error) Error() string        { return fmt.Sprintf("%s: %v", e.Code, e.Data) }
func fail(code, message string) error { return &Error{Code: code, Data: message} }
