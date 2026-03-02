import { useState } from 'react'
import { Form, Input, Button, App } from 'antd'
import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { signInWithPassword } from '@/stores/auth'
import { useNavigate } from '@tanstack/react-router'

interface LoginValues {
  email: string
  password: string
}

export function LoginForm() {
  const [loading, setLoading] = useState(false)
  const { message } = App.useApp()
  const navigate = useNavigate()

  async function onFinish(values: LoginValues) {
    setLoading(true)
    try {
      await signInWithPassword(values.email, values.password)
      navigate({ to: '/dashboard' })
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Form layout="vertical" onFinish={onFinish} autoComplete="off">
      <Form.Item
        name="email"
        rules={[
          { required: true, message: 'Please enter your email' },
          { type: 'email', message: 'Please enter a valid email' },
        ]}
      >
        <Input prefix={<MailOutlined />} placeholder="Email" size="large" />
      </Form.Item>

      <Form.Item
        name="password"
        rules={[{ required: true, message: 'Please enter your password' }]}
      >
        <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
      </Form.Item>

      <Form.Item>
        <Button type="primary" htmlType="submit" loading={loading} block size="large">
          Sign In
        </Button>
      </Form.Item>
    </Form>
  )
}
