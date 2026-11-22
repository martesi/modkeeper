/**
 * macOS keeps its native traffic lights; other desktop shells get the in-app
 * caption buttons. Server and browser pages have no window to control.
 */
export function showWindowControls(
  isMacOS: boolean,
  nativeWindowChrome: boolean,
): boolean {
  return nativeWindowChrome && !isMacOS
}
