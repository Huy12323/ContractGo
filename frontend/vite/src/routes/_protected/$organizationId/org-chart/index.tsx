import { createFileRoute } from '@tanstack/react-router'
import { Page_OrgChart } from '@/pages/Page_OrgChart/Page_OrgChart'

export const Route = createFileRoute('/_protected/$organizationId/org-chart/')({
  component: Page_OrgChart,
})
