package backend

import (
	"reflect"
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

func TestWindowFilesDroppedPayloadMapsElementDetails(t *testing.T) {
	target := &DropTarget{
		X:          41,
		Y:          73,
		ElementID:  "root",
		ClassList:  []string{"shell", "drop-ready"},
		Attributes: map[string]string{"data-file-drop-target": ""},
	}
	got := WindowFilesDroppedPayload([]string{"/tmp/a.zip", "/tmp/b.7z"}, target)
	want := models.WindowFilesDroppedEvent{
		Filenames: []string{"/tmp/a.zip", "/tmp/b.7z"},
		X:         41,
		Y:         73,
		ElementDetails: models.WindowDropElementDetails{
			ID:         "root",
			ClassList:  []string{"shell", "drop-ready"},
			Attributes: map[string]string{"data-file-drop-target": ""},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("drop payload = %#v, want %#v", got, want)
	}
}

func TestWindowFilesDroppedPayloadWithoutTargetKeepsFilenames(t *testing.T) {
	got := WindowFilesDroppedPayload([]string{"/tmp/a.zip"}, nil)
	if !reflect.DeepEqual(got.Filenames, []string{"/tmp/a.zip"}) {
		t.Fatalf("filenames = %#v", got.Filenames)
	}
	if got.X != 0 || got.Y != 0 || got.ElementDetails.ID != "" {
		t.Fatalf("unexpected target details: %#v", got)
	}
}
