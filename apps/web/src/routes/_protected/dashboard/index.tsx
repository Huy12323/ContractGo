import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Card, Typography, Descriptions, Spin, Alert, Tag } from 'antd'
import { profileQueries } from '@/api/queries/profiles'
import { useAuth } from '@/hooks/use-auth'

export const Route = createFileRoute('/_protected/dashboard/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { user } = useAuth()
  const { data: profile, isLoading, error } = useQuery(profileQueries.me())

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
        {isLoading && <Spin />}
        {error && (
          <Alert
            type="warning"
            message="Profile not found"
            description="Your profile will be created automatically. Try refreshing."
          />
        )}
        {profile && (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="Full Name">
              {profile.full_name ?? '(not set)'}
            </Descriptions.Item>
            <Descriptions.Item label="Email">{profile.email}</Descriptions.Item>
            <Descriptions.Item label="Created">
              {new Date(profile.created_at).toLocaleDateString()}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>
    </div>
  )
}
