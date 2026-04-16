import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { Layout } from 'antd'
import { App_VerticalNav } from '@/components/app-shell/App_VerticalNav'
import { App_HorizontalNav } from '@/components/app-shell/App_HorizontalNav/App_HorizontalNav'
import { supabase } from '@/configs/supabase/config'
import { const_AppShell_HorizontalNavHeight } from '@/components/app-shell/const_AppShell_Dimensions'

const { Content } = Layout


export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({ location }) => {
    const sb_Auth_GetSession = await supabase.auth.getSession()
    const session = sb_Auth_GetSession.data.session

    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    // Check email verification
    const sb_FromProfiles_Select = await supabase
      .from('profiles')
      .select('email_verified')
      .eq('id', session.user.id)
      .single()

    if (sb_FromProfiles_Select.data && !sb_FromProfiles_Select.data.email_verified) {
      throw redirect({ to: '/verify-email', search: { redirect: location.href } })
    }

  },
  component: ProtectedLayout,
})

function ProtectedLayout() {
  return (
    <Layout style={{ height: '100vh' }}>
      <App_HorizontalNav />

      <Layout style={{ height: `calc(100vh - ${const_AppShell_HorizontalNavHeight}px)` }}>
        <App_VerticalNav />

        <Content style={{ overflowY: 'auto', overflowX: 'hidden' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
