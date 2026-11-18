import type { Meta, StoryObj } from '@storybook/react-vite'
import { FidelityInput } from './fidelity-input'

const meta = {
  title: 'Shared/FidelityInput',
  component: FidelityInput,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { placeholder: 'Library name' },
} satisfies Meta<typeof FidelityInput>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithValue: Story = {
  args: { defaultValue: 'SPT Winter Playthrough' },
}
export const Disabled: Story = { args: { disabled: true } }
export const Invalid: Story = {
  args: { 'aria-invalid': true, defaultValue: 'Already registered path' },
}
