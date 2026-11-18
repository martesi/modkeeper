/*
 * The accent swatch list (reference Modkeeper.dc.html `ACCENTS`). Data-only module so the
 * §4 contrast unit test can import it without pulling React or the lingui macro.
 */
export const ACCENT_SWATCHES: { name: string; value: string }[] = [
  { name: 'Default', value: 'default' },
  { name: 'Pink', value: '#e91e63' },
  { name: 'Blue', value: '#6c8ef5' },
  { name: 'Green', value: '#3ecf8e' },
  { name: 'Orange', value: '#f5a35c' },
]
