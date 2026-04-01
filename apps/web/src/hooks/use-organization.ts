import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { organizationQueries } from '@/api/queries/organizations'
import type { Enums } from '@worldcraft/shared/types'

type AppRole = Enums<'app_role'>
type AppPermission = Enums<'app_permission'>

export function useOrganization() {
  const { data: memberships, isLoading: membershipsLoading } = useQuery(
    organizationQueries.myMemberships()
  )

  // v0.1.0: auto-select first org (multi-org switcher is future)
  const membership = memberships?.[0] ?? null
  const organization = membership?.organizations ?? null
  const role = (membership?.role ?? null) as AppRole | null
  const organizationId = organization?.id ?? ''

  const { data: permissionRows, isLoading: permissionsLoading } = useQuery(
    organizationQueries.permissions(organizationId)
  )

  // Build permission set for current user's role in this org
  const permissions = useMemo<AppPermission[]>(() => {
    if (!role || !permissionRows) return []
    return permissionRows
      .filter((rp) => rp.role === role)
      .map((rp) => rp.permission)
  }, [role, permissionRows])

  const permissionSet = useMemo(() => new Set(permissions), [permissions])

  function hasPermission(permission: AppPermission): boolean {
    return permissionSet.has(permission)
  }

  return {
    organization,
    role,
    permissions,
    hasPermission,
    hasOrg: !!organization,
    loading: membershipsLoading || permissionsLoading,
  }
}
