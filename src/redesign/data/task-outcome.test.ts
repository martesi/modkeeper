import { describe, expect, test } from 'bun:test'
import {
  archiveBasename,
  canRetryFailedArchives,
  deriveArchiveOutcome,
  deriveCacheOutcome,
  deriveSyncOutcome,
} from './task-outcome'

describe('task outcomes', () => {
  test('derives mixed install counts from submitted paths and unique failures', () => {
    const outcome = deriveArchiveOutcome(
      [
        {
          archivePath: '/mods/broken.zip',
          error: { code: 'ParseError', data: 'bad zip' },
        },
      ],
      ['/mods/good.zip', '/mods/broken.zip'],
      'task-1',
      'library-1',
    )

    expect(outcome).toMatchObject({
      kind: 'install',
      taskId: 'task-1',
      libraryId: 'library-1',
      submittedCount: 2,
      successCount: 1,
      failedPaths: ['/mods/broken.zip'],
    })
  })

  test('derives zero successes when every submitted archive failed', () => {
    const outcome = deriveArchiveOutcome(
      [
        { archivePath: '/mods/one.zip', error: { code: 'Unexpected' } },
        { archivePath: '/mods/two.7z', error: { code: 'Unexpected' } },
      ],
      ['/mods/one.zip', '/mods/two.7z'],
      'task-2',
      'library-1',
    )

    expect(outcome.successCount).toBe(0)
  })

  test('derives all submitted archives as successful when there are no failures', () => {
    const outcome = deriveArchiveOutcome(
      [],
      ['/mods/one.zip', '/mods/two.7z'],
      'task-3',
      'library-1',
    )

    expect(outcome.successCount).toBe(2)
  })

  test('preserves duplicate raw failures but refuses an inconsistent count', () => {
    const failure = {
      archivePath: '/mods/broken.zip',
      error: { code: 'ParseError', data: 'bad zip' } as const,
    }
    const outcome = deriveArchiveOutcome(
      [failure, failure],
      ['/mods/good.zip', '/mods/broken.zip'],
      'task-4',
      'library-1',
    )

    expect(outcome.failures).toHaveLength(2)
    expect(outcome.failedPaths).toEqual(['/mods/broken.zip'])
    // One submitted occurrence cannot account for two failure records.
    expect(outcome.successCount).toBeNull()
  })

  test('counts duplicate submissions by occurrence', () => {
    const failure = {
      archivePath: '/mods/dup.zip',
      error: { code: 'Unexpected' } as const,
    }
    const allFailed = deriveArchiveOutcome(
      [failure, failure],
      ['/mods/dup.zip', '/mods/dup.zip'],
      'task-dupe-fail',
      'library-1',
    )
    const oneSucceeded = deriveArchiveOutcome(
      [failure],
      ['/mods/dup.zip', '/mods/dup.zip'],
      'task-dupe-one',
      'library-1',
    )

    expect(allFailed.successCount).toBe(0)
    expect(oneSucceeded.successCount).toBe(1)
  })

  test('does not invent a success count when submitted paths are unknown or inconsistent', () => {
    const unknown = deriveArchiveOutcome([], undefined, 'task-5', 'library-1')
    const inconsistent = deriveArchiveOutcome(
      [{ archivePath: '/mods/other.zip', error: { code: 'Unexpected' } }],
      ['/mods/submitted.zip'],
      'task-6',
      'library-1',
    )

    expect(unknown.successCount).toBeNull()
    expect(inconsistent.successCount).toBeNull()
  })

  test('extracts archive basenames with Windows and Unix separators', () => {
    expect(archiveBasename('C:\\mods\\nested\\one.7z')).toBe('one.7z')
    expect(archiveBasename('/mods/nested/one.zip')).toBe('one.zip')
  })

  test('keeps an empty sync mod id as an operation-level failure', () => {
    const outcome = deriveSyncOutcome(
      [{ modId: '', error: { code: 'Unexpected' } }],
      'library-1',
      'task-7',
    )

    expect(outcome.succeeded).toBe(false)
    expect(outcome.failures[0]?.modId).toBe('')
  })

  test('retains the backend cache failure message', () => {
    const outcome = deriveCacheOutcome(
      { state: 'failed', message: 'Cache index could not be written' },
      'library-1',
      'task-8',
    )

    expect(outcome).toMatchObject({
      kind: 'cache',
      cacheState: 'failed',
      message: 'Cache index could not be written',
    })
  })

  test('allows retry only for the same active idle library', () => {
    const outcome = deriveArchiveOutcome(
      [{ archivePath: '/mods/broken.zip', error: { code: 'Unexpected' } }],
      ['/mods/broken.zip'],
      'task-9',
      'library-1',
    )

    expect(canRetryFailedArchives(outcome, 'library-1', false)).toBe(true)
    expect(canRetryFailedArchives(outcome, 'library-2', false)).toBe(false)
    expect(canRetryFailedArchives(outcome, 'library-1', true)).toBe(false)
    expect(
      canRetryFailedArchives(
        deriveSyncOutcome([], 'library-1', 'task-10'),
        'library-1',
        false,
      ),
    ).toBe(false)
  })
})
