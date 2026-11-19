import { useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { useTheme } from 'next-themes'
import { platformKind } from '@/platform'
import { toast } from 'sonner'
import { commands } from '@gen/bindings'
import { themeToIsDark } from '@/utils/theme'
import {
  initWorkspaceEventBus,
  listenWorkspaceEvent,
  loadLibraryWorkspace,
} from '../data/library-repository'
import { applyAccent, applyLanguage } from '../data/settings-repository'
import {
  deriveArchiveOutcome,
  deriveCacheOutcome,
  deriveSyncOutcome,
} from '../data/task-outcome'
import type { TaskOutcome } from '../data/task-outcome'
import { recordTaskHistory } from '../data/task-history'
import { useWindowDropZone } from '../shared/hooks/use-window-drop-zone'
import { setTaskResult } from '../state/library-state'
import { settingsAtom } from '../state/settings-state'
import { libraryText } from '../i18n/library-text'
import type { WorkspaceEvent } from '../data/redesign-types'

/**
 * App-wide startup wiring (consolidated-spec.md §12 "Initializers").
 *
 * Registers the ONE persistent workspace-event subscriber before any fire-and-track op can fire,
 * starts the retryable event connection, and loads the initial workspace independently.
 * The subscriber is the single writer that applies completion events to the workspace atom. A
 * startup config warning rides the first workspace and is toasted once (C12).
 *
 * Settings restore is implicit: the workspace carries `settings` (T1), the repository mirrors it
 * into `settingsAtom`, and `SettingsApplier` below reactively turns every settings value — initial
 * load and later saves alike — into visible effect. One write path, one apply path.
 */
export function RedesignInitializers() {
  // The global supported-archive window drop zone — active whenever a library is active.
  useWindowDropZone()

  useEffect(() => {
    const unsubscribe = listenWorkspaceEvent(handleWorkspaceEvent)
    void initWorkspaceEventBus().then((ready) => {
      if (!ready) toast.warning(libraryText.taskUpdatesUnavailable())
    })
    void loadLibraryWorkspace().then((workspace) => {
      if (workspace?.configWarning) toast.warning(workspace.configWarning)
    })
    return unsubscribe
  }, [])

  return <SettingsApplier />
}

function handleWorkspaceEvent(
  event: WorkspaceEvent,
  submittedPaths?: readonly string[],
): void {
  if (event.type === 'mod_install_completed') {
    publishTaskResult(
      deriveArchiveOutcome(
        event.failures,
        submittedPaths,
        event.taskId,
        event.libraryId,
      ),
    )
    return
  }

  if (event.type === 'sync_completed') {
    publishTaskResult(
      deriveSyncOutcome(event.failures, event.libraryId, event.taskId),
    )
    return
  }

  publishTaskResult(
    deriveCacheOutcome(event.cacheStatus, event.libraryId, event.taskId),
  )
}

function publishTaskResult(outcome: TaskOutcome): void {
  setTaskResult(outcome)
  recordTaskHistory(outcome)
}

/**
 * Applies `settingsAtom` to the world: next-themes (+ the native window effect when a backend is
 * present), the accent CSS variables, and the lingui locale. Renders nothing.
 */
function SettingsApplier() {
  const settings = useAtomValue(settingsAtom)
  const { setTheme, resolvedTheme } = useTheme()

  useEffect(() => {
    if (!settings) return
    setTheme(settings.theme)
    if (platformKind() !== 'browser') {
      void commands
        .applyWindowEffect(themeToIsDark(settings.theme) ?? null)
        .catch((error) =>
          console.warn('[redesign] applyWindowEffect failed', error),
        )
    }
    applyAccent(settings.accentColor, resolvedTheme === 'dark')
    void applyLanguage(settings.language).catch((error) =>
      console.warn('[redesign] locale change failed', error),
    )
  }, [settings, setTheme, resolvedTheme])

  return null
}
