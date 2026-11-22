package registry

import (
	"testing"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestRegistryErrorsUseTheInvalidLibraryTuple(t *testing.T) {
	t.Run("assert active library with no active library", func(t *testing.T) {
		err := NewTaskRegistry().AssertActiveLibrary("lib-1")
		testenv.RequireWireError(t, err, models.NoActiveLibrary, nil)
	})

	t.Run("assert a non-active library", func(t *testing.T) {
		registry := NewTaskRegistry()
		registry.SetActive("lib-1", true)
		err := registry.AssertActiveLibrary("lib-2")
		testenv.RequireWireError(t, err, models.InvalidLibrary, []any{"lib-2", "not the active library"})
	})

	t.Run("cancel a task from another library", func(t *testing.T) {
		registry := NewTaskRegistry()
		if err := registry.AcquireTask("task", "lib-1", func() {}); err != nil {
			t.Fatal(err)
		}
		err := registry.CancelTask("task", "lib-2")
		testenv.RequireWireError(t, err, models.InvalidLibrary, []any{"lib-2", "not the active library"})
	})
}
