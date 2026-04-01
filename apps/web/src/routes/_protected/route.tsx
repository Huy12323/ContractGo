import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useAuth } from '@/hooks/use-auth'
import { useOrganization } from '@/hooks/use-organization'
import { Layout, Button, Typography, Spin, Tag } from 'antd'
import { signOut } from '@/stores/auth'
import { supabase } from '@/api/supabase'

const { Header, Content } = Layout

const ROLE_COLORS: Record<string, string> = {
  owner: 'gold',
  admin: 'blue',
  manager: 'green',
  employee: 'default',
}

export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({ location }) => {
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    if (!session.user.email_confirmed_at) {
      throw redirect({
        to: '/verify-email',
        search: { email: session.user.email ?? undefined },
      })
    }

    // Check org membership
    const { data: memberships } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', session.user.id)
      .limit(1)

    if (!memberships || memberships.length === 0) {
      throw redirect({ to: '/setup-organization' })
    }
  },
  component: ProtectedLayout,
})

function ProtectedLayout() {
  const { user, loading: authLoading } = useAuth()
  const { organization, role, loading: orgLoading } = useOrganization()

  if (authLoading || orgLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ color: 'white', margin: 0 }}>
          AIUR-HR
        </Typography.Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {organization && (
            <Tag color="geekblue" style={{ margin: 0 }}>{organization.name}</Tag>
          )}
          {role && (
            <Tag color={ROLE_COLORS[role] ?? 'default'} style={{ margin: 0 }}>
              {role.charAt(0).toUpperCase() + role.slice(1)}
            </Tag>
          )}
          <Typography.Text style={{ color: 'rgba(255,255,255,0.65)' }}>
            {user?.email}
          </Typography.Text>
          <Button type="text" style={{ color: 'white' }} onClick={() => signOut()}>
            Sign Out
          </Button>
        </div>
      </Header>
      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </Layout>
  )
}
