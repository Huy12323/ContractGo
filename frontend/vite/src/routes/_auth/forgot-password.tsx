import { createFileRoute } from '@tanstack/react-router'
import { Page_ForgotPassword } from '@/pages/Page_ForgotPassword/Page_ForgotPassword'

export const Route = createFileRoute('/_auth/forgot-password')({
  component: Page_ForgotPassword,
})
