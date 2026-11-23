import { useAtom, useAtomValue } from 'jotai'
import { ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FidelityPanel } from '../shared/components/fidelity-panel'
import { FidelityButton } from '../shared/components/fidelity-button'
import { FidelityInput } from '../shared/components/fidelity-input'
import { LibraryActionIconButton } from '../library/library-action-icon-button'
import { RegistryViewModeSelector } from './registry-view-mode-selector'
import {
  registryAddonPageAtom,
  registryKindFilterAtom,
  registryModPageAtom,
  registrySearchAtom,
  registrySortAtom,
  type RegistryKindFilter,
  type RegistrySort,
} from '../state/registry-state'
import { registryText } from '../i18n/registry-text'
import { activeLibraryAtom } from '../state/library-state'

type RegistryToolbarProps = {
  totalItems: number
  modPage: number
  addonPage: number
  modTotalPages: number
  addonTotalPages: number
  onModPageChange: (page: number) => void
  onAddonPageChange: (page: number) => void
  onAllPageChange: (page: number) => void
  isBusy?: boolean
  isRateLimited?: boolean
}

/** One independent pager; each kind keeps its own cursor and total. */
function RegistryPager({
  label,
  page,
  totalPages,
  onPageChange,
  isBusy,
}: {
  label: string
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  isBusy: boolean
}) {
  const clampPage = (page: number) =>
    Math.min(Math.max(page, 1), Math.max(1, totalPages))

  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-1 pl-1"
    >
      <LibraryActionIconButton
        icon={ChevronLeft}
        label={registryText.paginationPrev()}
        disabled={page <= 1 || isBusy}
        onClick={() => onPageChange(clampPage(page - 1))}
        className="size-8"
      />
      <span className="px-1 text-xs text-muted-foreground tabular-nums">
        {registryText.paginationPage(page, totalPages)}
      </span>
      <LibraryActionIconButton
        icon={ChevronRight}
        label={registryText.paginationNext()}
        disabled={page >= totalPages || isBusy}
        onClick={() => onPageChange(clampPage(page + 1))}
        className="size-8"
      />
    </div>
  )
}

export function RegistryToolbar({
  totalItems,
  modPage,
  addonPage,
  modTotalPages,
  addonTotalPages,
  onModPageChange,
  onAddonPageChange,
  onAllPageChange,
  isBusy = false,
  isRateLimited = false,
}: RegistryToolbarProps) {
  const [kindFilter, setKindFilter] = useAtom(registryKindFilterAtom)
  const [search, setSearch] = useAtom(registrySearchAtom)
  const [sort, setSort] = useAtom(registrySortAtom)
  const [, setModPage] = useAtom(registryModPageAtom)
  const [, setAddonPage] = useAtom(registryAddonPageAtom)
  const activeLibrary = useAtomValue(activeLibraryAtom)
  const sptVersion = activeLibrary?.sptVersion ?? null

  const kindOptions: { value: RegistryKindFilter; label: string }[] = [
    { value: 'all', label: registryText.filterAll() },
    { value: 'mods', label: registryText.filterMods() },
    { value: 'addons', label: registryText.filterAddons() },
  ]

  const sortOptions: { value: RegistrySort; label: string }[] = [
    { value: 'forge-default', label: registryText.sortForgeDefault() },
    { value: 'name-asc', label: registryText.sortName() },
  ]

  function handleKindChange(value: RegistryKindFilter) {
    setKindFilter(value)
    setModPage(1)
    setAddonPage(1)
  }

  return (
    <FidelityPanel
      variant="standard"
      radius="panel"
      className="flex flex-wrap items-center justify-between gap-3 p-2 text-[13px]"
    >
      <div className="relative min-w-48 flex-1 basis-full md:basis-64">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <FidelityInput
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={isRateLimited}
          placeholder={registryText.searchPlaceholder()}
          aria-label={registryText.searchLabel()}
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' &&
              !event.nativeEvent.isComposing &&
              search !== ''
            ) {
              setSearch('')
            }
          }}
          className="h-8 pl-9 text-xs"
        />
      </div>

      {/* Left section: Kind filter + SPT toggle */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Kind Segmented Control */}
        <div
          role="group"
          aria-label={registryText.filterAll()}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background/50 p-0.5"
        >
          {kindOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={isBusy}
              className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
                kindFilter === opt.value
                  ? 'bg-muted text-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
              onClick={() => handleKindChange(opt.value)}
              aria-pressed={kindFilter === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* SPT Compatibility Toggle */}
        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--primary)]"
          role="status"
          title={
            sptVersion
              ? registryText.sptFilter(sptVersion)
              : registryText.sptFilterLabel()
          }
        >
          <span
            className={`size-2 rounded-full ${sptVersion ? 'bg-[var(--primary)]' : 'bg-muted-foreground'}`}
            aria-hidden
          />
          <span>
            {sptVersion ? `SPT ${sptVersion}` : registryText.sptFilterLabel()}
          </span>
        </span>
      </div>

      {/* Right section: Sort + View Mode + Pagination */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Sort Menu: icon-only control, the selected value stays in the menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FidelityButton
              variant="outline"
              size="sm"
              className="size-8 p-0"
              aria-label={registryText.sortLabel()}
              title={registryText.sortLabel()}
              disabled={isBusy}
            >
              <ArrowUpDown className="size-3.5" aria-hidden />
            </FidelityButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(val) => setSort(val as RegistrySort)}
            >
              {sortOptions.map((opt) => (
                <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                  {opt.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* View Mode Selector */}
        <RegistryViewModeSelector />

        {/* All advances both result sets with one page cursor. */}
        <div className="flex items-center gap-2">
          {kindFilter === 'all' ? (
            <RegistryPager
              label={`${registryText.filterAll()} pages`}
              page={modPage}
              totalPages={Math.max(modTotalPages, addonTotalPages)}
              onPageChange={onAllPageChange}
              isBusy={isBusy}
            />
          ) : kindFilter === 'mods' ? (
            <RegistryPager
              label={registryText.paginationModsGroup()}
              page={modPage}
              totalPages={modTotalPages}
              onPageChange={onModPageChange}
              isBusy={isBusy}
            />
          ) : (
            <RegistryPager
              label={registryText.paginationAddonsGroup()}
              page={addonPage}
              totalPages={addonTotalPages}
              onPageChange={onAddonPageChange}
              isBusy={isBusy}
            />
          )}
          {totalItems > 0 && (
            <span className="hidden text-xs text-muted-foreground/75 sm:inline">
              ({totalItems})
            </span>
          )}
        </div>
      </div>
    </FidelityPanel>
  )
}
