import {
  HomeDirectory,
  ListDirectory,
} from '../../frontend/bindings/github.com/martes/modkeeper/backend/app'
import type { DirectoryEntry } from '../../frontend/bindings/github.com/martes/modkeeper/backend/models'
import { z } from 'zod'
import { getWailsMock } from './mock'

export type { DirectoryEntry }

export async function listDirectory(path: string): Promise<DirectoryEntry[]> {
  const mock = getWailsMock()?.commands?.listDirectory
  const result = await (mock ? mock(path) : ListDirectory(path))
  if (result === null) throw new Error('Directory listing must not be null')
  return result
}

export async function homeDirectory(): Promise<string> {
  const mock = getWailsMock()?.commands?.homeDirectory
  const result = await (mock ? mock() : HomeDirectory())
  return z.string().min(1).parse(result)
}
