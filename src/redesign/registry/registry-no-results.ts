export type RegistryNoResults =
  | { kind: 'unknown-spt'; query: string }
  | { kind: 'known-spt'; query: string; sptVersion: string }

export function resolveRegistryNoResults(
  query: string,
  sptVersion: string | null | undefined,
): RegistryNoResults {
  const normalizedSptVersion = sptVersion?.trim()
  if (!normalizedSptVersion) return { kind: 'unknown-spt', query }

  return { kind: 'known-spt', query, sptVersion: normalizedSptVersion }
}
