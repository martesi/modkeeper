import { useAtom, useAtomValue } from 'jotai'
import { useRouterState } from '@tanstack/react-router'
import {
  ArrowUpDown,
  ListFilter,
  MoreHorizontal,
  Search,
  Tags,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FidelityPanel } from '../shared/components/fidelity-panel'
import { FidelityCheckbox } from '../shared/components/fidelity-checkbox'
import { FidelityButton } from '../shared/components/fidelity-button'
import { FidelityInput } from '../shared/components/fidelity-input'
import { BulkActionsMenu } from './bulk-actions-menu'
import { LibraryActionIconButton } from './library-action-icon-button'
import { LibraryViewModeSelector } from './library-view-mode-selector'
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

/** Search, presentation, sorting and bulk actions for the active library. */
export function ModGridToolbar() {
  const titlebarSearchEnabled = useRouterState({
    select: (state) => state.location.pathname.startsWith('/library'),
  })
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
        <span className="hidden lg:inline">{libraryText.selectAll()}</span>
      </label>

      <div className="hidden items-center gap-1 sm:flex">
        <OptionMenu
          label={libraryText.sortLabel()}
          icon={ArrowUpDown}
          value={sort}
          options={sortOptions}
          onChange={setSort}
        />
        <OptionMenu
          label={libraryText.filterLabel()}
          icon={ListFilter}
          value={statusFilter}
          options={filterOptions}
          onChange={setStatusFilter}
        />
        <OptionMenu
          label={libraryText.typeFilterLabel()}
          icon={Tags}
          value={typeFilter}
          options={typeFilterOptions}
          onChange={setTypeFilter}
        />
      </div>

      <div className="sm:hidden">
        <OverflowOptions
          sort={sort}
          statusFilter={statusFilter}
          typeFilter={typeFilter}
          sortOptions={sortOptions}
          filterOptions={filterOptions}
          typeFilterOptions={typeFilterOptions}
          onSortChange={setSort}
          onStatusFilterChange={setStatusFilter}
          onTypeFilterChange={setTypeFilter}
        />
      </div>

      <BulkActionsMenu />

      {!titlebarSearchEnabled && (
        <div className="relative min-w-36 flex-1">
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
      )}

      <LibraryViewModeSelector />
    </FidelityPanel>
  )
}

function OptionMenu<Value extends string>({
  label,
  icon: Icon,
  value,
  options,
  onChange,
}: {
  label: string
  icon: typeof ArrowUpDown
  value: Value
  options: { value: Value; label: string }[]
  onChange: (value: Value) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FidelityButton
          type="button"
          variant="ghost"
          title={label}
          aria-label={label}
          className="size-8 px-1.5 [&_svg]:size-5"
        >
          <Icon aria-hidden />
        </FidelityButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[11.5rem]">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find((item) => item.value === next)
            if (option) onChange(option.value)
          }}
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

function OverflowOptions<
  Sort extends string,
  Status extends string,
  Type extends string,
>({
  sort,
  statusFilter,
  typeFilter,
  sortOptions,
  filterOptions,
  typeFilterOptions,
  onSortChange,
  onStatusFilterChange,
  onTypeFilterChange,
}: {
  sort: Sort
  statusFilter: Status
  typeFilter: Type
  sortOptions: { value: Sort; label: string }[]
  filterOptions: { value: Status; label: string }[]
  typeFilterOptions: { value: Type; label: string }[]
  onSortChange: (value: Sort) => void
  onStatusFilterChange: (value: Status) => void
  onTypeFilterChange: (value: Type) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <LibraryActionIconButton
          icon={MoreHorizontal}
          label={libraryText.moreOptions()}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[11.5rem]">
        <OptionSubmenu
          label={libraryText.sortLabel()}
          icon={ArrowUpDown}
          value={sort}
          options={sortOptions}
          onChange={onSortChange}
        />
        <OptionSubmenu
          label={libraryText.filterLabel()}
          icon={ListFilter}
          value={statusFilter}
          options={filterOptions}
          onChange={onStatusFilterChange}
        />
        <OptionSubmenu
          label={libraryText.typeFilterLabel()}
          icon={Tags}
          value={typeFilter}
          options={typeFilterOptions}
          onChange={onTypeFilterChange}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function OptionSubmenu<Value extends string>({
  label,
  icon: Icon,
  value,
  options,
  onChange,
}: {
  label: string
  icon: typeof ArrowUpDown
  value: Value
  options: { value: Value; label: string }[]
  onChange: (value: Value) => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon aria-hidden />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find((item) => item.value === next)
            if (option) onChange(option.value)
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
