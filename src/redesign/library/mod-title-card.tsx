import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAtom, useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { FidelityPanel } from '../shared/components/fidelity-panel'
import { FidelityCheckbox } from '../shared/components/fidelity-checkbox'
import { FidelitySwitch } from '../shared/components/fidelity-switch'
import { ModInitialIcon } from './mod-initial-icon'
import {
  libraryBusyAtom,
  selectedModIdsAtom,
  type LibraryViewMode,
} from '../state/library-state'
import { toggleModStatus } from '../data/library-repository'
import { libraryText } from '../i18n/library-text'
import type { ModSummary } from '../data/redesign-types'

/** A mod row or card, with selection and toggle state shared across presentations. */
export function ModTitleCard({
  mod,
  viewMode = 'grid',
}: {
  mod: ModSummary
  viewMode?: LibraryViewMode
}) {
  const [pending, setPending] = useState(false)
  const libraryBusy = useAtomValue(libraryBusyAtom)
  const [selectedIds, setSelectedIds] = useAtom(selectedModIdsAtom)
  const selected = selectedIds.has(mod.id)
  const disabled = pending || libraryBusy

  async function handleToggle() {
    setPending(true)
    try {
      await toggleModStatus({
        libraryId: mod.libraryId,
        modId: mod.id,
        enabled: !mod.isEnabled,
      })
    } finally {
      setPending(false)
    }
  }

  function handleSelect(checked: boolean) {
    const next = new Set(selectedIds)
    if (checked) next.add(mod.id)
    else next.delete(mod.id)
    setSelectedIds(next)
  }

  const selection = (
    <FidelityCheckbox
      checked={selected}
      onCheckedChange={handleSelect}
      aria-label={libraryText.selectMod(mod.name)}
    />
  )
  const statusToggle = (
    <div className="flex items-center gap-1.5">
      <span
        className="flex size-4 shrink-0 items-center justify-center"
        aria-hidden
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
      </span>
      <FidelitySwitch
        checked={mod.isEnabled}
        disabled={disabled}
        busy={pending}
        aria-label={
          mod.isEnabled
            ? libraryText.disableMod(mod.name)
            : libraryText.enableMod(mod.name)
        }
        onCheckedChange={() => void handleToggle()}
      />
    </div>
  )

  if (viewMode === 'list') {
    return (
      <tr className="h-9 text-[13px]">
        <td className="border-y border-border bg-card py-1 align-middle pl-2 first:border-l first:rounded-l-md">
          {selection}
        </td>
        <td className="border-y border-border bg-card px-2 py-1 align-middle">
          <div className="flex min-w-0 items-center gap-2">
            <ModInitialIcon
              name={mod.name}
              type={mod.type}
              enabled={mod.isEnabled}
              size="sm"
            />
            <span className="min-w-0 truncate font-semibold" title={mod.name}>
              {mod.name}
            </span>
          </div>
        </td>
        <td className="border-y border-border bg-card px-2 py-1 align-middle whitespace-nowrap text-muted-foreground">
          {typeLabel(mod.type)}
        </td>
        <td className="border-y border-border bg-card px-2 py-1 align-middle last:border-r last:rounded-r-md">
          {statusToggle}
        </td>
      </tr>
    )
  }

  if (viewMode === 'icons') {
    return (
      <FidelityPanel
        radius="card"
        className="relative flex h-[142px] w-[142px] flex-col items-center justify-center gap-1 px-2 pt-7"
      >
        <div className="absolute left-2 top-2">{selection}</div>
        <div className="absolute right-2 top-2">{statusToggle}</div>
        <ModInitialIcon
          name={mod.name}
          type={mod.type}
          enabled={mod.isEnabled}
          size="icons"
        />
        <span
          className={cn(
            'line-clamp-2 w-full text-center text-[12px] font-semibold leading-4',
            mod.isEnabled ? 'text-foreground' : 'text-muted-foreground',
          )}
          title={mod.name}
        >
          {mod.name}
        </span>
      </FidelityPanel>
    )
  }

  return (
    <FidelityPanel
      radius="card"
      className="flex h-[70px] min-w-0 items-center gap-3 px-3 transition-colors"
    >
      {selection}
      <ModInitialIcon
        name={mod.name}
        type={mod.type}
        enabled={mod.isEnabled}
        size="grid"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-[13px] font-semibold',
            mod.isEnabled ? 'text-foreground' : 'text-muted-foreground',
          )}
          title={mod.name}
        >
          {mod.name}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {typeLabel(mod.type)}
        </span>
      </div>
      {statusToggle}
    </FidelityPanel>
  )
}

function typeLabel(type: ModSummary['type']): string {
  if (type === 'client') return libraryText.modTypeClient()
  if (type === 'server') return libraryText.modTypeServer()
  if (type === 'both') return libraryText.modTypeBoth()
  return libraryText.modTypeUnknown()
}
