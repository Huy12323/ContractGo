import { createFileRoute } from '@tanstack/react-router'
import { Page_MyTimeclock } from '@/pages/Page_MyTimeclock/Page_MyTimeclock'

export const Route = createFileRoute('/_protected/$organizationId/my-timeclock/')({
  component: Page_MyTimeclock,
})
