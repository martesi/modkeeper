import { useState } from 'react'
import { ModInitialIcon } from '../library/mod-initial-icon'
import type { ForgeKind } from '@gen/bindings'

export function RegistryThumbnail({
  name,
  thumbnail,
  kind,
  size = 'md',
}: {
  name: string
  thumbnail?: string | null
  kind: ForgeKind
  size?: 'sm' | 'md' | 'grid' | 'icons'
}) {
  const [hasError, setHasError] = useState(false)

  const sizeClass = {
    sm: 'size-6 rounded-xs',
    md: 'size-8 rounded-sm',
    grid: 'size-12 rounded-sm',
    icons: 'size-16 rounded-md',
  }[size]

  if (thumbnail && !hasError) {
    return (
      <img
        src={thumbnail}
        alt=""
        loading="lazy"
        className={`shrink-0 object-cover ${sizeClass}`}
        onError={() => setHasError(true)}
      />
    )
  }

  return (
    <ModInitialIcon
      name={name}
      type={kind === 'addon' ? 'server' : 'both'}
      size={size}
    />
  )
}
