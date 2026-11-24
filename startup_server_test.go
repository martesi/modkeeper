//go:build server

package main

import (
	"testing"
)

func TestServerStartupConfiguration(t *testing.T) {
	t.Setenv("MODKEEPER_SERVER_HOST", "")
	t.Setenv("MODKEEPER_SERVER_PORT", "")
	if !serverBuild {
		t.Fatal("server build must select headless startup before application.New")
	}
	if got := serverOptions(); got.Host != "127.0.0.1" || got.Port != 8080 {
		t.Fatalf("unexpected defaults: %+v", got)
	}
	t.Setenv("MODKEEPER_SERVER_HOST", "0.0.0.0")
	t.Setenv("MODKEEPER_SERVER_PORT", "12345")
	if got := serverOptions(); got.Host != "0.0.0.0" || got.Port != 12345 {
		t.Fatalf("unexpected overrides: %+v", got)
	}
	t.Setenv("MODKEEPER_SERVER_PORT", "invalid")
	if got := serverOptions(); got.Port != 8080 {
		t.Fatalf("invalid port did not retain default: %+v", got)
	}
}
