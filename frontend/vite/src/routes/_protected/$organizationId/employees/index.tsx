import { createFileRoute } from '@tanstack/react-router'
import { Page_Employees } from '@/pages/Page_Employees/Page_Employees'

type EmployeesSearch = { viewId?: string }

export const Route = createFileRoute('/_protected/$organizationId/employees/')({
  validateSearch: (search: Record<string, unknown>): EmployeesSearch => ({
    viewId: typeof search.viewId === 'string' ? search.viewId : undefined,
  }),
  component: Page_Employees,
})
