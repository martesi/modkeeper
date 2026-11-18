import {
  Check,
  AlertTriangle,
  CircleHelp,
  XCircle,
  ExternalLink,
} from 'lucide-react'
import { registryText } from '../i18n/registry-text'
import type { ParentConstraintStatus } from '../data/registry-repository'

export function ModBadge() {
  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[11px] leading-3 font-medium text-muted-foreground">
      {registryText.badgeMod()}
    </span>
  )
}

const accentBadge =
  'inline-flex shrink-0 items-center whitespace-nowrap rounded border border-[color-mix(in_srgb,var(--primary)_24%,transparent)] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] px-1.5 py-0.5 text-[11px] leading-3 font-medium text-[var(--primary)]'

export function AddonBadge() {
  return <span className={accentBadge}>{registryText.badgeAddon()}</span>
}

export function StandaloneBadge() {
  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] leading-3 font-medium text-muted-foreground">
      {registryText.badgeStandalone()}
    </span>
  )
}

export function FikaBadge() {
  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded border border-[color-mix(in_srgb,var(--primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-1.5 py-0.5 text-[11px] leading-3 font-medium text-[var(--primary)]">
      {registryText.badgeFika()}
    </span>
  )
}

export function ParentLinkBadge({
  parentName,
  onClick,
}: {
  parentName: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={registryText.badgeExtends(parentName)}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className="inline-flex min-w-0 max-w-full items-center gap-1 truncate whitespace-nowrap rounded border border-[color-mix(in_srgb,var(--primary)_24%,transparent)] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] px-1.5 py-0.5 text-[11px] leading-3 font-medium text-[var(--primary)] transition-colors hover:brightness-110"
      title={registryText.badgeExtends(parentName)}
    >
      <span className="min-w-0 truncate">
        {registryText.badgeExtends(parentName)}
      </span>
      <ExternalLink className="size-2.5 shrink-0 opacity-70" aria-hidden />
    </button>
  )
}

export function SptCompatIndicator({
  isCompatible,
  sptVersion,
  compact = false,
}: {
  isCompatible: boolean
  sptVersion?: string
  compact?: boolean
}) {
  if (compact) {
    const label = isCompatible
      ? sptVersion
        ? registryText.statusSptCompatible(sptVersion)
        : registryText.statusSptUnknown()
      : registryText.statusSptUntested()
    const color = isCompatible
      ? 'bg-[var(--primary)]'
      : 'bg-[var(--muted-foreground)]'

    return (
      <span
        className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full ${color}`}
        title={label}
        aria-label={label}
      >
        <span className="size-1 rounded-full bg-background" aria-hidden />
      </span>
    )
  }

  if (isCompatible) {
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] leading-3 font-medium text-[var(--primary)]"
        title={
          sptVersion
            ? registryText.statusSptCompatible(sptVersion)
            : registryText.statusSptUnknown()
        }
      >
        <span
          className="size-1.5 rounded-full bg-[var(--primary)]"
          aria-hidden
        />
        <span>
          {sptVersion ? `SPT ${sptVersion}` : registryText.statusSptUnknown()}
        </span>
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] leading-3 font-medium text-[var(--muted-foreground)]"
      title={registryText.statusSptUntested()}
    >
      <span
        className="size-1.5 rounded-full bg-[var(--muted-foreground)]"
        aria-hidden
      />
      <span>{registryText.statusSptUntested()}</span>
    </span>
  )
}

export function ParentStatusBadge({
  status,
}: {
  status: ParentConstraintStatus
}) {
  if (status.status === 'standalone') {
    return null
  }

  if (status.status === 'satisfied') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] leading-3 font-medium text-[var(--primary)]">
        <Check className="size-3 shrink-0" aria-hidden />
        <span>
          {registryText.statusParentInstalled(status.installedVersion)}
        </span>
      </span>
    )
  }

  if (status.status === 'missing') {
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] leading-3 font-medium text-[var(--muted-foreground)]"
        title={registryText.statusParentMissing(status.parentName)}
      >
        <AlertTriangle className="size-3 shrink-0" aria-hidden />
        <span className="truncate">
          {registryText.statusParentMissing(status.parentName)}
        </span>
      </span>
    )
  }

  if (status.status === 'unverified') {
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] leading-3 font-medium text-[var(--muted-foreground)]"
        title={registryText.statusParentUnverified(status.parentName)}
      >
        <CircleHelp className="size-3 shrink-0" aria-hidden />
        <span className="truncate">
          {registryText.statusParentUnverified(status.parentName)}
        </span>
      </span>
    )
  }

  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] leading-3 font-medium text-destructive"
      title={registryText.statusParentMismatch(
        status.parentName,
        status.constraint,
        status.installedVersion,
      )}
    >
      <XCircle className="size-3 shrink-0" aria-hidden />
      <span className="truncate">
        {registryText.statusParentMismatch(
          status.parentName,
          status.constraint,
          status.installedVersion,
        )}
      </span>
    </span>
  )
}
