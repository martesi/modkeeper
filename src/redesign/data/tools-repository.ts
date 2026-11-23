/*
 * Executable-tools repository (reference Modkeeper.dc.html: per-library launch tools).
 *
 * BACKEND GAP: the tool registry is still deferred backend-side (§7d — `toolsByLibraryId` is
 * present-but-empty and no tool commands exist in the bindings). Until those land, tool CRUD
 * mutates the workspace atom (and the browser fixture) only, so registered tools DO NOT persist
 * across app restarts in Wails. The shapes below mirror the frozen `ToolSummary` so swapping the
 * body for real `commands.*` calls is a local change.
 */
import { canOpenPath, openPath, platformKind } from '@/platform'
import { toast } from 'sonner'
import { getDefaultStore } from 'jotai'
import type {
  LibraryId,
  LibraryWorkspace,
  ToolId,
  ToolSummary,
} from './redesign-types'
import { getMockWorkspace, setMockWorkspace } from './example-data'
import { libraryWorkspaceAtom, setWorkspace } from '../state/library-state'
import { libraryText } from '../i18n/library-text'

export type ToolDraft = {
  name: string
  executablePath: string
  launchArgs: string
  iconDataUrl: string
}

function mutateWorkspace(
  mutate: (workspace: LibraryWorkspace) => void,
): LibraryWorkspace {
  const current =
    getDefaultStore().get(libraryWorkspaceAtom) ?? getMockWorkspace()
  const workspace = structuredClone(current)
  mutate(workspace)
  if (platformKind() === 'browser') setMockWorkspace(workspace)
  setWorkspace(workspace)
  return workspace
}

export function saveTool(input: {
  libraryId: LibraryId
  toolId: ToolId | null
  draft: ToolDraft
}): void {
  mutateWorkspace((workspace) => {
    const tools = (workspace.toolsByLibraryId[input.libraryId] ??= [])
    const fields = {
      name: input.draft.name.trim(),
      executablePath: input.draft.executablePath.trim(),
      launchArgs: input.draft.launchArgs.trim() || undefined,
      iconDataUrl: input.draft.iconDataUrl.trim() || undefined,
      updatedAt: new Date().toISOString(),
    }
    const existing = input.toolId
      ? tools.find((tool) => tool.id === input.toolId)
      : undefined
    if (existing) Object.assign(existing, fields)
    else
      tools.push({
        id: crypto.randomUUID(),
        libraryId: input.libraryId,
        ...fields,
      })
  })
  toast.success(libraryText.toolSaved())
}

export function deleteTool(input: {
  libraryId: LibraryId
  toolId: ToolId
}): void {
  mutateWorkspace((workspace) => {
    const tools = workspace.toolsByLibraryId[input.libraryId] ?? []
    workspace.toolsByLibraryId[input.libraryId] = tools.filter(
      (tool) => tool.id !== input.toolId,
    )
  })
  toast.success(libraryText.toolDeleted())
}

/**
 * Launch the file with the OS default handler through the platform opener.
 * This is the same handoff Wails's opener plugin performs; whether the OS
 * executes a given file depends on its registered handler. Launch arguments
 * cannot be passed through the opener, so they are stored but unused, and the
 * UI labels them accordingly.
 */
export async function launchTool(tool: ToolSummary): Promise<void> {
  if (!canOpenPath()) {
    // MOCK-FALLBACK: browser and server pages cannot execute a desktop file.
    console.info('[redesign] would launch tool:', tool.executablePath)
    toast.error(libraryText.toolLaunchFailed(tool.name))
    return
  }
  toast.info(libraryText.launchingTool(tool.name))
  try {
    await openPath(tool.executablePath)
  } catch (error) {
    console.error('[redesign] tool launch failed', error)
    toast.error(libraryText.toolLaunchFailed(tool.name))
  }
}
