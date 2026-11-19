package backend

import "github.com/martes/modkeeper/backend/models"

// Error preserves the Rust SError wire representation: {code, data}.
type Error = models.Error

func failure(code string, data any) *Error { return models.Fail(code, data) }
