import type { Area } from './model-types'

const api = 'backend-api'
const disk = 'backend-filesystem'
const mock = 'browser-mock'
const linux = 'native-linux'
const windows = 'native-windows'
const apiLinux = [api, linux] as const
const apiMock = [api, mock] as const

export const libraryJourneys = {
  onboarding: {
    surfaces: apiLinux,
    contexts: {
      'first-launch': 'No configuration or registered library exists.',
      'saved-workspace': 'The configuration has an active library.',
      'configured-library':
        'The configuration lists a library but does not open it.',
      'invalid-file': 'The saved TOML cannot be parsed.',
      'saved-pair': 'Two libraries are already registered.',
    },
    journeys: [
      [
        'empty-config',
        'Start without configuration',
        'Default settings load',
        ['first-launch'],
      ],
      [
        'existing-config',
        'Open the app',
        'The saved active workspace and its mods appear',
        ['saved-workspace'],
        ['linux-process', linux, mock],
      ],
      [
        'corrupt-config',
        'Open the app',
        'The parse failure does not overwrite the original file',
        ['invalid-file'],
      ],
      [
        'unsupported-spt',
        'Activate the unsupported SPT library',
        'Activation fails',
        ['configured-library'],
      ],
      [
        'multiple-libraries',
        'Switch between the two libraries',
        'The chosen workspace appears without changing the other library',
        ['saved-pair'],
        [mock, linux],
      ],
    ],
    changeGlobs: [
      'backend/app.go',
      'backend/config/**',
      'backend/store/**',
      'backend/registry/**',
      'backend/spt/**',
      'src/redesign/app/**',
      'src/redesign/data/library-repository.ts',
      'src/redesign/library/*librar*',
      'e2e/playwright/mock-workflows.spec.ts',
    ],
  },
  library: {
    surfaces: apiMock,
    contexts: {
      'first-launch': 'A supported SPT tree exists; no library is registered.',
      'existing-root': 'A valid library already occupies the default root.',
      'active-library': 'A registered library is open.',
      'inactive-library': 'A registered library is not open.',
      'config-write-fails':
        'The registered library exists but the config cannot be saved.',
      'deployed-library':
        'The game tree contains deployments owned by the library.',
      'major-changed':
        'SPT now reports a different major; the old library still exists.',
    },
    journeys: [
      [
        'create-default-root',
        'Add a library without a custom location',
        'The registered library opens and reuses a valid library if present',
        ['first-launch', 'existing-root'],
      ],
      [
        'create-custom-root',
        'Enter a custom library location and create it',
        'The new library opens',
        ['first-launch'],
        [api, 'wails-dev', linux, mock],
      ],
      [
        'create-from-typed-game-root',
        'Type a different game root and create its library',
        'The new library tab shows the name derived from the entered game root',
        ['active-library'],
        [mock],
      ],
      [
        'tool-executable',
        'Type an executable path in the custom tool picker and save it',
        'The library shows the new tool with the supplied executable path',
        ['active-library'],
        [mock],
      ],
      [
        'activate',
        'Select and activate a registered library',
        'It becomes the active library',
        ['inactive-library'],
      ],
      [
        'rename',
        'Rename the selected library',
        'The new name is stored without switching libraries',
        ['active-library', 'inactive-library'],
      ],
      [
        'delete-keep-files',
        'Remove its entry but keep its files',
        'The library files remain',
        ['active-library'],
        apiLinux,
      ],
      [
        'delete-files',
        'Remove the entry and its files',
        'On success the root is removed; on save failure the entry and files remain',
        ['active-library', 'inactive-library', 'config-write-fails'],
        [api, disk],
      ],
      [
        'delete-deployed',
        'Remove a deployed library and its files',
        'Owned artifacts are removed and unrelated game files survive',
        ['deployed-library'],
        [disk, linux, windows],
      ],
      [
        'cross-major',
        'Add the updated SPT root again',
        'A major-specific library opens and the old library root remains',
        ['major-changed'],
        [api, linux, windows],
      ],
    ],
    exclusions: [
      {
        when: {
          scenario: 'create-default-root',
          context: 'existing-root',
          surface: mock,
        },
        reason: 'Only a real filesystem can rediscover an existing root.',
      },
      {
        when: {
          scenario: 'delete-files',
          context: 'config-write-fails',
          surface: api,
        },
        reason:
          'The config-write fault is tested with a real filesystem fixture.',
      },
    ],
    changeGlobs: [
      'backend/app_library.go',
      'backend/app_integration_test.go',
      'backend/library/**',
      'backend/models/library.go',
      'backend/models/workspace.go',
      'backend/store/**',
      'backend/registry/**',
      'backend/security/**',
      'backend/spt/**',
      'src/redesign/library/**',
      'src/redesign/shared/utils/path-input*',
      'src/redesign/data/library-repository.ts',
      'src/redesign/data/tools-repository.ts',
      'e2e/playwright/mock-workflows.spec.ts',
    ],
  },
  import: {
    surfaces: apiMock,
    contexts: {
      'empty-library': 'The active library has no installed mods.',
      'populated-library': 'The active library already has other mods.',
      'existing-mod': 'The active library has an older mod with the same ID.',
      'new-batch':
        'There are 25 valid new archives and no old versions in the batch.',
      'switch-during-install':
        'Two libraries exist and an import task in the first library is running.',
      'partly-committed-batch':
        'Some members of the current batch have committed, and a later archive is in flight.',
      'unwritable-library':
        'The active repository cannot write a staged import.',
    },
    journeys: [
      [
        'one-archive',
        'Import a valid archive',
        'A mod row appears',
        ['empty-library', 'populated-library'],
        [api, linux, mock],
      ],
      [
        'switch-library-during-install',
        'Switch to another library while the first library imports an archive',
        'The task result and files stay associated with the originating library',
        ['switch-during-install'],
        [disk],
      ],
      [
        'typed-paths',
        'Type multiple supported archive paths and submit them',
        'The install command receives the exact archive paths and a new mock mod row appears',
        ['populated-library'],
        [mock],
      ],
      [
        'many-25',
        'Import 25 valid archives in one task',
        'All 25 mods appear',
        ['empty-library', 'populated-library'],
        [api, 'linux-process', linux],
      ],
      [
        'mixed-valid-invalid',
        'Import a valid archive and a malformed archive together',
        'The valid mod appears and the invalid path has its own failure',
        ['empty-library', 'populated-library'],
        apiLinux,
      ],
      [
        'duplicate-mod-id',
        'Submit two archives with the same new mod ID in one batch',
        'Only one mod with that ID remains and the task reports the result',
        ['empty-library', 'populated-library'],
        [api],
      ],
      [
        'upgrade-same-id',
        'Reimport a newer archive for the same mod ID',
        'One row remains, its files are updated, and no snapshot is left',
        ['existing-mod'],
        apiLinux,
      ],
      [
        'install-on-true',
        'Import a new mod with enable-on-install on',
        'The new mod is enabled',
        ['empty-library', 'populated-library'],
      ],
      [
        'install-on-false',
        'Import a new mod with enable-on-install off',
        'The new mod is disabled',
        ['empty-library', 'populated-library'],
      ],
      [
        'cancel-mid-batch',
        'Cancel once some members of the batch have committed',
        'The task reports cancellation, keeps committed mods, and can import again',
        ['new-batch'],
        [disk, 'linux-process', linux, mock],
      ],
      [
        'kill-mid-batch',
        'Terminate the app during a partly committed batch, then reopen',
        'Only committed members of the interrupted batch remain and a later import succeeds',
        ['partly-committed-batch'],
        ['linux-process', windows],
      ],
      [
        'kill-fresh-import',
        'Terminate the app during a new single-archive import, then reopen',
        'Earlier batches remain, temporary files are cleared, and a later import succeeds',
        ['populated-library'],
        ['linux-process', windows],
      ],
      [
        'permission-error',
        'Import into a library that cannot write staging',
        'An error identifies the rejected archive and existing data survives',
        ['unwritable-library'],
        [disk, linux, windows],
      ],
      [
        'unsupported-compression',
        'Import an unsupported archive format',
        'The archive is rejected without adding a mod or changing existing files',
        ['empty-library', 'populated-library'],
        [api],
      ],
    ],
    changeGlobs: [
      'backend/app.go',
      'backend/app_integration_test.go',
      'backend/app_library.go',
      'backend/library/library.go',
      'backend/library/library_test.go',
      'backend/library/ops.go',
      'backend/archive/**',
      'backend/modmanager/**',
      'backend/modfs/**',
      'backend/stager/**',
      'backend/task_progress/**',
      'backend/models/task_progress.go',
      'backend/models/mod.go',
      'src/redesign/library/**',
      'src/redesign/shared/utils/path-input*',
      'src/redesign/data/library-repository.ts',
      'src/redesign/data/*task*',
      'e2e/playwright/*import*',
      'e2e/playwright/mock-workflows.spec.ts',
      'e2e/playwright/task-center.spec.ts',
    ],
  },
  mod: {
    surfaces: apiMock,
    contexts: {
      'single-mod': 'The active library has one mod eligible for the action.',
      selection: 'The active library has several selectable mods.',
      'deployed-mod': 'The affected mod has already been deployed.',
      'mismatched-folder':
        'A mod directory name disagrees with its manifest ID.',
      'empty-library': 'The active library has no mods.',
    },
    journeys: [
      ['enable', 'Turn on one mod', 'Its row becomes enabled', ['single-mod']],
      [
        'disable',
        'Turn off one mod',
        'Its row becomes disabled',
        ['single-mod', 'deployed-mod'],
      ],
      [
        'bulk-enable',
        'Enable selected mods',
        'The enabled state updates without deploying',
        ['single-mod', 'selection'],
      ],
      [
        'bulk-disable',
        'Disable selected mods',
        'The enabled state clears',
        ['single-mod', 'selection'],
      ],
      [
        'bulk-delete',
        'Remove selected mods',
        'The selected mods leave the workspace',
        ['single-mod', 'selection', 'deployed-mod'],
      ],
      [
        'rebuild-cache',
        'Rebuild the active library cache',
        'The task reports progress and completion',
        ['empty-library', 'selection'],
      ],
      [
        'folder-rename',
        'Normalize folders while rebuilding the cache',
        'The folder moves to the manifest ID and the old path is gone',
        ['mismatched-folder'],
        [disk, linux],
      ],
    ],
    exclusions: [
      {
        when: { context: 'deployed-mod', surface: mock },
        reason: 'The mock does not model files deployed to the game tree.',
      },
    ],
    changeGlobs: [
      'backend/app_library.go',
      'backend/app_integration_test.go',
      'backend/library/**',
      'backend/modmanager/**',
      'backend/modfs/**',
      'backend/models/mod.go',
      'backend/security/**',
      'src/redesign/library/**',
      'src/redesign/data/library-repository.ts',
      'e2e/playwright/mock-workflows.spec.ts',
    ],
  },
} satisfies Record<string, Area>
