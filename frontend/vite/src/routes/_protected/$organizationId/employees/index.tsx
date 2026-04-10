import { createFileRoute } from '@tanstack/react-router'
import { Page_Employees } from '@/pages/Page_Employees/Page_Employees'

export const Route = createFileRoute('/_protected/$organizationId/employees/')({
  component: Page_Employees,
})
