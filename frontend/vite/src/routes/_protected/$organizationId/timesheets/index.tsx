import { createFileRoute } from '@tanstack/react-router'
import { Page_Timesheets } from '@/pages/Page_Timesheets/Page_Timesheets'

export const Route = createFileRoute('/_protected/$organizationId/timesheets/')({
  component: Page_Timesheets,
})
