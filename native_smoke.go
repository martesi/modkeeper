package main

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// NativeSmokeService is registered only when MODKEEPER_NATIVE_SMOKE=1.
type NativeSmokeService struct {
	settings chan string
	ready    chan struct{}
	event    chan string
}

func newNativeSmokeService() *NativeSmokeService {
	return &NativeSmokeService{
		settings: make(chan string, 1),
		ready:    make(chan struct{}, 1),
		event:    make(chan string, 1),
	}
}

func nativeSmokeURL(enabled bool) string {
	if enabled {
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

func runNativeSmoke(app *application.App, window *application.WebviewWindow, service *NativeSmokeService) {
	const deadline = 15 * time.Second
	wait := func(link string, receive func() error) bool {
		done := make(chan error, 1)
		go func() { done <- receive() }()
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
	app.Quit()
}
