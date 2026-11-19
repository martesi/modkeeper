package models

import "fmt"

type Error struct {
	Code string `json:"code"`
	Data any `json:"data"`
}

func (e *Error) Error() string {
	if e.Data == nil { return e.Code }
	return fmt.Sprintf("%s: %v", e.Code, e.Data)
}

func Fail(code string, data ...any) *Error {
	e := &Error{Code: code}
	if len(data) == 1 { e.Data = data[0] } else if len(data) > 1 { e.Data = data }
	return e
}

const (
	UnsupportedSPTVersion = "UnsupportedSPTVersion"
	ParseError = "ParseError"
	IOError = "IOError"
	GameOrServerRunning = "GameOrServerRunning"
	ProcessRunning = "ProcessRunning"
	UnableToDetermineModId = "UnableToDetermineModId"
	ModNotFound = "ModNotFound"
	FileOrDirectoryNotFound = "FileOrDirectoryNotFound"
	FileCollision = "FileCollision"
	Unexpected = "Unexpected"
	UnhandledCompression = "UnhandledCompression"
	AsyncRuntimeError = "AsyncRuntimeError"
	NoActiveLibrary = "NoActiveLibrary"
	InvalidLibrary = "InvalidLibrary"
	ModIdConflict = "ModIdConflict"
	ConfigSaveFailed = "ConfigSaveFailed"
	TaskIdInUse = "TaskIdInUse"
)
