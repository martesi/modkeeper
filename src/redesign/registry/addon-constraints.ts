import semver from 'semver'
import type {
  ForgeDetail,
  ForgeKind,
  ForgeSearchItem,
  ModSummary,
} from '@gen/bindings'

function parseRustSemver(version: string): string | null {
  const parsed = semver.parse(version)
  if (!parsed) return null
  const prerelease = parsed.prerelease.length
    ? `-${parsed.prerelease.join('.')}`
    : ''
  const build = parsed.build.length ? `+${parsed.build.join('.')}` : ''
  const canonical = `${parsed.major}.${parsed.minor}.${parsed.patch}${prerelease}${build}`
  return canonical === version ? version : null
}

function normalizeRustVersionReq(constraint: string): string | null {
  const comparators = constraint.split(',').map((part) => part.trim())
  if (comparators.some((part) => part === '')) return null

  const normalized = comparators.map((part) => {
    const match = part.match(/^(\^|~|>=|<=|>|<|=)?\s*(.+)$/)
    if (!match) return ''
    const [, operator = '', version] = match
    if (operator || /[*xX]/.test(version)) return `${operator}${version}`
    // Rust VersionReq treats an omitted operator as a caret requirement.
    // npm semver treats a bare complete version as exact and partials as x-ranges.
    return `^${version}`
  })

  const range = normalized.join(' ')
  return semver.validRange(range) ? range : null
}

export type ParentConstraintStatus =
  | { status: 'standalone' }
  | {
      status: 'satisfied'
      parentName: string
      installedVersion: string
      installedMod: ModSummary
    }
  | {
      status: 'unverified'
      parentName: string
      constraint: string
      reason: 'missing-identity' | 'missing-version' | 'invalid-constraint'
    }
  | {
      status: 'missing'
      parentName: string
      parentModId: number | null
      parentModGuid: string | null
      constraint: string
    }
  | {
      status: 'mismatch'
      parentName: string
      installedVersion: string
      constraint: string
      installedMod: ModSummary
    }

export function getAddonParentInfo(
  addon:
    | ForgeSearchItem
    | ForgeDetail
    | {
        kind: ForgeKind
        isDetached?: boolean | null
        parentModName?: string | null
        parentModId?: number | null
        parentModGuid?: string | null
        modVersionConstraint?: string | null
        parent?: {
          name?: string | null
          guid?: string | null
          id?: number | null
        } | null
      },
): {
  parentName: string
  parentId: number | null
  parentGuid: string | null
  constraint: string
} {
  let parentName = 'Parent Mod'
  let parentId: number | null = null
  let parentGuid: string | null = null

  if ('parent' in addon && addon.parent) {
    if (addon.parent.name) parentName = addon.parent.name
    if (addon.parent.id !== undefined && addon.parent.id !== null)
      parentId = addon.parent.id
    if (addon.parent.guid) parentGuid = addon.parent.guid
  } else if ('parentModName' in addon && addon.parentModName) {
    parentName = addon.parentModName
    parentId = addon.parentModId ?? null
    parentGuid = addon.parentModGuid ?? null
  }

  const constraint = addon.modVersionConstraint ?? '*'
  return { parentName, parentId, parentGuid, constraint }
}

export function evaluateAddonParentConstraint({
  addon,
  installedMods,
}: {
  addon:
    | ForgeSearchItem
    | ForgeDetail
    | {
        kind: ForgeKind
        isDetached?: boolean | null
        parentModName?: string | null
        parentModId?: number | null
        parentModGuid?: string | null
        modVersionConstraint?: string | null
        parent?: {
          name?: string | null
          guid?: string | null
          id?: number | null
        } | null
      }
  installedMods: ModSummary[]
}): ParentConstraintStatus {
  if (addon.kind !== 'addon' || addon.isDetached === true) {
    return { status: 'standalone' }
  }

  const { parentName, parentId, parentGuid, constraint } =
    getAddonParentInfo(addon)
  const matchingName = installedMods.some(
    (mod) => mod.name.trim().toLowerCase() === parentName.trim().toLowerCase(),
  )

  if (parentId === null || !parentGuid || !addon.modVersionConstraint) {
    return {
      status: 'unverified',
      parentName,
      constraint,
      reason: 'missing-identity',
    }
  }

  const found = installedMods.find(
    (mod) =>
      mod.source === 'forge' &&
      mod.forgeKind === 'mod' &&
      mod.forgeId === parentId &&
      mod.forgeGuid === parentGuid,
  )

  if (!found) {
    if (matchingName) {
      return {
        status: 'unverified',
        parentName,
        constraint,
        reason: 'missing-identity',
      }
    }
    return {
      status: 'missing',
      parentName,
      parentModId: parentId,
      parentModGuid: parentGuid,
      constraint,
    }
  }

  const installedVersion = found.version
  if (!installedVersion) {
    return {
      status: 'unverified',
      parentName,
      constraint,
      reason: 'missing-version',
    }
  }

  const validVersion = parseRustSemver(installedVersion)
  const validConstraint = normalizeRustVersionReq(constraint)

  if (!validVersion) {
    return {
      status: 'unverified',
      parentName,
      constraint,
      reason: 'missing-version',
    }
  }

  if (!validConstraint) {
    return {
      status: 'unverified',
      parentName,
      constraint,
      reason: 'invalid-constraint',
    }
  }

  if (!semver.satisfies(validVersion, validConstraint)) {
    return {
      status: 'mismatch',
      parentName,
      installedVersion,
      constraint,
      installedMod: found,
    }
  }

  return {
    status: 'satisfied',
    parentName,
    installedVersion,
    installedMod: found,
  }
}
