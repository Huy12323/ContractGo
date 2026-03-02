import { createFileRoute, Link } from '@tanstack/react-router'
import { LoginForm } from '@/components/auth/LoginForm'
import { Card, Typography } from 'antd'

export const Route = createFileRoute('/_auth/login')({
  component: LoginPage,
})

function LoginPage() {
  return (
    <Card style={{ width: 400 }}>
      <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
        Sign In to WorldCraft
      </Typography.Title>
      <LoginForm />
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Typography.Text>
          Don't have an account? <Link to="/signup">Sign Up</Link>
        </Typography.Text>
      </div>
    </Card>
  )
}
