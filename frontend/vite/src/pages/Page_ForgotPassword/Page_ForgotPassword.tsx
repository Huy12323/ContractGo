import { useState } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { Form, Input, Button, Typography, theme } from 'antd'
import { MailOutlined, TeamOutlined, SafetyOutlined } from '@ant-design/icons'
import { Store_Auth_Actions } from '@/stores/Store_Auth'

export const Page_ForgotPassword = () => {
  const { token } = theme.useToken()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [sent, setSent] = useState(false)
  const [email, setEmail] = useState('')
  const [emailForm] = Form.useForm<{ email: string }>()
  const [codeForm] = Form.useForm<{ code: string }>()

  async function onSendEmail(values: { email: string }) {
    setLoading(true)
    try {
      await Store_Auth_Actions.resetPasswordForEmail(values.email)
    } catch {
      // silently succeed — don't reveal if email exists
    } finally {
      setEmail(values.email)
      setSent(true)
      setLoading(false)
    }
  }

  async function onVerifyCode(values: { code: string }) {
    setVerifying(true)
    try {
      await Store_Auth_Actions.verifyRecoveryOtp(email, values.code.trim())
      navigate({ to: '/reset-password' })
    } catch {
      codeForm.setFields([{
        name: 'code',
        errors: ['Invalid or expired code. Please try again.'],
      }])
    } finally {
      setVerifying(false)
    }
  }

  async function handleResend() {
    setLoading(true)
    try {
      await Store_Auth_Actions.resetPasswordForEmail(email)
    } catch {
      // silently succeed
    } finally {
      setLoading(false)
    }
  }

  const logo = (
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
  )

  if (sent) {
    return (
      <>
        {logo}
        <Typography.Title level={5} style={{ textAlign: 'center', marginBottom: 4 }}>
          Check your email
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 24, fontSize: 13 }}>
          We sent a reset link and code to <strong>{email}</strong>. Enter the 6-digit code below, or click the link in the email.
        </Typography.Paragraph>

        <Form form={codeForm} layout="vertical" onFinish={onVerifyCode} requiredMark={false}>
          <Form.Item
            name="code"
            label="Reset Code"
            rules={[{ required: true, message: 'Enter the 6-digit code' }]}
          >
            <Input
              prefix={<SafetyOutlined style={{ color: token.colorTextQuaternary }} />}
              placeholder="Enter 6-digit code"
              size="large"
              maxLength={6}
              style={{ textAlign: 'center', letterSpacing: 8, fontSize: 18, fontWeight: 600 }}
            />
          </Form.Item>

          <Button type="primary" htmlType="submit" block size="large" loading={verifying}>
            Verify Code
          </Button>
        </Form>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Button type="link" size="small" loading={loading} onClick={handleResend}>
            Didn't receive it? Resend
          </Button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            <Link to="/login" search={{ redirect: undefined }}>Back to sign in</Link>
          </Typography.Text>
        </div>
      </>
    )
  }

  return (
    <>
      {logo}
      <Typography.Title level={5} style={{ textAlign: 'center', marginBottom: 4 }}>
        Reset your password
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 24, fontSize: 13 }}>
        Enter your email and we'll send you a code to reset your password.
      </Typography.Paragraph>

      <Form form={emailForm} layout="vertical" onFinish={onSendEmail} requiredMark={false}>
        <Form.Item
          name="email"
          label="Work Email"
          rules={[
            { required: true, message: 'Enter your email' },
            { type: 'email', message: 'Enter a valid email' },
          ]}
        >
          <Input prefix={<MailOutlined style={{ color: token.colorTextQuaternary }} />} placeholder="you@company.com" size="large" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block size="large" loading={loading}>
          Send Reset Code
        </Button>
      </Form>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          Remember your password?{' '}
          <Link to="/login" search={{ redirect: undefined }}>Sign in</Link>
        </Typography.Text>
      </div>
    </>
  )
}
