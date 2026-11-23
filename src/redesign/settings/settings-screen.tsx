import { Fragment, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import { FidelityPanel } from '../shared/components/fidelity-panel'
import { settingsAtom } from '../state/settings-state'
import { saveSettings, DEFAULT_ACCENT } from '../data/settings-repository'
import type { AppSettings } from '../data/redesign-types'
import { settingsText } from '../i18n/settings-text'
import { SettingRow } from './setting-row'
import { ThemeModeControl } from './theme-mode-control'
import { AccentSwatches } from './accent-swatches'
import { LanguageSelect } from './language-select'
import { FidelitySwitch } from '../shared/components/fidelity-switch'

const FALLBACK_SETTINGS: AppSettings = {
  theme: 'system',
  accentColor: DEFAULT_ACCENT,
  language: 'en-US',
  enableModsOnInstall: true,
  forgeEndpoint: '',
}

/**
 * Settings screen with divider-separated rows. Each update saves a patch against the latest
 * settings snapshot; the repository serializes writes to avoid stale full-object overwrites.
 */
export function SettingsScreen() {
  const settings = useAtomValue(settingsAtom) ?? FALLBACK_SETTINGS
  const [forgeEndpointDraft, setForgeEndpointDraft] = useState<string | null>(
    null,
  )
  const [savingForgeEndpoint, setSavingForgeEndpoint] = useState(false)
  const endpoint = forgeEndpointDraft ?? settings.forgeEndpoint
  const endpointDirty = endpoint !== settings.forgeEndpoint
  const forgeEndpointDraftRef = useRef(endpoint)

  function save(patch: Partial<AppSettings>) {
    void saveSettings(patch)
  }

  async function saveForgeEndpoint() {
    if (savingForgeEndpoint || !endpointDirty) return
    const endpointToSave = endpoint
    setSavingForgeEndpoint(true)
    const saved = await saveSettings({ forgeEndpoint: endpointToSave })
    if (
      saved.forgeEndpoint === endpointToSave &&
      forgeEndpointDraftRef.current === endpointToSave
    ) {
      setForgeEndpointDraft(null)
    }
    setSavingForgeEndpoint(false)
  }

  const rows = [
    {
      key: 'enable-on-install',
      label: settingsText.enableOnInstall(),
      description: settingsText.enableOnInstallDescription(),
      control: (
        <FidelitySwitch
          aria-label={settingsText.enableOnInstall()}
          checked={settings.enableModsOnInstall}
          onCheckedChange={(enableModsOnInstall) =>
            save({ enableModsOnInstall })
          }
        />
      ),
    },
    {
      key: 'forge-endpoint',
      label: 'Forge endpoint',
      description: 'Leave empty to use the default Forge endpoint.',
      control: (
        <div className="flex items-center gap-2">
          <input
            aria-label="Forge endpoint"
            className="w-72 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            placeholder="Default Forge endpoint"
            value={endpoint}
            onChange={(event) => {
              const nextEndpoint = event.currentTarget.value
              forgeEndpointDraftRef.current = nextEndpoint
              setForgeEndpointDraft(
                savingForgeEndpoint || nextEndpoint !== settings.forgeEndpoint
                  ? nextEndpoint
                  : null,
              )
            }}
          />
          <Button
            disabled={!endpointDirty || savingForgeEndpoint}
            onClick={() => void saveForgeEndpoint()}
            size="sm"
            type="button"
          >
            {savingForgeEndpoint ? 'Saving…' : 'Save'}
          </Button>
        </div>
      ),
    },
    {
      key: 'theme',
      label: settingsText.appearance(),
      description: settingsText.appearanceDescription(),
      control: (
        <ThemeModeControl
          value={settings.theme}
          onChange={(theme) => save({ theme })}
        />
      ),
    },
    {
      key: 'accent',
      label: settingsText.accent(),
      description: settingsText.accentDescription(),
      control: (
        <AccentSwatches
          value={settings.accentColor}
          onChange={(accentColor) => save({ accentColor })}
        />
      ),
    },
    {
      key: 'language',
      label: settingsText.language(),
      description: settingsText.languageDescription(),
      control: (
        <LanguageSelect
          value={settings.language}
          onChange={(language) => save({ language })}
        />
      ),
    },
  ]

  return (
    <div className="mx-auto flex w-full max-w-[62.5rem] flex-col">
      <p className="mb-3 text-xs text-muted-foreground">
        {settingsText.subtitle()}
      </p>

      <FidelityPanel className="flex flex-col">
        {rows.map((row, index) => (
          <Fragment key={row.key}>
            {index > 0 && <div className="h-px bg-border" aria-hidden />}
            <SettingRow label={row.label} description={row.description}>
              {row.control}
            </SettingRow>
          </Fragment>
        ))}
      </FidelityPanel>
    </div>
  )
}
