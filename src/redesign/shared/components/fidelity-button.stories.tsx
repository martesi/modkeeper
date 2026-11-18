import type { Meta, StoryObj } from '@storybook/react-vite'
import { Download } from 'lucide-react'
import { FidelityButton } from './fidelity-button'

const meta = {
  title: 'Shared/FidelityButton',
  component: FidelityButton,
  parameters: { layout: 'centered' },
  args: { children: 'Manage libraries' },
} satisfies Meta<typeof FidelityButton>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { variant: 'primary' } }
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Outline: Story = { args: { variant: 'outline' } }
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Delete library' },
}

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Download />
        Install archives
      </>
    ),
  },
}

export const Disabled: Story = { args: { disabled: true } }
export const Busy: Story = {
  args: { busy: true, children: 'Rebuilding cache' },
}

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <FidelityButton {...args} size="sm">
        Small
      </FidelityButton>
      <FidelityButton {...args} size="md">
        Medium
      </FidelityButton>
      <FidelityButton {...args} size="lg">
        Large
      </FidelityButton>
    </div>
  ),
}
