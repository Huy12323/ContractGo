import type { ReactNode } from 'react'
import { useOrganization } from '@/hooks/use-organization'
import type { Enums } from '@worldcraft/shared/types'

interface RoleGuardProps {
  roles: Enums<'app_role'>[]
  children: ReactNode
  fallback?: ReactNode
}

export function RoleGuard({ roles, children, fallback = null }: RoleGuardProps) {
  const { role, loading } = useOrganization()

  if (loading) return null
  if (!role || !roles.includes(role)) return <>{fallback}</>

  return <>{children}</>
}
