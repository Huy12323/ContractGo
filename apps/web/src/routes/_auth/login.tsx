import { createFileRoute } from '@tanstack/react-router'
import { LoginForm } from '@/components/auth/LoginForm'
import { Typography, theme } from 'antd'
import { TeamOutlined } from '@ant-design/icons'

export const Route = createFileRoute('/_auth/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: LoginPage,
})

function LoginPage() {
  const { token } = theme.useToken()
  const { redirect } = Route.useSearch()

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            background: token.colorPrimary,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          <TeamOutlined style={{ fontSize: 24, color: '#fff' }} />
        </div>
        <Typography.Title level={4} style={{ marginBottom: 0 }}>
          AIUR-HR
        </Typography.Title>
        <Typography.Text type="secondary">Sign in to your workspace</Typography.Text>
      </div>
      <LoginForm redirect={redirect} />
    </>
  )
}
