import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/api/supabase'

export const organizationQueries = {
  myMemberships: () =>
    queryOptions({
      queryKey: ['organizations', 'my-memberships'],
      queryFn: async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('Not authenticated')

        const { data, error } = await supabase
          .from('organization_members')
          .select('id, role, organization_id, organizations(id, name)')
          .eq('user_id', user.id)

        if (error) throw error
        return data
      },
    }),

  permissions: (organizationId: string) =>
    queryOptions({
      queryKey: ['organizations', organizationId, 'permissions'],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('organization_role_permissions')
          .select('role, permission')
          .eq('organization_id', organizationId)

        if (error) throw error
        return data
      },
      enabled: !!organizationId,
    }),
}
