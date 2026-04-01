import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Form, Input, Button, Result, Typography, theme } from 'antd'
import { LockOutlined, TeamOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { updatePassword } from '@/stores/auth'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/api/supabase'

export const Route = createFileRoute('/_auth/reset-password')({
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = theme.useToken()
  const { session } = useAuth()
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [isRecovery, setIsRecovery] = useState(false)
  const [checking, setChecking] = useState(true)
  const [form] = Form.useForm<{ password: string; confirm: string }>()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true)
      }
    })

    // If the user already has a session (tokens processed before mount),
    // check if we arrived via a recovery flow by inspecting the URL hash
    if (session) {
      const hash = window.location.hash
      if (hash.includes('type=recovery') || hash.includes('type=magiclink')) {
        setIsRecovery(true)
      }
    }

    // Give a brief window for the PASSWORD_RECOVERY event to fire
    const timer = setTimeout(() => setChecking(false), 500)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [session])

  // Also mark recovery when session appears after initial check
  useEffect(() => {
    if (session && checking) {
      setIsRecovery(true)
    }
  }, [session, checking])

  async function onFinish(values: { password: string }) {
    setLoading(true)
    try {
      await updatePassword(values.password)
      setSuccess(true)
    } catch (err) {
      form.setFields([{
        name: 'password',
        errors: [err instanceof Error ? err.message : 'Failed to update password'],
      }])
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

  if (checking) {
    return (
      <>
        {logo}
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Typography.Text type="secondary">Verifying reset link...</Typography.Text>
        </div>
      </>
    )
  }

  if (!session && !isRecovery) {
    return (
      <>
        {logo}
        <Result
          status="warning"
          title="Invalid or expired link"
          subTitle="This password reset link is no longer valid. Please request a new one."
          style={{ padding: '0 0 16px' }}
        />
        <div style={{ textAlign: 'center' }}>
          <Button type="primary" href="/forgot-password">
            Request New Reset Link
          </Button>
        </div>
      </>
    )
  }

  if (success) {
    return (
      <>
        {logo}
        <Result
          icon={<CheckCircleOutlined style={{ color: token.colorSuccess }} />}
          title="Password updated"
          subTitle="Your password has been reset successfully. You can now sign in with your new password."
          style={{ padding: '0 0 16px' }}
        />
        <div style={{ textAlign: 'center' }}>
          <Button type="primary" href="/login">
            Sign In
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      {logo}
      <Typography.Title level={5} style={{ textAlign: 'center', marginBottom: 4 }}>
        Set new password
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 24, fontSize: 13 }}>
        Enter your new password below.
      </Typography.Paragraph>

      <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="password"
          label="New Password"
          rules={[
            { required: true, message: 'Enter a password' },
            { min: 8, message: 'Password must be at least 8 characters' },
          ]}
        >
          <Input.Password prefix={<LockOutlined style={{ color: token.colorTextQuaternary }} />} placeholder="At least 8 characters" size="large" />
        </Form.Item>

        <Form.Item
          name="confirm"
          label="Confirm Password"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Confirm your password' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) return Promise.resolve()
                return Promise.reject(new Error('Passwords do not match'))
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined style={{ color: token.colorTextQuaternary }} />} placeholder="Re-enter password" size="large" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block size="large" loading={loading}>
          Reset Password
        </Button>
      </Form>
    </>
  )
}
