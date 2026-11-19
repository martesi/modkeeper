import { Call, Events } from '@wailsio/runtime'
import { GetSettings } from '../frontend/bindings/github.com/martes/modkeeper/backend/app'

const smokeService = 'main.NativeSmokeService'
const expectedSettings = {
  theme: 'system',
  accentColor: 'default',
  language: 'en-US',
  enableModsOnInstall: true,
}

export async function startNativeSmoke() {
  try {
    const settings = await GetSettings()
    if (
      !settings ||
      settings.theme !== expectedSettings.theme ||
      settings.accentColor !== expectedSettings.accentColor ||
      settings.language !== expectedSettings.language ||
      settings.enableModsOnInstall !== expectedSettings.enableModsOnInstall
    ) {
      throw new Error(`unexpected settings value: ${JSON.stringify(settings)}`)
    }
    await Call.ByName(
      `${smokeService}.ReportSettings`,
      JSON.stringify(settings),
    )

    Events.On('native-smoke-event', (event) => {
      const payload = String(event.data)
      ;(window as Window & { __nativeSmokeEvent?: string }).__nativeSmokeEvent =
        payload
      void Call.ByName(
        `${smokeService}.ReportEvent`,
        JSON.stringify({
          payload,
          execJSObserved:
            (window as Window & { __nativeSmokeGoExecJS?: boolean })
              .__nativeSmokeGoExecJS === true,
        }),
      )
    })
    await Call.ByName(`${smokeService}.ListenerReady`)
  } catch (error) {
    console.error('native-smoke: frontend verification failed', error)
  }
}

void startNativeSmoke()

declare global {
  interface Window {
    __MODKEEPER_NATIVE_SMOKE_START__?: () => Promise<void>
  }
}
