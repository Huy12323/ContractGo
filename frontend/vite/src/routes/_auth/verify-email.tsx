import { createFileRoute, redirect } from '@tanstack/react-router'
import { supabase } from '@/configs/supabase/config'
import { Page_VerifyEmail } from '@/pages/Page_VerifyEmail/Page_VerifyEmail'

export const Route = createFileRoute('/_auth/verify-email')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  beforeLoad: async ({ search }) => {
    // If there's a token param, let the page handle verification — don't redirect
    if (search.token) return

    // If user has a session, check if already verified — redirect out if so
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email_verified')
        .eq('id', session.user.id)
        .single()

      if (profile?.email_verified) {
        throw redirect({ to: '/' })
      }
    }
  },
  component: Page_VerifyEmail,
})
