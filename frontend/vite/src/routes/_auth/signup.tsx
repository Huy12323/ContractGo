import { createFileRoute } from '@tanstack/react-router'
import { Page_SignUp } from '@/pages/Page_SignUp/Page_SignUp'

export const Route = createFileRoute('/_auth/signup')({
  component: Page_SignUp,
})
