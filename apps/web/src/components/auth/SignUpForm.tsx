import { useState } from 'react'
import { Form, Input, Button, App } from 'antd'
import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { signUp } from '@/stores/auth'

interface SignUpValues {
  email: string
  password: string
  confirm: string
}

export function SignUpForm() {
  const [loading, setLoading] = useState(false)
  const { message } = App.useApp()

  async function onFinish(values: SignUpValues) {
    setLoading(true)
    try {
      await signUp(values.email, values.password)
      message.success('Account created! You can now sign in.')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Sign up failed')
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
        rules={[
          { required: true, message: 'Please enter a password' },
          { min: 6, message: 'Password must be at least 6 characters' },
        ]}
      >
        <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
      </Form.Item>

      <Form.Item
        name="confirm"
        dependencies={['password']}
        rules={[
          { required: true, message: 'Please confirm your password' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) {
                return Promise.resolve()
              }
              return Promise.reject(new Error('Passwords do not match'))
            },
          }),
        ]}
      >
        <Input.Password prefix={<LockOutlined />} placeholder="Confirm Password" size="large" />
      </Form.Item>

      <Form.Item>
        <Button type="primary" htmlType="submit" loading={loading} block size="large">
          Create Account
        </Button>
      </Form.Item>
    </Form>
  )
}
