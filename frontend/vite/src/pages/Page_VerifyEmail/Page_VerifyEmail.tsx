import { useState, useEffect } from 'react'
import { useSearch, useNavigate } from '@tanstack/react-router'
import { App, Button, Result, Typography, Spin, theme } from 'antd'
import { MailOutlined, TeamOutlined, LogoutOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { supabase } from '@/configs/supabase/config'
import { Store_Auth_Actions } from '@/stores/Store_Auth'

export const Page_VerifyEmail = () => {
  const { token: searchToken } = useSearch({ from: '/_auth/verify-email' })

  return searchToken ? <TokenVerification token={searchToken} /> : <WaitingForEmail />
}

// --- Mode 1: User clicked the email link ---

function TokenVerification({ token }: { token: string }) {
  const { token: themeToken } = theme.useToken()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const verify = async () => {
      try {
        const res = await supabase.functions.invoke('auth_verify-token', {
          body: { token, type: 'verification' },
        })
        if (res.error) throw res.error
        setStatus('success')
      } catch (err) {
        setStatus('error')
        setErrorMessage(err instanceof Error ? err.message : 'Invalid or expired verification link')
      }
    }
    verify()
  }, [token])

  if (status === 'verifying') {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0' }}>
        <Spin size="large" />
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          Verifying your email...
        </Typography.Paragraph>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <>
        <Logo themeToken={themeToken} />
        <Result
          icon={<CheckCircleOutlined style={{ color: themeToken.colorSuccess }} />}
          title="Email verified!"
          subTitle="Your email has been verified. You can now sign in."
          style={{ padding: '0 0 16px' }}
        />
        <Button type="primary" block size="large" onClick={() => navigate({ to: '/login', search: { redirect: undefined } })}>
          Sign In
        </Button>
      </>
    )
  }

  return (
    <>
      <Logo themeToken={themeToken} />
      <Result
        status="warning"
        title="Verification failed"
        subTitle={errorMessage}
        style={{ padding: '0 0 16px' }}
      />
      <Button type="primary" block size="large" onClick={() => navigate({ to: '/login', search: { redirect: undefined } })}>
        Go to Sign In
      </Button>
    </>
  )
}

// --- Mode 2: User just signed up, waiting for email ---

function WaitingForEmail() {
  const { token: themeToken } = theme.useToken()
  const { message: messageApi } = App.useApp()

  const [email, setEmail] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmail(data.user.email)
    })
  }, [])

  useEffect(() => {
    if (countdown <= 0) return
    const id = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) { clearInterval(id); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [countdown])

  const handleResend = async () => {
    if (resending) return
    setResending(true)
    try {
      const { error } = await supabase.functions.invoke('auth_send-verification', {
        body: { type: 'verification' },
      })
      if (error) throw error
      messageApi.success('Verification email sent!')
      setCountdown(60)
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : 'Failed to resend verification email')
    } finally {
      setResending(false)
    }
  }

  return (
    <>
      <Logo themeToken={themeToken} />
      <Result
        icon={<MailOutlined style={{ color: themeToken.colorPrimary }} />}
        title="Check your email"
        subTitle={
          email
            ? `We sent a verification link to ${email}. Click the link to activate your account.`
            : 'We sent a verification link to your email. Click the link to activate your account.'
        }
        style={{ padding: '0 0 16px' }}
      />

      <div style={{ textAlign: 'center' }}>
        <Button type="link" loading={resending} disabled={countdown > 0} onClick={handleResend}>
          {countdown > 0 ? `Resend (${countdown}s)` : 'Resend verification email'}
        </Button>
      </div>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Button
          type="text"
          icon={<LogoutOutlined />}
          onClick={() => Store_Auth_Actions.signOut()}
          style={{ fontSize: 13, color: themeToken.colorTextSecondary }}
        >
          Sign out
        </Button>
      </div>
    </>
  )
}

// --- Shared ---

function Logo({ themeToken }: { themeToken: { colorPrimary: string } }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 32 }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 10,
          background: themeToken.colorPrimary,
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
}
