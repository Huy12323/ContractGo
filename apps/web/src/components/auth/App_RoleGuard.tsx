import type { ReactNode } from 'react'
import { useOrganization } from '@/hooks/useOrganization'
import type { OrgRole } from '@/hooks/useOrganization'

interface RoleGuardProps {
  roles: OrgRole[]
  children: ReactNode
  fallback?: ReactNode
}

export const App_RoleGuard = ({ roles, children, fallback = null }: RoleGuardProps) => {
  const { role, loading } = useOrganization()

  if (loading) return null
  if (!role || !roles.includes(role)) return <>{fallback}</>

  return <>{children}</>
}
