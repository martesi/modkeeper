package forge

import "github.com/martes/modkeeper/backend/models"

// Error preserves the SError wire representation: {code, data}. It is an
// alias of the shared model so backend.MarshalError recognizes Forge failures
// on the command return path, not only in completion events.
type Error = models.Error

func fail(code, message string) error { return models.Fail(code, message) }
