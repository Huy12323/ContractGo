import { createFileRoute } from '@tanstack/react-router'
import { Page_ResetPassword } from '@/pages/Page_ResetPassword/Page_ResetPassword'

export const Route = createFileRoute('/_auth/reset-password')({
  component: Page_ResetPassword,
})
