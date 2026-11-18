import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/library/$id')({
  beforeLoad: () => {
    throw redirect({ to: '/library' })
  },
})
