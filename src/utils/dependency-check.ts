import type { Mod } from '@/wails/contract'
import semver from 'semver'

export enum DependencyStatus {
  Missing,
  Mismatch,
  Satisfied,
}

export interface DependencyResult {
  id: string
  status: DependencyStatus
  requiredVersion: string
  foundVersion?: string
}

export function checkDependencies(
  mod: Mod,
  allMods: Record<string, Mod | undefined>,
): DependencyResult[] {
  const results: DependencyResult[] = []

  if (!mod.manifest?.dependencies) {
    return results
  }

  const dependencies = mod.manifest.dependencies

  if (Array.isArray(dependencies)) {
    // Handle array format
    for (const dep of dependencies) {
      const targetMod = Object.values(allMods).find((m) => m?.id === dep.id)

      if (!targetMod) {
        // Check if optional
        if (dep.optional) continue

        results.push({
          id: dep.id,
          status: DependencyStatus.Missing,
          requiredVersion: dep.version,
        })
        continue
      }

      if (
        !semver.satisfies(targetMod.manifest?.version || '0.0.0', dep.version)
      ) {
        results.push({
          id: dep.id,
          status: DependencyStatus.Mismatch,
          requiredVersion: dep.version,
          foundVersion: targetMod.manifest?.version,
        })
        continue
      }

      results.push({
        id: dep.id,
        status: DependencyStatus.Satisfied,
        requiredVersion: dep.version,
        foundVersion: targetMod.manifest?.version,
      })
    }
  } else if (typeof dependencies === 'object') {
    // Handle object format (legacy or alternative)
    // Based on mod_dto.rs: Object(BTreeMap<String, String>)
    for (const [id, version] of Object.entries(dependencies)) {
      // Here ID is the key
      const targetMod = Object.values(allMods).find((m) => m?.id === id)

      if (!targetMod) {
        results.push({
          id: id,
          status: DependencyStatus.Missing,
          requiredVersion: version as string,
        })
        continue
      }

      if (
        !semver.satisfies(
          targetMod.manifest?.version || '0.0.0',
          version as string,
        )
      ) {
        results.push({
          id: id,
          status: DependencyStatus.Mismatch,
          requiredVersion: version as string,
          foundVersion: targetMod.manifest?.version,
        })
        continue
      }

      results.push({
        id: id,
        status: DependencyStatus.Satisfied,
        requiredVersion: version as string,
        foundVersion: targetMod.manifest?.version,
      })
    }
  }

  return results
}
