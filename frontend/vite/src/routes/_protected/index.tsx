import { createFileRoute } from '@tanstack/react-router'
import { Page_Home } from '@/pages/Page_Home/Page_Home'

export const Route = createFileRoute('/_protected/')({
  component: Page_Home,
})
