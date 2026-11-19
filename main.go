package main

import (
	"context"
	"embed"
	"io/fs"
	"log"

	"github.com/martes/modkeeper/backend"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:dist
var frontend embed.FS

func main() {
	assets, err := fs.Sub(frontend, "dist")
	if err != nil {
		log.Fatal(err)
	}
	if err := wails.Run(&options.App{
		Title:  "Modkeeper",
		Width:  1200,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: func(ctx context.Context) {},
		Bind:      []interface{}{backend.NewApp()},
	}); err != nil {
		log.Fatal(err)
	}
}
