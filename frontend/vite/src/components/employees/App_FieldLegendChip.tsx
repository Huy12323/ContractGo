import { Popover, Button, Tag, Typography, theme } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'

const LegendRow = ({ tagColor, label, description }: { tagColor?: string; label: string; description: string }) => {
    const { token } = theme.useToken()
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, paddingBlock: token.paddingXXS }}>
            <Tag
                color={tagColor}
                style={{ margin: 0, fontSize: 10, letterSpacing: 0.4, lineHeight: '16px', minWidth: 96, textAlign: 'center' }}
            >
                {label}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {description}
            </Typography.Text>
        </div>
    )
}

export const App_FieldLegendChip = () => {
    const { token } = theme.useToken()

    const content = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS, maxWidth: 360 }}>
            <LegendRow tagColor="processing" label="HR-FILL" description="HR pre-fills this. Employees can't change it." />
            <LegendRow tagColor="error" label="MANDATORY" description="Employees must fill this before submitting." />
            <LegendRow label="OPTIONAL" description="Employees can leave this blank." />
        </div>
    )

    return (
        <Popover content={content} trigger="click" placement="bottomLeft" title="Field states">
            <Button
                type="text"
                size="small"
                icon={<QuestionCircleOutlined />}
                aria-label="Field state legend"
            />
        </Popover>
    )
}
