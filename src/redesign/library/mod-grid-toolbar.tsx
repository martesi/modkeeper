import { useAtom, useAtomValue } from 'jotai'
import { ChevronDown, Search } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FidelityPanel } from '../shared/components/fidelity-panel'
import { FidelityCheckbox } from '../shared/components/fidelity-checkbox'
import { FidelityButton } from '../shared/components/fidelity-button'
import { FidelityInput } from '../shared/components/fidelity-input'
import { BulkActionsMenu } from './bulk-actions-menu'
import {
  libraryBusyAtom,
  librarySearchAtom,
  librarySortAtom,
  libraryStatusFilterAtom,
  libraryTypeFilterAtom,
  selectedModIdsAtom,
  visibleModsAtom,
  type LibrarySort,
  type LibraryStatusFilter,
  type LibraryTypeFilter,
} from '../state/library-state'
import { libraryText } from '../i18n/library-text'

/**
 * Grid toolbar (reference Modkeeper.dc.html): one card row with Select All, the Sort and Filter
 * dropdowns, the bulk ACTIONS menu, and search. Bulk-affecting controls are disabled while the
 * library is busy so a queued action reads as "library busy," not a hang; search/sort/filter stay
 * live — they are local.
 */
export function ModGridToolbar() {
  const libraryBusy = useAtomValue(libraryBusyAtom)
  const visibleMods = useAtomValue(visibleModsAtom)
  const [selectedIds, setSelectedIds] = useAtom(selectedModIdsAtom)
  const [search, setSearch] = useAtom(librarySearchAtom)
  const [sort, setSort] = useAtom(librarySortAtom)
  const [statusFilter, setStatusFilter] = useAtom(libraryStatusFilterAtom)
  const [typeFilter, setTypeFilter] = useAtom(libraryTypeFilterAtom)

  const visibleSelectedCount = visibleMods.filter((mod) =>
    selectedIds.has(mod.id),
  ).length
  const allVisibleSelected =
    visibleMods.length > 0 && visibleSelectedCount === visibleMods.length

  // Select All operates on the VISIBLE set only (§12.3); off-screen selections are untouched.
  function handleSelectAll(checked: boolean) {
    const next = new Set(selectedIds)
    for (const mod of visibleMods) {
      if (checked) next.add(mod.id)
      else next.delete(mod.id)
    }
    setSelectedIds(next)
  }

  const sortOptions: { value: LibrarySort; label: string }[] = [
    { value: 'name-asc', label: libraryText.sortNameAsc() },
    { value: 'name-desc', label: libraryText.sortNameDesc() },
    { value: 'updated-desc', label: libraryText.sortUpdatedDesc() },
    { value: 'installed-desc', label: libraryText.sortInstalledDesc() },
    { value: 'installed-asc', label: libraryText.sortInstalledAsc() },
  ]
  const filterOptions: { value: LibraryStatusFilter; label: string }[] = [
    { value: 'all', label: libraryText.filterAll() },
    { value: 'enabled', label: libraryText.filterEnabled() },
    { value: 'disabled', label: libraryText.filterDisabled() },
  ]
  const typeFilterOptions: { value: LibraryTypeFilter; label: string }[] = [
    { value: 'all', label: libraryText.typeFilterAll() },
    { value: 'client', label: libraryText.typeFilterClient() },
    { value: 'server', label: libraryText.typeFilterServer() },
    { value: 'both', label: libraryText.typeFilterBoth() },
    { value: 'unknown', label: libraryText.typeFilterUnknown() },
  ]

  const sortLabel =
    sortOptions.find((option) => option.value === sort)?.label ?? ''
  const filterLabel =
    filterOptions.find((option) => option.value === statusFilter)?.label ?? ''
  const typeFilterLabel =
    typeFilterOptions.find((option) => option.value === typeFilter)?.label ?? ''

  return (
    <FidelityPanel className="flex flex-wrap items-center gap-2 p-2">
      <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-muted-foreground">
        <FidelityCheckbox
          checked={allVisibleSelected}
          indeterminate={!allVisibleSelected && visibleSelectedCount > 0}
          onCheckedChange={handleSelectAll}
          disabled={libraryBusy || visibleMods.length === 0}
          aria-label={libraryText.selectAllVisible()}
        />
        {libraryText.selectAll()}
      </label>

      <OptionMenu
        label={libraryText.sortLabel()}
        valueLabel={sortLabel}
        value={sort}
        options={sortOptions}
        onChange={(value) => setSort(value)}
      />
      <OptionMenu
        label={libraryText.filterLabel()}
        valueLabel={filterLabel}
        value={statusFilter}
        options={filterOptions}
        onChange={(value) => setStatusFilter(value)}
      />
      <OptionMenu
        label={libraryText.typeFilterLabel()}
        valueLabel={typeFilterLabel}
        value={typeFilter}
        options={typeFilterOptions}
        onChange={(value) => setTypeFilter(value)}
      />

      <BulkActionsMenu />

      <div className="relative min-w-44 flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <FidelityInput
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={libraryText.searchPlaceholder()}
          aria-label={libraryText.searchLabel()}
          data-library-search=""
          onKeyDown={(event) => {
            if (
              event.key !== 'Escape' ||
              event.nativeEvent.isComposing ||
              search === ''
            ) {
              return
            }
            setSearch('')
          }}
          className="pl-9"
        />
      </div>
    </FidelityPanel>
  )
}

/** A "Label: Value ⌄" dropdown on the shadcn DropdownMenu radio group (fix_plan_0.md §2/§7). */
function OptionMenu<Value extends string>({
  label,
  valueLabel,
  value,
  options,
  onChange,
}: {
  label: string
  valueLabel: string
  value: Value
  options: { value: Value; label: string }[]
  onChange: (value: Value) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FidelityButton variant="secondary" className="text-[13px]">
          {label}: {valueLabel}
          <ChevronDown />
        </FidelityButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="min-w-[11.5rem] rounded-lg p-1"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as Value)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="rounded-sm data-[state=checked]:bg-primary/10 data-[state=checked]:font-semibold data-[state=checked]:text-primary"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
