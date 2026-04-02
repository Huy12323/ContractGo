import { createFileRoute } from '@tanstack/react-router'
import { Card, Typography, Descriptions, Spin, Alert, Tag } from 'antd'
import { useQ_Me } from '@/hooks/useQ_Me'
import { useStore_Auth_User } from '@/stores/Store_Auth'

export const Route = createFileRoute('/_protected/dashboard/')({
  component: DashboardPage,
})

function DashboardPage() {
  const user = useStore_Auth_User()
  const qMe = useQ_Me()

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Typography.Title level={2}>Dashboard</Typography.Title>

      <Card title="Auth Status" style={{ marginBottom: 16 }}>
        <Descriptions column={1} bordered>
          <Descriptions.Item label="Status">
            <Tag color="green">Authenticated</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="User ID">{user?.id}</Descriptions.Item>
          <Descriptions.Item label="Email">{user?.email}</Descriptions.Item>
          <Descriptions.Item label="Provider">
            {user?.app_metadata?.provider ?? 'email'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Profile (from Supabase)">
        {qMe.query.isLoading && <Spin />}
        {qMe.query.error && (
          <Alert
            type="warning"
            message="Profile not found"
            description="Your profile will be created automatically. Try refreshing."
          />
        )}
        {qMe.profile && (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="Full Name">
              {qMe.profile.full_name ?? '(not set)'}
            </Descriptions.Item>
            <Descriptions.Item label="Email">{qMe.profile.email}</Descriptions.Item>
            <Descriptions.Item label="Created">
              {new Date(qMe.profile.created_at).toLocaleDateString()}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>
    </div>
  )
}
