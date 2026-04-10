import { useRef, useState } from 'react'
import { Button, Segmented, Typography, Upload, theme, App } from 'antd'
import { ClearOutlined, UploadOutlined } from '@ant-design/icons'
import SignatureCanvas from 'react-signature-canvas'
import type { UploadProps } from 'antd'

type Mode = 'draw' | 'upload'

type Props = {
    value: string | null
    onChange: (dataUrl: string | null) => void
    height?: number
}

const PAD_WIDTH = 480
const DEFAULT_HEIGHT = 180

export const App_SignaturePad = ({ value, onChange, height = DEFAULT_HEIGHT }: Props) => {
    const { token } = theme.useToken()
    const { message } = App.useApp()
    const [mode, setMode] = useState<Mode>('draw')
    const sigCanvasRef = useRef<SignatureCanvas | null>(null)

    const handleDrawEnd = () => {
        const sig = sigCanvasRef.current
        if (!sig || sig.isEmpty()) {
            onChange(null)
            return
        }
        onChange(sig.toDataURL('image/png'))
    }

    const handleClear = () => {
        sigCanvasRef.current?.clear()
        onChange(null)
    }

    const uploadProps: UploadProps = {
        accept: 'image/png,image/jpeg',
        showUploadList: false,
        beforeUpload: (file) => {
            const reader = new FileReader()
            reader.onload = () => {
                const result = reader.result
                if (typeof result === 'string') onChange(result)
                else message.error('Failed to read signature image')
            }
            reader.onerror = () => message.error('Failed to read signature image')
            reader.readAsDataURL(file)
            return false
        },
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography.Text strong>Signature</Typography.Text>
                <Segmented<Mode>
                    size="small"
                    value={mode}
                    onChange={(v) => {
                        setMode(v)
                        onChange(null)
                        sigCanvasRef.current?.clear()
                    }}
                    options={[
                        { label: 'Draw', value: 'draw' },
                        { label: 'Upload', value: 'upload' },
                    ]}
                />
            </div>

            {mode === 'draw' && (
                <div
                    style={{
                        width: PAD_WIDTH,
                        height,
                        maxWidth: '100%',
                        border: `1px dashed ${token.colorBorder}`,
                        borderRadius: token.borderRadiusSM,
                        background: token.colorBgContainer,
                        position: 'relative',
                    }}
                >
                    <SignatureCanvas
                        ref={(ref) => {
                            sigCanvasRef.current = ref
                        }}
                        penColor={token.colorText}
                        canvasProps={{
                            width: PAD_WIDTH,
                            height,
                            style: { width: '100%', height: '100%', display: 'block' },
                        }}
                        onEnd={handleDrawEnd}
                    />
                </div>
            )}

            {mode === 'upload' && (
                <div
                    style={{
                        width: PAD_WIDTH,
                        maxWidth: '100%',
                        minHeight: height,
                        border: `1px dashed ${token.colorBorder}`,
                        borderRadius: token.borderRadiusSM,
                        background: token.colorBgContainer,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: token.paddingSM,
                    }}
                >
                    {value ? (
                        <img
                            src={value}
                            alt="Uploaded signature"
                            style={{ maxWidth: '100%', maxHeight: height, objectFit: 'contain' }}
                        />
                    ) : (
                        <Upload {...uploadProps}>
                            <Button icon={<UploadOutlined />}>Upload signature image</Button>
                        </Upload>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                    size="small"
                    icon={<ClearOutlined />}
                    onClick={handleClear}
                    disabled={!value}
                >
                    Clear
                </Button>
            </div>
        </div>
    )
}
