import { cn } from '@/lib/utils'
import { formatAuthor } from '@/utils/format'
import type { Mod } from '@/wails/contract'
import { HTMLAttributes } from 'react'

export function ModVersion({
  mod,
  className,
  ...rest
}: { mod: Mod } & HTMLAttributes<HTMLDivElement>) {
  if (!mod.manifest) return

  const author = formatAuthor(mod)
  return (
    <div
      className={cn('text-sm text-muted-foreground truncate', className)}
      {...rest}
    >
      {mod.manifest.version && <span>{mod.manifest.version}</span>}
      {mod.manifest.version && author && <span> • </span>}
      {author && <span>{author}</span>}
    </div>
  )
}
