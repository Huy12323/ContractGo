import { useState, useEffect } from 'react'
import { useSearch, useNavigate } from '@tanstack/react-router'
import { Button, Typography, Spin, theme } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, TeamOutlined, SwapOutlined } from '@ant-design/icons'
import { supabase } from '@/configs/supabase/config'
import { useStore_Auth_User, useStore_Auth_Session, useStore_Auth_Loading } from '@/stores/Store_Auth'
import { queryClient } from '@/lib/query-client'
import { QueryKeys } from '@/utils/query/queryKeys'
import { Store_Auth_Actions } from '@/stores/Store_Auth'

interface InvitationData {
  id: string
  email: string
  status: string
  expires_at: string
  created_at: string
  organization_name: string
  organization_id: string
  expired: boolean
}

export const Page_Invitation = () => {
  const { token: invToken } = useSearch({ from: '/_auth/invitation' })
  const { token } = theme.useToken()
  const user = useStore_Auth_User()
  const session = useStore_Auth_Session()
  const authLoading = useStore_Auth_Loading()
  const isAuthenticated = !!session
  const navigate = useNavigate()

  const [invitation, setInvitation] = useState<InvitationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!invToken) {
      setError('No invitation token provided')
      setLoading(false)
      return
    }

    async function fetchInvitation() {
      const sb_RpcGetInvitationByToken = await supabase.rpc('get_invitation_by_token', {
        invitation_token: invToken!,
      })

      if (sb_RpcGetInvitationByToken.error || !sb_RpcGetInvitationByToken.data) {
        setError('Invitation not found or has been cancelled')
        setLoading(false)
        return
      }

      setInvitation(sb_RpcGetInvitationByToken.data as unknown as InvitationData)
      setLoading(false)
    }

    fetchInvitation()
  }, [invToken])

  async function handleAccept() {
    if (!invToken) return
    setAccepting(true)
    try {
      const sb_RpcAcceptInvitation = await supabase.rpc('accept_invitation', {
        invitation_token: invToken,
      })

      if (sb_RpcAcceptInvitation.error) throw sb_RpcAcceptInvitation.error

      setAccepted(true)
      queryClient.invalidateQueries({ queryKey: QueryKeys.organizations.all() })

      setTimeout(() => {
        navigate({ to: '/' })
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation')
    } finally {
      setAccepting(false)
    }
  }

  function handleSwitchAccount() {
    Store_Auth_Actions.signOutAndRedirect(`/invitation?token=${invToken}`)
  }

  if (authLoading || loading) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Spin size="large" />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div style={{ textAlign: 'center' }}>
        <CloseCircleOutlined style={{ fontSize: 48, color: token.colorError, marginBottom: 16 }} />
        <Typography.Title level={4}>Something went wrong</Typography.Title>
        <Typography.Text type="secondary">{error}</Typography.Text>
        <div style={{ marginTop: 24 }}>
          <Button type="primary" onClick={() => navigate({ to: isAuthenticated ? '/' : '/login' })}>
            {isAuthenticated ? 'Go to Home' : 'Go to Login'}
          </Button>
        </div>
      </div>
    )
  }

  // Accepted state
  if (accepted) {
    return (
      <div style={{ textAlign: 'center' }}>
        <CheckCircleOutlined style={{ fontSize: 48, color: token.colorSuccess, marginBottom: 16 }} />
        <Typography.Title level={4}>Welcome aboard!</Typography.Title>
        <Typography.Text type="secondary">
          You're now an admin of {invitation?.organization_name}. Redirecting...
        </Typography.Text>
      </div>
    )
  }

  if (!invitation) return null

  // Already accepted — redirect to home (they're already a member)
  if (invitation.status === 'accepted') {
    return (
      <div style={{ textAlign: 'center' }}>
        <CheckCircleOutlined style={{ fontSize: 48, color: token.colorSuccess, marginBottom: 16 }} />
        <Typography.Title level={4}>Already a member</Typography.Title>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          You've already joined <strong>{invitation.organization_name}</strong>.
        </Typography.Text>
        <Button type="primary" onClick={() => navigate({ to: isAuthenticated ? '/' : '/login' })}>
          {isAuthenticated ? 'Go to Home' : 'Sign in'}
        </Button>
      </div>
    )
  }

  // Rejected — show declined message
  if (invitation.status === 'rejected') {
    return (
      <div style={{ textAlign: 'center' }}>
        <CloseCircleOutlined style={{ fontSize: 48, color: token.colorWarning, marginBottom: 16 }} />
        <Typography.Title level={4}>Invitation declined</Typography.Title>
        <Typography.Text type="secondary">
          This invitation to <strong>{invitation.organization_name}</strong> was declined. Contact the organization owner if this was a mistake.
        </Typography.Text>
      </div>
    )
  }

  // Expired
  if (invitation.expired) {
    return (
      <div style={{ textAlign: 'center' }}>
        <CloseCircleOutlined style={{ fontSize: 48, color: token.colorWarning, marginBottom: 16 }} />
        <Typography.Title level={4}>Invitation expired</Typography.Title>
        <Typography.Text type="secondary">
          Please ask the organization owner to send a new invitation.
        </Typography.Text>
      </div>
    )
  }

  // Not authenticated — show invitation details + sign in prompt
  if (!isAuthenticated) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 48, height: 48, borderRadius: 10, background: token.colorPrimary,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}
        >
          <TeamOutlined style={{ fontSize: 24, color: '#fff' }} />
        </div>
        <Typography.Title level={4} style={{ marginBottom: 4 }}>
          You're invited!
        </Typography.Title>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          Join <strong>{invitation.organization_name}</strong> as an admin
        </Typography.Text>
        <Button
          type="primary"
          size="large"
          block
          onClick={() =>
            navigate({
              to: '/login',
              search: { redirect: `/invitation?token=${invToken}` },
            })
          }
        >
          Sign in to accept
        </Button>
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Don't have an account?{' '}
            <Typography.Link onClick={() => navigate({ to: '/signup', search: { redirect: `/invitation?token=${invToken}` } })}>
              Sign up
            </Typography.Link>
          </Typography.Text>
        </div>
      </div>
    )
  }

  // Authenticated but email mismatch
  if (user?.email?.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 48, height: 48, borderRadius: 10, background: token.colorWarning,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}
        >
          <SwapOutlined style={{ fontSize: 24, color: '#fff' }} />
        </div>
        <Typography.Title level={4}>Different account needed</Typography.Title>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          This invitation to <strong>{invitation.organization_name}</strong> was sent to <strong>{invitation.email}</strong>
        </Typography.Text>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          You're signed in as <strong>{user?.email}</strong>
        </Typography.Text>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Button onClick={() => navigate({ to: '/' })}>
            Go to Home
          </Button>
          <Button type="primary" icon={<SwapOutlined />} onClick={handleSwitchAccount}>
            Switch Account
          </Button>
        </div>
      </div>
    )
  }

  // Authenticated + email matches — show accept
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          width: 48, height: 48, borderRadius: 10, background: token.colorPrimary,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        }}
      >
        <TeamOutlined style={{ fontSize: 24, color: '#fff' }} />
      </div>
      <Typography.Title level={4} style={{ marginBottom: 4 }}>
        You're invited!
      </Typography.Title>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Join <strong>{invitation.organization_name}</strong> as an admin
      </Typography.Text>
      <Button type="primary" size="large" block loading={accepting} onClick={handleAccept}>
        Accept Invitation
      </Button>
    </div>
  )
}
