import { useAtomValue, useSetAtom } from 'jotai'
import type { ForgeSearchItem } from '@/wails/contract'
import {
  selectedRegistryItemAtom,
  registrySearchAtom,
  type SelectedRegistryItem,
} from '../state/registry-state'
import { activeLibraryAtom, modListAtom } from '../state/library-state'
import { evaluateAddonParentConstraint } from '../data/registry-repository'
import { registryText } from '../i18n/registry-text'
import { handleRegistryItemKeyDown } from './registry-item-keyboard'
import { RegistryThumbnail } from './registry-thumbnail'
import {
  AddonBadge,
  FikaBadge,
  ModBadge,
  ParentLinkBadge,
  StandaloneBadge,
} from './registry-item-badges'

export function RegistryIconsView({
  items,
  selectedItem,
}: {
  items: ForgeSearchItem[]
  selectedItem?: SelectedRegistryItem | null
}) {
  const selectItem = useSetAtom(selectedRegistryItemAtom)
  const setSearch = useSetAtom(registrySearchAtom)
  const installedMods = useAtomValue(modListAtom)
  const activeLibrary = useAtomValue(activeLibraryAtom)

  return (
    <div className="flex flex-1 flex-wrap gap-3">
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
            title={item.name}
            className={`group relative flex h-[142px] w-[142px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card/50 p-2 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-border-strong hover:bg-card ${
              isSelected ? 'ring-2 ring-primary/50' : ''
            }`}
          >
            <div className="absolute right-2 top-2 flex items-center gap-1">
              <span
                className={`size-2 rounded-full ${item.kind === 'mod' ? 'bg-primary' : 'bg-muted-foreground'}`}
                title={
                  item.kind === 'addon'
                    ? registryText.statusSptUntested()
                    : activeLibrary?.sptVersion
                      ? registryText.statusSptCompatible(
                          activeLibrary.sptVersion,
                        )
                      : registryText.statusSptUnknown()
                }
                aria-label={
                  item.kind === 'addon'
                    ? registryText.statusSptUntested()
                    : activeLibrary?.sptVersion
                      ? registryText.statusSptCompatible(
                          activeLibrary.sptVersion,
                        )
                      : registryText.statusSptUnknown()
                }
              />
              {hasParentBlock && (
                <span
                  className="size-2 rounded-full bg-[var(--muted-foreground)]"
                  title={registryText.iconsParentRequired()}
                  aria-label={registryText.iconsParentRequired()}
                />
              )}
            </div>

            <RegistryThumbnail
              name={item.name}
              thumbnail={item.thumbnail}
              kind={item.kind}
              size="grid"
            />

            <h3 className="line-clamp-2 text-xs font-medium leading-4 text-foreground">
              {item.name}
            </h3>

            <div className="flex flex-wrap justify-center gap-1">
              {item.kind === 'mod' ? (
                <ModBadge />
              ) : item.isDetached ? (
                <StandaloneBadge />
              ) : (
                <AddonBadge />
              )}
              {item.fikaCompatibility && <FikaBadge />}
            </div>

            {item.kind === 'addon' && item.parentModName && (
              <div className="w-full max-w-full">
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
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
