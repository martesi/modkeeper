import semver from 'semver'
import type { ForgeVersionsPage } from '@/wails/contract'

type ForgeVersion = ForgeVersionsPage['versions'][number]

export function isForgeVersionIncompatible(
  version: ForgeVersion,
  activeSptVersion: string | null | undefined,
): boolean {
  const active = activeSptVersion ? semver.coerce(activeSptVersion) : null
  const constraint = version.sptVersionConstraint ?? ''
  return Boolean(
    active &&
    constraint &&
    semver.validRange(constraint) &&
    !semver.satisfies(active, constraint),
  )
}

export function filterForgeVersions(
  versions: readonly ForgeVersion[],
  activeSptVersion: string | null | undefined,
  compatibleOnly: boolean,
): ForgeVersion[] {
  if (!compatibleOnly) return [...versions]
  return versions.filter(
    (version) => !isForgeVersionIncompatible(version, activeSptVersion),
  )
}

export function shouldWarnForIncompatibleForgeVersion(
  incompatible: boolean,
  warningEnabled: boolean,
): boolean {
  return incompatible && warningEnabled
}
