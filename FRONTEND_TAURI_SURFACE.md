# Frontend Tauri surface

Inventory from `src/{lib,utils,redesign,routes,components}` and `e2e/`.
Type-only `@gen/bindings` imports are included because they are Specta-generated
contracts, but they do not make runtime calls.

## Runtime commands and events

- `src/redesign/data/{library-repository,settings-repository,registry-repository,redesign-initializers}.ts[x]`
  call generated `commands` from `src/gen/bindings.ts`.
- Commands: `bulkUpdateMods`, `syncMods`, `installModArchives`,
  `rebuildLibraryCache`, `renameLibrary`, `deleteLibrary`, `forgeSearch`,
  `forgeModDetail`, `forgeModVersions`, `forgeAddonVersions`,
  `forgeDownloadVersion`, `forgeMatchInstalledMod`, `getLibraryWorkspace`,
  `activateLibrary`, `createLibrary`, `applyWindowEffect`, `getSettings`,
  `saveSettings`.
- Generated events: `taskProgress` (`task_progress`) and `workspaceEvent`
  (`workspace-event`); used by `library-repository.ts`.
- `e2e/bindings.test.ts` directly uses Tauri `mockIPC`, `clearMocks`, and
  generated event listen/emit. `e2e/native-smoke.ts` exercises Tauri event
  emission. These remain Tauri-specific tests.

## Tauri APIs and plugins

- `@tauri-apps/api/core` `isTauri`: `utils/boot-diagnostics.ts`,
  `redesign/app/redesign-initializers.tsx`, `redesign/shell/{app-background,titlebar}.tsx`,
  `redesign/shared/{hooks/use-archive-file-picker,hooks/use-window-drop-zone,utils/app-opener}.ts`,
  `redesign/data/{library-repository,settings-repository,tools-repository,registry-repository}.ts`,
  `redesign/library/{manage-library/manage-library-dialog,manage-library/configure-tool-dialog}.tsx`,
  `redesign/registry/registry-detail-inspector.tsx`.
- `@tauri-apps/api/window`: current-window minimize/maximize/close in
  `redesign/shell/titlebar.tsx`; drag/drop subscription in
  `redesign/shared/hooks/use-window-drop-zone.ts`.
- `@tauri-apps/plugin-dialog`: `lib/library-actions.ts`,
  `redesign/shared/hooks/use-archive-file-picker.ts`,
  `redesign/library/manage-library/{manage-library-dialog,configure-tool-dialog}.tsx`.
- `@tauri-apps/plugin-opener`: `redesign/shared/utils/app-opener.ts`,
  `redesign/registry/registry-detail-inspector.tsx`,
  `redesign/data/tools-repository.ts`.
- `@tauri-apps/plugin-log`: `utils/boot-diagnostics.ts`.
- No `window.__TAURI__` references were found.
- Tauri terminology and `isTauri` boolean in `redesign/data/runtime-boundary.ts`
  and tests are application branching, not API invocations.

## Wails bridge contract / remaining integration

`src/wails/{runtime,bridge,events}.ts` provides an opt-in compatibility layer.
Generated methods are mapped by their Specta camelCase names to
`window.go.<package>.App.<method>(...args)`. Their argument order matches the
generated TypeScript methods. The Go binding package can be any package key;
the `App` receiver is expected. Without a matching method, the exact generated
Tauri function is called.

Wails events use `window.runtime.EventsOn/EventsOnce/EventsEmit`, with event
names from the generated binding. Call sites still import `@gen/bindings` and
Tauri plugins directly. The owning integration must route command/event imports
through this shim and replace Tauri-only runtime/plugin/window APIs before a
Wails UI build. W4 currently has no Go bindings, so methods, argument adaptation,
error wire shape, window methods, dialogs, and opener behavior need W4/W2
confirmation. No backend logic is implemented here.
