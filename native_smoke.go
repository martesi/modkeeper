package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"slices"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// NativeSmokeService is registered only when MODKEEPER_NATIVE_SMOKE=1.
type NativeSmokeService struct {
	settings chan string
	ready    chan struct{}
	event    chan string
	drop     chan string
	ui       chan string
	flow     chan string
	release  chan struct{}
	once     sync.Once
}

func newNativeSmokeService() *NativeSmokeService {
	return &NativeSmokeService{
		settings: make(chan string, 1),
		ready:    make(chan struct{}, 1),
		event:    make(chan string, 1),
		drop:     make(chan string, 1),
		ui:       make(chan string, 1),
		flow:     make(chan string, 1),
		release:  make(chan struct{}),
	}
}

func nativeSmokeURL(enabled bool) string {
	if enabled {
		if url := os.Getenv("MODKEEPER_NATIVE_SMOKE_URL"); url != "" {
			return url
		}
		return "/?native-smoke=1"
	}
	return "/"
}

func (s *NativeSmokeService) ReportSettings(value string) error {
	s.settings <- value
	return nil
}

func (s *NativeSmokeService) ListenerReady() error {
	s.ready <- struct{}{}
	return nil
}

func (s *NativeSmokeService) ReportEvent(value string) error {
	s.event <- value
	return nil
}

func (s *NativeSmokeService) ReportDropFiles(value string) error {
	s.drop <- value
	return nil
}

func (s *NativeSmokeService) ReportUIInteraction(value string) error {
	log.Printf("native-smoke: PASS xdotool-driven native UI interaction (%s)", value)
	s.ui <- value
	return nil
}

func (s *NativeSmokeService) ReportNativeFlow(value string) error {
	log.Printf("native-smoke: %s", value)
	s.flow <- value
	return nil
}

func (s *NativeSmokeService) HoldInstall() {
	<-s.release
}

func (s *NativeSmokeService) ReleaseInstall() {
	s.once.Do(func() { close(s.release) })
}

func runNativeSmoke(app *application.App, window *application.WebviewWindow, service *NativeSmokeService) {
	log.Printf("native-smoke: automation flow=%q ui=%q", os.Getenv("MODKEEPER_NATIVE_SMOKE_FLOW"), os.Getenv("MODKEEPER_NATIVE_SMOKE_UI"))
	wait := func(link string, receive func() error) bool {
		done := make(chan error, 1)
		go func() { done <- receive() }()
		deadline := 15 * time.Second
		if link == "real backend archive flows" {
			deadline = 3 * time.Minute
		}
		timer := time.NewTimer(deadline)
		defer timer.Stop()
		select {
		case err := <-done:
			if err != nil {
				log.Printf("native-smoke: FAIL %s: %v", link, err)
				app.Quit()
				return false
			}
			log.Printf("native-smoke: PASS %s", link)
			return true
		case <-timer.C:
			log.Printf("native-smoke: FAIL %s: timed out", link)
			app.Quit()
			return false
		}
	}

	if !wait("settings JS→Go→JS value", func() error {
		value := <-service.settings
		var got struct {
			Theme               string `json:"theme"`
			AccentColor         string `json:"accentColor"`
			Language            string `json:"language"`
			EnableModsOnInstall bool   `json:"enableModsOnInstall"`
		}
		if err := json.Unmarshal([]byte(value), &got); err != nil {
			return err
		}
		if got.Theme != "system" || got.AccentColor != "default" ||
			got.Language != "en-US" || !got.EnableModsOnInstall {
			return fmt.Errorf("settings mismatch: got %s", value)
		}
		return nil
	}) {
		return
	}
	if !wait("frontend event listener ready", func() error {
		<-service.ready
		return nil
	}) {
		return
	}

	const payload = "native-smoke-event-payload"
	window.ExecJS("window.__nativeSmokeGoExecJS = true")
	if window.EmitEvent("native-smoke-event", payload) {
		log.Printf("native-smoke: FAIL Go event emit: event was cancelled")
		app.Quit()
		return
	}
	log.Printf("native-smoke: PASS Go emitted registered event")
	if !wait("event payload observed by frontend and reported to Go", func() error {
		got := <-service.event
		var observed struct {
			Payload        string `json:"payload"`
			ExecJSObserved bool   `json:"execJSObserved"`
		}
		if err := json.Unmarshal([]byte(got), &observed); err != nil {
			return err
		}
		if observed.Payload != payload || !observed.ExecJSObserved {
			return fmt.Errorf("event/ExecJS observation mismatch: got %s", got)
		}
		return nil
	}) {
		return
	}

	dropFiles := []string{"/tmp/modkeeper-native-smoke-drop.zip"}
	encoded, err := json.Marshal(dropFiles)
	if err != nil {
		log.Printf("native-smoke: FAIL file drop encoding: %v", err)
		app.Quit()
		return
	}
	window.ExecJS(fmt.Sprintf(
		"window._wails.handlePlatformFileDrop(%s, 50, 50)",
		encoded,
	))
	if !wait("native file drop reaches the renderer callback", func() error {
		got := <-service.drop
		var dropped []string
		if err := json.Unmarshal([]byte(got), &dropped); err != nil {
			return err
		}
		if !slices.Equal(dropped, dropFiles) {
			return fmt.Errorf("dropped files = %v, want %v", dropped, dropFiles)
		}
		return nil
	}) {
		return
	}
	if os.Getenv("MODKEEPER_NATIVE_SMOKE_FLOW") == "1" || os.Getenv("MODKEEPER_NATIVE_SMOKE_UI") == "1" {
		return
	}
	app.Quit()
}
