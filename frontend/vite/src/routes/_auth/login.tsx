import { createFileRoute } from '@tanstack/react-router'
import { Page_Login } from '@/pages/Page_Login/Page_Login'

export const Route = createFileRoute('/_auth/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: Page_Login,
})
