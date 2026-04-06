import type { ReactNode } from 'react'
import { useOrganization } from '@/hooks/useOrganization'
import type { Enums } from '@/types'

interface PermissionGuardProps {
  permission: Enums<'app_permission'>
  children: ReactNode
  fallback?: ReactNode
}

export const App_PermissionGuard = ({ permission, children, fallback = null }: PermissionGuardProps) => {
  const { hasPermission, loading } = useOrganization()

  if (loading) return null
  if (!hasPermission(permission)) return <>{fallback}</>

  return <>{children}</>
}
