import { createFileRoute } from '@tanstack/react-router'
import { Page_Organization } from '@/pages/Page_Organization/Page_Organization'

export const Route = createFileRoute('/_protected/$organizationId/')({
  component: Page_Organization,
})
