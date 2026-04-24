import { Dropdown, Tag, theme } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import { fieldStateTagColor, fieldStateTagLabel, type App_FieldRenderer_State } from './App_FieldRenderer'

const STATES: App_FieldRenderer_State[] = ['optional', 'mandatory', 'hr']

type Props = {
    state: App_FieldRenderer_State
    onChange: (nextState: App_FieldRenderer_State) => void
    disabled?: boolean
}

export const App_FieldStateDropdown = ({ state, onChange, disabled }: Props) => {
    const { token } = theme.useToken()

    const items = STATES.map((s) => ({
        key: s,
        label: (
            <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, minWidth: 140 }}>
                <Tag
                    color={fieldStateTagColor(s)}
                    style={{ margin: 0, fontSize: 10, letterSpacing: 0.4, lineHeight: '16px' }}
                >
                    {fieldStateTagLabel(s)}
                </Tag>
                {s === state && (
                    <CheckOutlined style={{ fontSize: 12, color: token.colorPrimary, marginLeft: 'auto' }} />
                )}
            </div>
        ),
        onClick: () => onChange(s),
    }))

    return (
        <Dropdown menu={{ items }} trigger={['click']} disabled={disabled}>
            <Tag
                color={fieldStateTagColor(state)}
                style={{
                    margin: 0,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    fontSize: 10,
                    letterSpacing: 0.4,
                    lineHeight: '16px',
                    userSelect: 'none',
                    opacity: disabled ? 0.6 : 1,
                }}
                onClick={(e) => e.stopPropagation()}
                title={disabled ? undefined : `Currently ${fieldStateTagLabel(state)} — click to change`}
            >
                {fieldStateTagLabel(state)}
            </Tag>
        </Dropdown>
    )
}
