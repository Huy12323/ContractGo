import { createFileRoute, Link } from '@tanstack/react-router'
import { SignUpForm } from '@/components/auth/SignUpForm'
import { Card, Typography } from 'antd'

export const Route = createFileRoute('/_auth/signup')({
  component: SignUpPage,
})

function SignUpPage() {
  return (
    <Card style={{ width: 400 }}>
      <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
        Create Account
      </Typography.Title>
      <SignUpForm />
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Typography.Text>
          Already have an account? <Link to="/login">Sign In</Link>
        </Typography.Text>
      </div>
    </Card>
  )
}
