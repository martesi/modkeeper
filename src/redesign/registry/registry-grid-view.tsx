import { useAtomValue, useSetAtom } from 'jotai'
import { AlertTriangle, Download } from 'lucide-react'
import type { ForgeSearchItem } from '@/wails/contract'
import {
  selectedRegistryItemAtom,
  registrySearchAtom,
  type SelectedRegistryItem,
} from '../state/registry-state'
import { modListAtom, activeLibraryAtom } from '../state/library-state'
import { evaluateAddonParentConstraint } from '../data/registry-repository'
import { registryText } from '../i18n/registry-text'
import { LibraryActionIconButton } from '../library/library-action-icon-button'
import { handleRegistryItemKeyDown } from './registry-item-keyboard'
import { RegistryThumbnail } from './registry-thumbnail'
import {
  ModBadge,
  AddonBadge,
  StandaloneBadge,
  FikaBadge,
  ParentLinkBadge,
  SptCompatIndicator,
} from './registry-item-badges'

export function RegistryGridView({
  items,
  selectedItem,
  onOpenParentHelp,
}: {
  items: ForgeSearchItem[]
  selectedItem?: SelectedRegistryItem | null
  onOpenParentHelp: (addon: ForgeSearchItem) => void
}) {
  const selectItem = useSetAtom(selectedRegistryItemAtom)
  const setSearch = useSetAtom(registrySearchAtom)
  const installedMods = useAtomValue(modListAtom)
  const activeLibrary = useAtomValue(activeLibraryAtom)

  return (
    <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
      {items.map((item) => {
        const isSelected =
          selectedItem?.kind === item.kind && selectedItem.id === item.id
        const parentStatus = evaluateAddonParentConstraint({
          addon: item,
          installedMods,
        })
        const hasParentBlock =
          parentStatus.status === 'missing' ||
          parentStatus.status === 'mismatch' ||
          parentStatus.status === 'unverified'

        return (
          <div
            key={`${item.kind}-${item.id}`}
            role="button"
            tabIndex={0}
            onClick={() => selectItem({ kind: item.kind, id: item.id })}
            onKeyDown={(event) =>
              handleRegistryItemKeyDown(event, () =>
                selectItem({ kind: item.kind, id: item.id }),
              )
            }
            title={item.teaser ? `${item.name} — ${item.teaser}` : item.name}
            className={`group flex h-[70px] min-w-0 flex-col justify-center gap-1 rounded-lg border border-border bg-card/60 px-2.5 py-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-border-strong hover:bg-card ${
              isSelected ? 'ring-2 ring-primary/50' : ''
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <RegistryThumbnail
                name={item.name}
                thumbnail={item.thumbnail}
                kind={item.kind}
                size="md"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1">
                  <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-4 text-foreground">
                    {item.name}
                  </h3>
                  {item.kind === 'mod' ? (
                    <ModBadge />
                  ) : item.isDetached ? (
                    <StandaloneBadge />
                  ) : (
                    <AddonBadge />
                  )}
                  {item.fikaCompatibility && <FikaBadge />}
                </div>
                <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                  <div className="min-w-0 flex-1">
                    {item.kind === 'addon' && item.parentModName ? (
                      <ParentLinkBadge
                        parentName={item.parentModName}
                        onClick={() => {
                          if (item.parentModId) {
                            selectItem({ kind: 'mod', id: item.parentModId })
                          } else {
                            setSearch(item.parentModName ?? '')
                          }
                        }}
                      />
                    ) : item.teaser ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {item.teaser}
                      </span>
                    ) : null}
                  </div>
                  <SptCompatIndicator
                    compact
                    isCompatible={item.kind === 'mod'}
                    sptVersion={activeLibrary?.sptVersion ?? undefined}
                  />
                </div>
              </div>
              <span onClick={(event) => event.stopPropagation()}>
                <LibraryActionIconButton
                  icon={hasParentBlock ? AlertTriangle : Download}
                  label={
                    hasParentBlock
                      ? registryText.actionRequiresMod()
                      : registryText.actionInstall()
                  }
                  tooltip={
                    hasParentBlock
                      ? registryText.actionRequiresMod()
                      : registryText.actionInstall()
                  }
                  onClick={() => {
                    if (hasParentBlock) onOpenParentHelp(item)
                    else selectItem({ kind: item.kind, id: item.id })
                  }}
                  className="size-7 shrink-0"
                />
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
