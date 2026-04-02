import { useState } from 'react'
import { Form, Input, Button, Typography, Divider, theme } from 'antd'
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons'
import { Store_Auth_Actions } from '@/stores/Store_Auth'
import { useNavigate } from '@tanstack/react-router'

interface SignUpValues {
  fullName: string
  email: string
  password: string
  confirmPassword: string
}

export const App_SignUpForm = () => {
  const [loading, setLoading] = useState(false)
  const { token } = theme.useToken()
  const navigate = useNavigate()
  const [form] = Form.useForm<SignUpValues>()

  async function onFinish(values: SignUpValues) {
    setLoading(true)
    try {
      await Store_Auth_Actions.signUp(values.email, values.password, values.fullName)
      navigate({ to: '/verify-email', search: { email: values.email } })
    } catch (err) {
      form.setFields([{
        name: 'email',
        errors: [err instanceof Error ? err.message : 'Sign up failed'],
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
      <Form.Item
        name="fullName"
        label="Full Name"
        rules={[{ required: true, message: 'Enter your full name' }]}
      >
        <Input prefix={<UserOutlined style={{ color: token.colorTextQuaternary }} />} placeholder="Jane Smith" size="large" />
      </Form.Item>

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

      <Form.Item
        name="password"
        label="Password"
        rules={[
          { required: true, message: 'Enter a password' },
          { min: 8, message: 'At least 8 characters' },
        ]}
      >
        <Input.Password prefix={<LockOutlined style={{ color: token.colorTextQuaternary }} />} placeholder="Min. 8 characters" size="large" />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        label="Confirm Password"
        dependencies={['password']}
        rules={[
          { required: true, message: 'Confirm your password' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) {
                return Promise.resolve()
              }
              return Promise.reject(new Error("Passwords don't match"))
            },
          }),
        ]}
      >
        <Input.Password prefix={<LockOutlined style={{ color: token.colorTextQuaternary }} />} placeholder="Re-enter password" size="large" />
      </Form.Item>

      <Button type="primary" htmlType="submit" block size="large" loading={loading} style={{ marginTop: 8 }}>
        Create Account
      </Button>

      <Typography.Paragraph type="secondary" style={{ textAlign: 'center', margin: '12px 0 0', fontSize: 12 }}>
        By creating an account, you agree to our Terms of Service and Privacy Policy.
      </Typography.Paragraph>

      <Divider plain style={{ margin: '20px 0' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>OR</Typography.Text>
      </Divider>

      <Button block size="large" onClick={() => navigate({ to: '/login', search: { redirect: undefined } })}>
        Sign in to existing account
      </Button>
    </Form>
  )
}
