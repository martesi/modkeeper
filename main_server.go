//go:build server

package main

import (
	"log"
	"os"
	"strconv"

	"github.com/martes/modkeeper/backend"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func main() {
	appBackend := backend.NewApp()
	options := appOptions(appBackend)
	options.Server = serverOptions()
	app := application.New(options)
	startBackend(app, appBackend)
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// serverOptions is the server-mode bind configuration. It lives in Go so the
// defaults are visible next to the entrypoint that uses them; the environment
// only overrides them for ad-hoc runs and the dev task.
func serverOptions() application.ServerOptions {
	options := application.ServerOptions{
		Host: "127.0.0.1",
		Port: 8080,
	}
	if host := os.Getenv("MODKEEPER_SERVER_HOST"); host != "" {
		options.Host = host
	}
	if port := os.Getenv("MODKEEPER_SERVER_PORT"); port != "" {
		parsed, err := strconv.Atoi(port)
		if err != nil {
			log.Printf("modkeeper: ignoring invalid MODKEEPER_SERVER_PORT %q: %v", port, err)
		} else {
			options.Port = parsed
		}
	}
	return options
}
