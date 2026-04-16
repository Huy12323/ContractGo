import { useEffect, useState } from 'react'
import { Modal, Form, Input } from 'antd'

type Props = {
    open: boolean
    onClose: () => void
    title: string
    initialName: string
    submitLabel: string
    onSubmit: (name: string) => Promise<void>
}

export const PageEmployees_ViewNameModal = ({
    open,
    onClose,
    title,
    initialName,
    submitLabel,
    onSubmit,
}: Props) => {
    const [form] = Form.useForm<{ name: string }>()
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        if (open) form.setFieldsValue({ name: initialName })
    }, [open, initialName, form])

    const handleFinish = async ({ name }: { name: string }) => {
        const trimmed = name.trim()
        if (!trimmed) return
        setSubmitting(true)
        try {
            await onSubmit(trimmed)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Modal
            open={open}
            title={title}
            onCancel={() => { if (!submitting) onClose() }}
            onOk={() => form.submit()}
            okText={submitLabel}
            confirmLoading={submitting}
            destroyOnHidden
        >
            <Form
                form={form}
                layout="vertical"
                onFinish={handleFinish}
                initialValues={{ name: initialName }}
                style={{ marginTop: 16 }}
            >
                <Form.Item
                    name="name"
                    label="View name"
                    rules={[{ required: true, message: 'Name is required', transform: (v) => (v ?? '').trim() }]}
                >
                    <Input autoFocus placeholder="e.g. Engineering team" />
                </Form.Item>
                <button type="submit" hidden />
            </Form>
        </Modal>
    )
}
