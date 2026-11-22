package backend

import (
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

func TestLogReportsMissingApplicationLogger(t *testing.T) {
	// Unit tests do not create a Wails application, so the compatibility method
	// must return a typed error instead of panicking on a nil logger.
	assertErrorCode(t, (&App{}).Log("diagnostic"), models.Unexpected)
}
