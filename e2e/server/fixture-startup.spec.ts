import { test } from './fixture'

test.skip(
  !process.env.MODKEEPER_E2E_STARTUP_PROBE,
  'Only run as a fixture probe',
)

test('fixture startup failure probe', async ({ server }) => {
  void server
})
