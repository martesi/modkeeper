import { Compass } from 'lucide-react'
import { FidelityButton } from '../shared/components/fidelity-button'
import { registryText } from '../i18n/registry-text'

export function RegistryNoLibraryEmptyState({
  onManageLibraries,
}: {
  onManageLibraries: () => void
}) {
  return (
    <div
      role="region"
      aria-label={registryText.emptyNoLibraryTitle()}
      className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
        <Compass className="size-8" aria-hidden />
      </div>
      <div className="max-w-md space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          {registryText.emptyNoLibraryTitle()}
        </h2>
        <p className="text-xs text-muted-foreground">
          {registryText.emptyNoLibraryDescription()}
        </p>
      </div>
      <FidelityButton
        variant="primary"
        size="sm"
        onClick={onManageLibraries}
        className="mt-2 text-xs"
      >
        {registryText.manageLibrary()}
      </FidelityButton>
    </div>
  )
}
