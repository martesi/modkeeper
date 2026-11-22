//go:build server

package backend

import (
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

func TestOpenPathIsUnavailableInServerMode(t *testing.T) {
	err := (&App{}).OpenPath(t.TempDir())
	assertErrorCode(t, err, models.Unexpected)
}
