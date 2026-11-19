package backend

import "fmt"

// Error preserves the Rust SError wire representation: {code, data}.
type Error struct {
	Code string `json:"code"`
	Data any    `json:"data,omitempty"`
}

func (e *Error) Error() string {
	if e.Data == nil {
		return e.Code
	}
	return fmt.Sprintf("%s: %v", e.Code, e.Data)
}

func failure(code string, data any) *Error { return &Error{Code: code, Data: data} }
