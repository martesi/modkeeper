import { RefreshCw, WifiOff } from 'lucide-react'
import { FidelityButton } from '../shared/components/fidelity-button'
import { registryText } from '../i18n/registry-text'

export function RegistryOfflineEmptyState({
  onRetry,
  isRetrying = false,
}: {
  onRetry: () => void
  isRetrying?: boolean
}) {
  return (
    <div
      role="region"
      aria-label={registryText.emptyOfflineTitle()}
      className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <WifiOff className="size-8 text-muted-foreground" aria-hidden />
      <div className="max-w-md space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          {registryText.emptyOfflineTitle()}
        </h2>
        <p className="text-xs text-muted-foreground">
          {registryText.emptyOfflineDescription()}
        </p>
      </div>
      <FidelityButton
        variant="outline"
        size="sm"
        disabled={isRetrying}
        onClick={onRetry}
        className="mt-2 gap-2 text-xs"
      >
        <RefreshCw
          className={`size-3.5 ${isRetrying ? 'animate-spin' : ''}`}
          aria-hidden
        />
        <span>{registryText.retryConnection()}</span>
      </FidelityButton>
    </div>
  )
}
