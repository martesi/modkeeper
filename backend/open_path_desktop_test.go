//go:build !server

package backend

import (
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

func TestOpenPathReportsMissingWailsApp(t *testing.T) {
	// A unit test has no running Wails application, so an existing path must
	// fail with a typed error instead of panicking on a nil application.
	err := (&App{}).OpenPath(t.TempDir())
	assertErrorCode(t, err, models.Unexpected)
}
