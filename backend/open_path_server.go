//go:build server

package backend

import "github.com/martes/modkeeper/backend/models"

var openPathTarget = func(string, bool) error {
	return models.Fail(models.Unexpected, "openPath is unavailable in server mode")
}
