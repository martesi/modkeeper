import type { Area } from './model-types'

const api = 'backend-api'
const disk = 'backend-filesystem'
const process = 'linux-process'
const mock = 'browser-mock'
const linux = 'native-linux'
const windows = 'native-windows'

export const crosscuttingJourneys = {
  deploy: {
    surfaces: [disk, linux],
    contexts: {
      'enabled-mod':
        'An enabled mod is in the library and has not been synced.',
      'unchanged-plan': 'The game tree already matches the enabled mod plan.',
      'previous-sync': 'An enabled mod was previously deployed.',
      'shared-game-tree':
        'The destination has another mod or user-created content.',
      'legacy-links': 'The game tree has old links into the library.',
      'running-executable':
        'A real game or server executable is running from this game root.',
      'task-progress-fixture':
        'The mock supplies an active sync task and a progress/log update.',
    },
    journeys: [
      [
        'first-sync',
        'Sync an enabled mod for the first time',
        'The game receives the mod and the task reports success',
        ['enabled-mod'],
        [api, linux],
      ],
      [
        'noop-sync',
        'Sync again without changing the plan',
        'The app retains directory ownership',
        ['unchanged-plan'],
        [disk],
      ],
      [
        'sync-after-toggle',
        'Disable a deployed mod and sync',
        'The deployed copy is removed and the library source remains',
        ['previous-sync', 'shared-game-tree'],
      ],
      [
        'collision',
        'Sync into a conflicting game tree',
        'Sync rejects the conflict without overwriting user files',
        ['shared-game-tree'],
      ],
      [
        'stale',
        'Check deployment freshness after editing a library mod',
        'The old deployment is reported as stale',
        ['previous-sync'],
        [api, linux],
      ],
      [
        'purge',
        'Purge legacy links from the game tree',
        'Only owned links are removed; external targets are untouched',
        ['legacy-links'],
        [disk, linux, windows],
      ],
      [
        'copy-mode',
        'Sync in copy mode',
        'The app keeps existing game files and does not claim their directory',
        ['shared-game-tree'],
        [disk],
      ],
      [
        'link-mode',
        'Sync in link mode',
        'Links can share a game folder without replacing the folder',
        ['shared-game-tree'],
        [disk, windows],
      ],
      [
        'game-running',
        'Try to sync while the game is running',
        'Sync is blocked without changing the game tree',
        ['running-executable'],
        [linux, windows],
      ],
      [
        'server-running',
        'Try to sync while the SPT server is running',
        'Sync is blocked without changing the game tree',
        ['running-executable'],
        [linux, windows],
      ],
      [
        'task-progress',
        'Open the active sync task',
        'The stage, percent, and log are available',
        ['task-progress-fixture'],
        [mock],
      ],
    ],
    changeGlobs: [
      'backend/deployment/**',
      'backend/linker/**',
      'backend/process/**',
      'backend/library/ops.go',
      'backend/spt/**',
      'backend/app_library.go',
      'backend/app_integration_test.go',
      'backend/task_progress/**',
      'src/redesign/library/**',
      'src/redesign/data/library-repository.ts',
      'src/redesign/data/*task*',
      'e2e/playwright/task-center.spec.ts',
    ],
  },
  forge: {
    surfaces: [api, mock],
    contexts: {
      'active-library':
        'A library is active and the registry fixture can answer.',
      'rate-limited': 'The registry returns HTTP 429 with a retry time.',
      addon: 'An add-on detail response lacks full parent information.',
      'later-page': 'The selected version is not on the first API page.',
      'fresh-response':
        'Selected metadata is fresh and download bytes match the declared size.',
      'size-mismatch': 'Downloaded bytes do not match the declared size.',
      'stale-metadata':
        'The network fails and only stale cached metadata remains.',
    },
    journeys: [
      [
        'search-results',
        'Search for a known mod',
        'The matching result is shown',
        ['active-library'],
      ],
      [
        'search-empty',
        'Search for a term with no matches',
        'An empty state is shown',
        ['active-library'],
      ],
      [
        'rate-limit',
        'Retry after a rate-limited request',
        'The client blocks the retry during the wait window',
        ['rate-limited'],
      ],
      [
        'detail',
        'Open a mod or add-on detail',
        'The selected detail returns its fields, including parent data for an add-on',
        ['active-library', 'addon'],
      ],
      [
        'versions',
        'Find a version',
        'The version is available even when it is not on the first API page',
        ['active-library', 'later-page'],
        [api],
      ],
      [
        'download',
        'Download the selected version',
        'Valid bytes reach the importer; on verification failure no generated archive remains',
        ['fresh-response', 'size-mismatch'],
        [disk],
      ],
      [
        'install',
        'Install the selected Forge version',
        'A fresh version appears in the library with Forge identity; stale metadata cannot install',
        ['fresh-response', 'stale-metadata'],
        [api, linux],
      ],
    ],
    changeGlobs: [
      'backend/app_forge.go',
      'backend/forge/**',
      'backend/models/mod.go',
      'backend/library/ops.go',
      'src/redesign/registry/**',
      'src/routes/*registry*',
      'src/redesign/data/registry-*',
      'e2e/playwright/mock-workflows.spec.ts',
    ],
  },
  settings: {
    surfaces: [api, mock],
    contexts: {
      'open-settings':
        'The settings screen is open or its service is available.',
      'after-reload': 'The app saved the setting and reopened its settings.',
      'legacy-config':
        'The existing config uses a legacy schema or legacy values.',
    },
    journeys: [
      [
        'theme',
        'Switch to Dark',
        'Dark is selected',
        ['open-settings', 'after-reload'],
      ],
      [
        'accent',
        'Change the accent color',
        'The selected accent is retained',
        ['after-reload'],
      ],
      [
        'language',
        'Change the locale',
        'The chosen language is used',
        ['after-reload'],
      ],
      [
        'install-on',
        'Turn off enable-on-install and reload',
        'The setting is still off',
        ['after-reload'],
      ],
      [
        'persistence',
        'Save settings and restart',
        'Previously saved values are loaded',
        ['after-reload', 'legacy-config'],
        [api, linux],
      ],
      [
        'migration-warning',
        'Open settings after a startup config migration warning',
        'The app surfaces the warning without silently replacing saved settings',
        ['legacy-config'],
        [linux, mock],
      ],
    ],
    changeGlobs: [
      'backend/app_library.go',
      'backend/app_integration_test.go',
      'backend/config/**',
      'backend/store/**',
      'backend/registry/**',
      'src/redesign/settings/**',
      'src/redesign/data/*settings*',
      'src/redesign/i18n/**',
      'src/routes/*settings*',
      'locales/**',
      'e2e/playwright/mock-workflows.spec.ts',
    ],
  },
  recovery: {
    surfaces: [process, windows],
    contexts: {
      'fresh-temp':
        'The app died after creating a new import temporary tree; no old version exists.',
      'snapshot-fixture':
        'A disk fixture has the old version snapshot, a replacement, and a pending marker.',
      'upgrade-in-flight':
        'The app dies after replacement, before manifest persistence; prepared recovery must restore both the old tree and old manifest entry.',
      'mid-deployment':
        'The app dies after a deployment mutation but before its final state commit.',
      'mid-quarantine':
        'The app dies while moving owned links into purge quarantine.',
      'abandoned-staging':
        'A disk fixture has stale staging and a similarly named user directory.',
    },
    journeys: [
      [
        'crash-import-fresh',
        'Reopen the library after a fresh import was interrupted',
        'Uncommitted files disappear and earlier commits survive',
        ['fresh-temp'],
      ],
      [
        'crash-import-upgrade',
        'Reopen the library after a version replacement was interrupted',
        'The prior content is restored when its pending snapshot exists',
        ['snapshot-fixture', 'upgrade-in-flight'],
        [disk, process, windows],
      ],
      [
        'crash-sync',
        'Reopen and sync after interruption',
        'The manifest and game files converge without losing unrelated files',
        ['mid-deployment'],
      ],
      [
        'crash-purge',
        'Reopen and retry purge after interruption',
        'Owned artifacts are reconciled and external data survives',
        ['mid-quarantine'],
      ],
      [
        'stale-staging',
        'Recover an idle library with abandoned staging',
        'Stale work is cleared without removing user directories',
        ['abandoned-staging'],
        [disk, windows],
      ],
    ],
    exclusions: [
      {
        when: {
          scenario: 'crash-import-upgrade',
          context: 'upgrade-in-flight',
          surface: disk,
        },
        reason: 'A seeded snapshot is not a termination of the import process.',
      },
      {
        when: {
          scenario: 'crash-import-upgrade',
          context: 'snapshot-fixture',
          surface: process,
        },
        reason:
          'The process journey kills a real upgrade after replacement. This seeded snapshot fixture is a separate recovery state, not a process termination.',
      },
      {
        when: {
          scenario: 'crash-import-upgrade',
          context: 'snapshot-fixture',
          surface: windows,
        },
        reason:
          'The Windows gap concerns the real upgrade and restart rather than the disk fixture.',
      },
    ],
    changeGlobs: [
      'backend/recovery/**',
      'backend/app.go',
      'backend/app_integration_test.go',
      'backend/deployment/**',
      'backend/linker/**',
      'backend/library/**',
      'backend/modmanager/**',
      'backend/stager/**',
    ],
  },
  platform: {
    surfaces: [linux, windows],
    contexts: {
      'registered-event':
        'A Wails window is open and the smoke harness can call Go and subscribe to an event.',
      'native-smoke-window':
        'The query-gated native T3 smoke panel is open under Xvfb.',
      'prerequisite-missing':
        'The Windows host lacks the native WebView prerequisite.',
      'clean-windows': 'A clean Windows host has no prior Modkeeper install.',
      'previous-version':
        'Windows has a previous app version and user libraries.',
    },
    journeys: [
      [
        'native-bridge',
        'Open the Wails window and read settings and a registered event',
        'The settings value round-trips and the frontend sees the Go event',
        ['registered-event'],
        ['wails-dev', linux, windows],
      ],
      [
        'native-ui',
        'Use the query-gated native smoke button with the keyboard',
        'The painted window shows the post-interaction status surface',
        ['native-smoke-window'],
        [linux],
      ],
      [
        'webview2',
        'Start Modkeeper without WebView2',
        'Modkeeper gives actionable prerequisite guidance',
        ['prerequisite-missing'],
        [windows],
      ],
      [
        'installer',
        'Install and launch Modkeeper through the installer',
        'The installed app launches and preserves user libraries on upgrade',
        ['clean-windows', 'previous-version'],
        [windows],
      ],
    ],
    changeGlobs: [
      'main.go',
      'native_smoke.go',
      'build/**',
      'scripts/*native*',
      'scripts/*windows*',
      'e2e/*smoke.ts',
      'e2e/cdp-console.ts',
      'e2e/fixtures/**',
      'Taskfile.yml',
      'flake.nix',
      'go.mod',
      'go.sum',
    ],
  },
} satisfies Record<string, Area>
