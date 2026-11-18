import { LibraryEmptyCard } from './library-empty-card'
import { FidelityButton } from '../shared/components/fidelity-button'
import { libraryText } from '../i18n/library-text'

/**
 * No-active-library state (reference Modkeeper.dc.html "Activate a library" card): dashed card
 * whose action opens the Manage Library dialog. No toolbar renders in this state.
 */
export function LibraryActivateEmptyState({
  onManageLibraries,
}: {
  onManageLibraries: () => void
}) {
  return (
    <LibraryEmptyCard>
      <p className="font-heading text-[13px] font-semibold text-muted-foreground">
        {libraryText.emptyActivateTitle()}
      </p>
      <p className="max-w-md text-[13px] text-muted-foreground">
        {libraryText.emptyActivateBody()}
      </p>
      <FidelityButton className="mt-1.5" onClick={onManageLibraries}>
        {libraryText.manageLibraries()}
      </FidelityButton>
    </LibraryEmptyCard>
  )
}
