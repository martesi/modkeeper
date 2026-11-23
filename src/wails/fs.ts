import { Call } from '@wailsio/runtime'
import { z } from 'zod'
import { getWailsMock } from './mock'

const entriesSchema = z.array(
  z.object({ Name: z.string(), IsDir: z.boolean() }),
)
export type DirectoryEntry = z.infer<typeof entriesSchema>[number]

export async function listDirectory(path: string): Promise<DirectoryEntry[]> {
  const mock = getWailsMock()?.commands?.listDirectory
  const result: unknown = mock
    ? await mock(path)
    : await Call.ByName(
        'github.com/martes/modkeeper/backend.App.ListDirectory',
        path,
      )
  return entriesSchema.parse(result)
}

export async function homeDirectory(): Promise<string> {
  const mock = getWailsMock()?.commands?.homeDirectory
  const result: unknown = mock
    ? await mock()
    : await Call.ByName('github.com/martes/modkeeper/backend.App.HomeDirectory')
  return z.string().min(1).parse(result)
}
