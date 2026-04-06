import { createFileRoute, redirect } from '@tanstack/react-router'
import { supabase } from '@/configs/supabase/config'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const sb_Auth_GetSession = await supabase.auth.getSession()
    if (sb_Auth_GetSession.data.session) {
      throw redirect({ to: '/home' })
    }
    throw redirect({ to: '/login', search: { redirect: undefined } })
  },
})
