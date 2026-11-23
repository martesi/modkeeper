package backend

import "github.com/martes/modkeeper/backend/models"

// DropTarget is the element under a native file drop, as the window reports it.
type DropTarget struct {
	X          int
	Y          int
	ElementID  string
	ClassList  []string
	Attributes map[string]string
}

// WindowFilesDroppedPayload builds the renderer event for a native file drop.
// A nil target means the drop did not report an element, so only the file
// names are set.
func WindowFilesDroppedPayload(files []string, target *DropTarget) models.WindowFilesDroppedEvent {
	payload := models.WindowFilesDroppedEvent{Filenames: files}
	if target == nil {
		return payload
	}
	payload.X = target.X
	payload.Y = target.Y
	payload.ElementDetails = models.WindowDropElementDetails{
		ID:         target.ElementID,
		ClassList:  target.ClassList,
		Attributes: target.Attributes,
	}
	return payload
}
