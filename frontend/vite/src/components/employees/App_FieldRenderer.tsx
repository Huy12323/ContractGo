import { Typography, Tag, Input, InputNumber, DatePicker, Switch, Select, theme } from 'antd'
import dayjs from 'dayjs'

export type App_FieldRenderer_State = 'hr' | 'mandatory' | 'optional'
export type App_FieldRenderer_Mode = 'fill' | 'readonly'

export const fieldStateTagColor = (state: App_FieldRenderer_State): string | undefined => {
    if (state === 'hr') return 'processing'
    if (state === 'mandatory') return 'error'
    return undefined
}

export const fieldStateTagLabel = (state: App_FieldRenderer_State): string => {
    if (state === 'hr') return 'HR-FILL'
    if (state === 'mandatory') return 'MANDATORY'
    return 'OPTIONAL'
}

type Props = {
    fieldKey: string
    fieldLabel: string
    fieldType: string
    state: App_FieldRenderer_State
    mode: App_FieldRenderer_Mode
    value: unknown
    onChange?: (value: unknown) => void
    choices?: Array<{ label: string; value: string }>
    disabled?: boolean
    /** When set, input renders with ANTD error status + red helper text below */
    error?: string
}

const isMeaningful = (v: unknown): boolean => v !== undefined && v !== null && v !== ''

const StateBadge = ({ state }: { state: App_FieldRenderer_State }) => (
    <Tag
        color={fieldStateTagColor(state)}
        style={{ margin: 0, fontSize: 10, letterSpacing: 0.4, lineHeight: '16px' }}
    >
        {fieldStateTagLabel(state)}
    </Tag>
)

const InputControl = ({
    fieldLabel,
    fieldType,
    value,
    onChange,
    choices,
    disabled,
    hasError,
}: {
    fieldLabel: string
    fieldType: string
    value: unknown
    onChange?: (value: unknown) => void
    choices?: Array<{ label: string; value: string }>
    disabled?: boolean
    hasError?: boolean
}) => {
    const status = hasError ? ('error' as const) : undefined
    const common = { size: 'small' as const, disabled, style: { width: '100%' }, status }
    switch (fieldType) {
        case 'number':
            return <InputNumber {...common} placeholder={fieldLabel} value={value as number | undefined} onChange={(v) => onChange?.(v)} />
        case 'date':
            return <DatePicker {...common} placeholder={fieldLabel} value={typeof value === 'string' && value ? dayjs(value) : null} onChange={(_d, ds) => onChange?.(ds)} />
        case 'boolean':
            return <Switch size="small" disabled={disabled} checked={!!value} onChange={(v) => onChange?.(v)} />
        case 'multi_select':
            return <Select {...common} placeholder={fieldLabel} options={choices ?? []} value={value as string | undefined} onChange={(v) => onChange?.(v)} />
        default:
            return <Input {...common} placeholder={fieldLabel} value={value as string | undefined} onChange={(e) => onChange?.(e.target.value)} />
    }
}

const ReadonlyDisplay = ({
    fieldLabel,
    fieldType,
    value,
    choices,
}: {
    fieldLabel: string
    fieldType: string
    value: unknown
    choices?: Array<{ label: string; value: string }>
}) => {
    const { token } = theme.useToken()
    const hasValue = isMeaningful(value)

    if (!hasValue) {
        return (
            <Typography.Text italic style={{ color: token.colorTextPlaceholder, fontSize: token.fontSizeSM }}>
                {fieldLabel}
            </Typography.Text>
        )
    }

    const text = (() => {
        if (fieldType === 'boolean') return value ? 'Yes' : 'No'
        if (fieldType === 'multi_select') {
            const match = (choices ?? []).find((c) => c.value === value)
            return match?.label ?? String(value)
        }
        return String(value)
    })()

    return <Typography.Text style={{ fontSize: token.fontSizeSM }}>{text}</Typography.Text>
}

export const App_FieldRenderer = ({
    fieldKey: _fieldKey,
    fieldLabel,
    fieldType,
    state,
    mode,
    value,
    onChange,
    choices,
    disabled,
    error,
}: Props) => {
    const { token } = theme.useToken()

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: token.marginXXS,
                padding: `${token.paddingXS}px ${token.paddingSM}px`,
                background: token.colorBgContainer,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusSM,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS, justifyContent: 'space-between' }}>
                <Typography.Text style={{ fontSize: 11 }}>
                    {fieldLabel}
                </Typography.Text>
                <StateBadge state={state} />
            </div>
            {mode === 'readonly' ? (
                <ReadonlyDisplay fieldLabel={fieldLabel} fieldType={fieldType} value={value} choices={choices} />
            ) : (
                <InputControl
                    fieldLabel={fieldLabel}
                    fieldType={fieldType}
                    value={value}
                    onChange={onChange}
                    choices={choices}
                    disabled={disabled}
                    hasError={!!error}
                />
            )}
            {error && (
                <Typography.Text type="danger" style={{ fontSize: 11 }}>
                    {error}
                </Typography.Text>
            )}
        </div>
    )
}
