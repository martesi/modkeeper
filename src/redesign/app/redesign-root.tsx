import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import '../styles/fidelity.css'
import { RedesignErrorBoundary } from './redesign-error-boundary'
import { RedesignInitializers } from './redesign-initializers'
import { DesktopShell } from '../shell/desktop-shell'
import { FidelityButton } from '../shared/components/fidelity-button'
import { loadLibraryWorkspace } from '../data/library-repository'
import { libraryText } from '../i18n/library-text'
import { commonText } from '../i18n/common-text'
import { workspaceStatusAtom } from '../state/library-state'

/**
 * Root of the redesign tree (consolidated-spec.md §8.3).
 *
 * Pulls in the fidelity design tokens, catches render crashes at the top (§13), mounts startup
 * wiring, and frames the routed content in the shell. Mounted by the `__root.tsx` route adapter
 * with the router's Outlet as children.
 */
export function RedesignRoot({ children }: { children: ReactNode }) {
  return (
    <RedesignErrorBoundary>
      <RedesignInitializers />
      <DesktopShell>
        <WorkspaceReadinessGate>{children}</WorkspaceReadinessGate>
      </DesktopShell>
    </RedesignErrorBoundary>
  )
}

function WorkspaceReadinessGate({ children }: { children: ReactNode }) {
  const status = useAtomValue(workspaceStatusAtom)

  if (status === 'loading') {
    return <p role="status">{libraryText.workspaceLoading()}</p>
  }

  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 py-4">
        <p>{libraryText.workspaceLoadFailed()}</p>
        <FidelityButton onClick={() => void loadLibraryWorkspace()}>
          {commonText.retry()}
        </FidelityButton>
      </div>
    )
  }

  return children
}
