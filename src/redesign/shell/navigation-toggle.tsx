import type { Dispatch, SetStateAction } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { toggleNavigationPreference } from './shell-state'

interface NavigationToggleProps {
  expanded: boolean
  label: string
  narrow: boolean
  setExpanded: Dispatch<SetStateAction<boolean>>
}

export function NavigationToggle({
  expanded,
  label,
  narrow,
  setExpanded,
}: NavigationToggleProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-controls="primary-navigation"
      aria-expanded={expanded}
      disabled={narrow}
      title={label}
      className="pointer-events-auto flex size-8 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground outline-none transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      onClick={() => toggleNavigationPreference(narrow, setExpanded)}
    >
      {expanded ? (
        <PanelLeftClose className="size-4" aria-hidden />
      ) : (
        <PanelLeftOpen className="size-4" aria-hidden />
      )}
    </button>
  )
}
