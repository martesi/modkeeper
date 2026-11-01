import { Fragment } from 'react'
import { useAtomValue } from 'jotai'
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
}

/**
 * Settings screen (reference Modkeeper.dc.html settings view): page header, then ONE glass card
 * with divider-separated rows — App Theme, Accent Color, Interface Language. Every change saves
 * the FULL settings object (T1); the initializers' applier turns the replaced atom into visible
 * effect.
 */
export function SettingsScreen() {
  const settings = useAtomValue(settingsAtom) ?? FALLBACK_SETTINGS

  function save(patch: Partial<AppSettings>) {
    void saveSettings({ ...settings, ...patch })
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
      <h1 className="font-heading text-[26px] font-extrabold leading-tight text-foreground">
        {settingsText.title()}
      </h1>
      <p className="mb-3 text-[13px] text-muted-foreground">
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
