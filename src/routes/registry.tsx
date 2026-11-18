import { createFileRoute } from '@tanstack/react-router'
import { RegistryScreen } from '@/redesign/registry/registry-screen'

export const Route = createFileRoute('/registry')({
  component: RegistryScreen,
})
