package models

// WindowFilesDroppedEvent is the payload the desktop window forwards to the
// frontend on `modkeeper:files-dropped`. It mirrors Wails' native file-drop
// payload so the renderer can read the dropped paths and the hovered element.
type WindowFilesDroppedEvent struct {
	Filenames      []string                 `json:"filenames"`
	X              int                      `json:"x"`
	Y              int                      `json:"y"`
	ElementDetails WindowDropElementDetails `json:"elementDetails"`
}

// WindowDropElementDetails identifies the drop target element reported by
// Wails. It is empty when the drop did not land on a marked element.
type WindowDropElementDetails struct {
	ID         string            `json:"id"`
	ClassList  []string          `json:"classList"`
	Attributes map[string]string `json:"attributes"`
}
