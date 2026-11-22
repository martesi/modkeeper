import type { Mod } from '@/wails/contract'
import { tDivider } from './translation'

export function formatAuthor(mod: Mod) {
  if (!mod.manifest?.author) return
  if (Array.isArray(mod.manifest.author)) {
    return mod.manifest.author.join(tDivider())
  }
  return mod.manifest.author
}
