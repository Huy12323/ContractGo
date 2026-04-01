import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Form, Input, Button, Typography, theme } from 'antd'
import { TeamOutlined, BankOutlined } from '@ant-design/icons'
import { supabase } from '@/api/supabase'
import { queryClient } from '@/lib/query-client'
import { signOut } from '@/stores/auth'

export const Route = createFileRoute('/_auth/setup-organization')({
  component: SetupOrganizationPage,
})

function SetupOrganizationPage() {
  const { token } = theme.useToken()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<{ name: string }>()

  async function onFinish(values: { name: string }) {
    setLoading(true)
    try {
      // Atomic RPC: creates org + owner membership + seeds permissions
      const { error } = await supabase.rpc('create_organization', { org_name: values.name })

      if (error) throw error

      // Invalidate queries and navigate
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      navigate({ to: '/dashboard' })
    } catch (err) {
      form.setFields([{
        name: 'name',
        errors: [err instanceof Error ? err.message : 'Failed to create organization'],
      }])
    } finally {
      setLoading(false)
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
        <Typography.Text type="secondary">Set up your organization</Typography.Text>
      </div>

      <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 24, fontSize: 13 }}>
        Create your organization to get started. You'll be the owner with full access.
      </Typography.Paragraph>

      <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="name"
          label="Organization Name"
          rules={[{ required: true, message: 'Enter your organization name' }]}
        >
          <Input prefix={<BankOutlined style={{ color: token.colorTextQuaternary }} />} placeholder="Acme Inc." size="large" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block size="large" loading={loading}>
          Create Organization
        </Button>
      </Form>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          Wrong account?{' '}
          <Typography.Link onClick={() => signOut()}>Sign out</Typography.Link>
        </Typography.Text>
      </div>
    </>
  )
}
