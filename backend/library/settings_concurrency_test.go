package library

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"github.com/martes/modkeeper/backend/config"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestConcurrentSettingsReadsAndWrites(t *testing.T) {
	service, err := New(filepath.Join(t.TempDir(), "config.toml"))
	if err != nil {
		t.Fatal(err)
	}

	env := testenv.New(t)

	const workers = 8
	const writesPerWorker = 20
	var group sync.WaitGroup
	errors := make(chan error, workers*writesPerWorker)
	for worker := 0; worker < workers; worker++ {
		group.Add(1)
		go func(worker int) {
			defer group.Done()
			for n := 0; n < writesPerWorker; n++ {
				settings := config.DefaultSettings()
				settings.ForgeEndpoint = fmt.Sprintf("https://forge.example/%d", worker)
				if _, err := service.SaveSettings(settings); err != nil {
					errors <- err
					return
				}
				_ = service.GetSettings()
			}
		}(worker)
	}

	group.Add(1)
	go func() {
		defer group.Done()
		libraryRoot := filepath.Join(env.Root, "concurrent-library")
		if err := service.CreateLibrary(models.CreateLibraryInput{
			GameRoot:    env.GameRoot,
			LibraryRoot: &libraryRoot,
		}); err != nil {
			errors <- err
		}
	}()

	group.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}

	if endpoint := service.GetSettings().ForgeEndpoint; endpoint == "" {
		t.Fatal("settings save was lost during library creation")
	}
	if service.Store.Config.FindLibraryByHandle(filepath.Join(env.Root, "concurrent-library")) == nil {
		t.Fatal("library transition was lost during settings save")
	}

}
