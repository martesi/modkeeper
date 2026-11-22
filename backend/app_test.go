package backend

import "testing"

func TestApplyWindowEffectAcceptsThemeChangesWithoutFailing(t *testing.T) {
	// Wails has no runtime backdrop setter, so the compatibility method must
	// resolve successfully for both explicit and system-derived themes.
	if err := (&App{}).ApplyWindowEffect(nil); err != nil {
		t.Fatalf("nil theme: %v", err)
	}
	dark := true
	if err := (&App{}).ApplyWindowEffect(&dark); err != nil {
		t.Fatalf("explicit theme: %v", err)
	}
}
