import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Button, Result, Typography, theme } from 'antd'
import { MailOutlined, TeamOutlined } from '@ant-design/icons'
import { Store_Auth_Actions } from '@/stores/Store_Auth'

export const Route = createFileRoute('/_auth/verify-email')({
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === 'string' ? search.email : undefined,
  }),
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { email } = Route.useSearch()
  const { token } = theme.useToken()
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  async function handleResend() {
    if (!email) return
    setResending(true)
    try {
      await Store_Auth_Actions.resendVerification(email)
      setResent(true)
    } catch {
      // silently fail — don't reveal if email exists
    } finally {
      setResending(false)
    }
  }

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
      </div>

      <Result
        icon={<MailOutlined style={{ color: token.colorPrimary }} />}
        title="Check your email"
        subTitle={
          email
            ? `We sent a verification link to ${email}. Click the link to activate your account.`
            : 'We sent a verification link to your email. Click the link to activate your account.'
        }
        style={{ padding: '0 0 16px' }}
      />

      {email && (
        <div style={{ textAlign: 'center' }}>
          {resent ? (
            <Typography.Text type="success">Verification email resent!</Typography.Text>
          ) : (
            <Button type="link" loading={resending} onClick={handleResend}>
              Didn't receive the email? Resend
            </Button>
          )}
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          Already verified?{' '}
          <Typography.Link href="/login">Sign in</Typography.Link>
        </Typography.Text>
      </div>
    </>
  )
}
