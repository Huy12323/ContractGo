import { Segmented } from 'antd'

interface App_ViewSwitcherMockProps {
  collapsed: boolean
}

export const App_ViewSwitcherMock = ({ collapsed }: App_ViewSwitcherMockProps) => {
  if (collapsed) return null

  return (
    <div style={{ padding: '8px 16px' }}>
      <Segmented
        block
        options={['Admin', 'Employee']}
        defaultValue="Admin"
        disabled
        size="small"
        style={{ opacity: 0.5 }}
      />
    </div>
  )
}
