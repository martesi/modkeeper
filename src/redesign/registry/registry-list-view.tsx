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
  ParentStatusBadge,
} from './registry-item-badges'

export function RegistryListView({
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
    <div
      role="table"
      aria-label={registryText.title()}
      className="flex min-w-[420px] flex-1 flex-col divide-y divide-border rounded-md border border-border bg-card/40"
    >
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
            role="row"
            tabIndex={0}
            onClick={() => selectItem({ kind: item.kind, id: item.id })}
            onKeyDown={(event) =>
              handleRegistryItemKeyDown(event, () =>
                selectItem({ kind: item.kind, id: item.id }),
              )
            }
            aria-selected={isSelected}
            className={`group flex h-9 shrink-0 cursor-pointer items-center gap-2 px-2 transition-colors outline-none focus-visible:bg-muted/70 hover:bg-muted/50 ${
              isSelected ? 'bg-muted/70 ring-1 ring-primary/40' : ''
            }`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <RegistryThumbnail
                name={item.name}
                thumbnail={item.thumbnail}
                kind={item.kind}
                size="sm"
              />
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <h3
                    className="min-w-0 truncate text-[13px] font-semibold leading-4 text-foreground"
                    title={
                      item.teaser ? `${item.name} — ${item.teaser}` : item.name
                    }
                  >
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

                <div className="flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-muted-foreground">
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
                    <span className="min-w-0 truncate">{item.teaser}</span>
                  ) : null}
                  <SptCompatIndicator
                    isCompatible={item.kind === 'mod'}
                    sptVersion={activeLibrary?.sptVersion ?? undefined}
                  />
                  {item.kind === 'addon' && (
                    <span className="min-w-0 truncate">
                      <ParentStatusBadge status={parentStatus} />
                    </span>
                  )}
                </div>
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
        )
      })}
    </div>
  )
}
