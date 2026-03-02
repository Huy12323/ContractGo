import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/api/supabase'

export const profileQueries = {
  me: () =>
    queryOptions({
      queryKey: ['profile', 'me'],
      queryFn: async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('Not authenticated')

        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()

        if (error) throw error
        return data
      },
    }),

  list: () =>
    queryOptions({
      queryKey: ['profiles'],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false })

        if (error) throw error
        return data
      },
    }),
}
