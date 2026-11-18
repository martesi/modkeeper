import { useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { FidelityPanel } from '../shared/components/fidelity-panel'
import { FidelityCheckbox } from '../shared/components/fidelity-checkbox'
import { FidelitySwitch } from '../shared/components/fidelity-switch'
import { ModInitialIcon } from './mod-initial-icon'
import { libraryBusyAtom, selectedModIdsAtom } from '../state/library-state'
import { toggleModStatus } from '../data/library-repository'
import { libraryText } from '../i18n/library-text'
import type { ModSummary } from '../data/redesign-types'

/**
 * Mod card: selection checkbox, type tile, truncated title, and enable/disable switch.
 *
 * The toggle is the PLAIN repository shape with LOCAL per-click pending — set on click, cleared
 * when the promise settles — so it gives instant feedback even queued behind a heavy op. The card
 * is also disabled while the library is busy (a fire-and-track op in flight), the consumer side of
 * the "library busy" contract. Toggling never deploys — it sets `deployStale` (C3).
 */
export function ModTitleCard({ mod }: { mod: ModSummary }) {
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

  return (
    <FidelityPanel
      radius="card"
      className="flex h-14 items-center gap-2 px-2 transition-colors"
    >
      <FidelityCheckbox
        checked={selected}
        onCheckedChange={handleSelect}
        aria-label={libraryText.selectMod(mod.name)}
      />
      <ModInitialIcon name={mod.name} type={mod.type} enabled={mod.isEnabled} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px] font-semibold',
          mod.isEnabled ? 'text-foreground' : 'text-muted-foreground',
        )}
        title={mod.name}
      >
        {mod.name}
      </span>
      <FidelitySwitch
        checked={mod.isEnabled}
        disabled={disabled}
        busy={pending}
        aria-label={libraryText.enableMod(mod.name)}
        onCheckedChange={() => void handleToggle()}
      />
    </FidelityPanel>
  )
}
