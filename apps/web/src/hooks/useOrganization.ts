import { useMemo } from 'react'
import { useQ_Tables_MyOrganizations } from '@/hooks/useQ_Tables_MyOrganizations'
import { useQ_Tables_MyRole } from '@/hooks/useQ_Tables_MyRole'
import { useQ_Tables_OrgPermissions } from '@/hooks/useQ_Tables_OrgPermissions'
import type { Enums } from '@worldcraft/shared/types'

export type OrgRole = 'owner' | 'admin' | 'employee'
type AppPermission = Enums<'app_permission'>

export const useOrganization = () => {
  const qOrganizations = useQ_Tables_MyOrganizations()

  // Auto-select first org (multi-org switcher is future)
  const organization = qOrganizations.organizations[0] ?? null
  const organizationId = organization?.id ?? ''

  const qRole = useQ_Tables_MyRole({ organizationId })
  const role = (qRole.role ?? null) as OrgRole | null

  const qPermissions = useQ_Tables_OrgPermissions({ organizationId })

  const permissions = useMemo<AppPermission[]>(() => {
    if (!role || qPermissions.permissions.length === 0) return []
    if (role === 'owner') {
      return [...new Set(qPermissions.permissions.map((rp) => rp.permission))]
    }
    return qPermissions.permissions
      .filter((rp) => rp.role === role)
      .map((rp) => rp.permission)
  }, [role, qPermissions.permissions])

  const permissionSet = useMemo(() => new Set(permissions), [permissions])

  const hasPermission = (permission: AppPermission): boolean => {
    if (role === 'owner') return true
    return permissionSet.has(permission)
  }

  return {
    organization,
    role,
    permissions,
    hasPermission,
    hasOrg: !!organization,
    loading: qOrganizations.query.isLoading || qRole.query.isLoading || qPermissions.query.isLoading,
  }
}
