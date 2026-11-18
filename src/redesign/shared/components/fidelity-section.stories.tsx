import type { Meta, StoryObj } from '@storybook/react-vite'
import { FidelitySection } from './fidelity-section'
import { FidelityButton } from './fidelity-button'
import { FidelityInput } from './fidelity-input'

const meta = {
  title: 'Shared/FidelitySection',
  component: FidelitySection,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FidelitySection>

export default meta
type Story = StoryObj<typeof meta>

export const Identity: Story = {
  args: {
    title: 'Identity',
    description: 'The display name for this library.',
    children: <FidelityInput defaultValue="SPT Winter Playthrough" />,
  },
}

export const WithAction: Story = {
  args: {
    title: 'Cache',
    description: 'Reconcile recorded mods against what is on disk.',
    actions: (
      <FidelityButton variant="secondary" size="sm">
        Rebuild
      </FidelityButton>
    ),
    children: (
      <p className="text-sm text-muted-foreground">Last rebuilt 2 hours ago.</p>
    ),
  },
}

export const TitleOnly: Story = {
  args: {
    title: 'Paths',
    children: (
      <p className="text-sm text-muted-foreground">game_root/.mod_keeper</p>
    ),
  },
}
