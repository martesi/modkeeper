//go:build !e2e

package deployment

func e2eSyncBoundary() func(string) error { return nil }
