import { createFileRoute } from '@tanstack/react-router'
import { App_SignUpForm } from '@/components/auth/App_SignUpForm'
import { Typography, theme } from 'antd'
import { TeamOutlined } from '@ant-design/icons'

export const Route = createFileRoute('/_auth/signup')({
  component: SignUpPage,
})

function SignUpPage() {
  const { token } = theme.useToken()

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
        <Typography.Text type="secondary">Create your workspace</Typography.Text>
      </div>
      <App_SignUpForm />
    </>
  )
}
