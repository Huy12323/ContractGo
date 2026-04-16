import { useMemo, useRef, useState } from 'react'
import { Typography, Button, Input, Dropdown, theme } from 'antd'
import {
    PlusOutlined,
    SearchOutlined,
    MoreOutlined,
    EditOutlined,
    CopyOutlined,
    DeleteOutlined,
    TableOutlined,
    HolderOutlined,
} from '@ant-design/icons'
import { useSearch, useNavigate } from '@tanstack/react-router'
import { useQ_Tables_OrgEmployeeViews, type Tables_OrgEmployeeViews_QueryData } from '@/hooks/useQ_Tables_OrgEmployeeViews'

type EmployeeViewRow = Tables_OrgEmployeeViews_QueryData[number]

type Props = {
    organizationId: string
    onCreateView: () => void
    onRenameView: (view: EmployeeViewRow) => void
    onDuplicateView: (view: EmployeeViewRow) => void
    onDeleteView: (view: EmployeeViewRow) => void
    onReorderViews: (orderedIds: string[]) => void
}

export const PageEmployees_ViewsSidebar = ({
    organizationId,
    onCreateView,
    onRenameView,
    onDuplicateView,
    onDeleteView,
    onReorderViews,
}: Props) => {
    const { token } = theme.useToken()
    const search = useSearch({ from: '/_protected/$organizationId/employees/' })
    const navigate = useNavigate()
    const qViews = useQ_Tables_OrgEmployeeViews({ organizationId })

    const [filter, setFilter] = useState<string>('')
    const [dragOver, setDragOver] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
    const dragIdRef = useRef<string | null>(null)

    const filteredViews = useMemo(() => {
        const q = filter.trim().toLowerCase()
        if (!q) return qViews.employeeViews
        return qViews.employeeViews.filter((v) => v.name.toLowerCase().includes(q))
    }, [qViews.employeeViews, filter])

    const activeViewId = search.viewId

    // Drag-to-reorder is disabled while a search filter is active (user would be reordering a subset, not the full list)
    const dragEnabled = filter.trim().length === 0

    const handleDragStart = (e: React.DragEvent, viewId: string) => {
        if (!dragEnabled) return
        dragIdRef.current = viewId
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', viewId)
    }
    const handleDragOver = (e: React.DragEvent, viewId: string) => {
        if (!dragEnabled || dragIdRef.current === null) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (dragIdRef.current === viewId) return
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        const position: 'before' | 'after' = e.clientY < midY ? 'before' : 'after'
        setDragOver((prev) => (prev?.id === viewId && prev.position === position ? prev : { id: viewId, position }))
    }
    const handleDragEnd = () => {
        dragIdRef.current = null
        setDragOver(null)
    }
    const handleDrop = (e: React.DragEvent, targetId: string) => {
        if (!dragEnabled) return
        e.preventDefault()
        const sourceId = dragIdRef.current ?? e.dataTransfer.getData('text/plain')
        const position: 'before' | 'after' = dragOver?.id === targetId ? dragOver.position : 'after'
        dragIdRef.current = null
        setDragOver(null)
        if (!sourceId || sourceId === targetId) return
        const all = qViews.employeeViews
        const sourceIdx = all.findIndex((v) => v.id === sourceId)
        let targetIdx = all.findIndex((v) => v.id === targetId)
        if (sourceIdx === -1 || targetIdx === -1) return
        const next = [...all]
        const [moved] = next.splice(sourceIdx, 1)
        if (!moved) return
        if (sourceIdx < targetIdx) targetIdx -= 1
        const insertAt = position === 'after' ? targetIdx + 1 : targetIdx
        next.splice(insertAt, 0, moved)
        onReorderViews(next.map((v) => v.id))
    }

    const rowBaseStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: token.marginXS,
        padding: `${token.paddingXS}px ${token.paddingSM}px`,
        borderRadius: token.borderRadiusSM,
        cursor: 'pointer',
        transition: 'background 0.15s',
        userSelect: 'none',
    }

    const activeRowStyle: React.CSSProperties = {
        background: token.colorPrimaryBg,
        color: token.colorPrimary,
    }

    return (
        <div style={{
            width: 240,
            minWidth: 240,
            display: 'flex',
            flexDirection: 'column',
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            overflow: 'hidden',
        }}>
            {/* Search + create */}
            <div style={{ padding: token.paddingSM, display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
                <Input
                    size="small"
                    allowClear
                    placeholder="Search views..."
                    prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
                <Button
                    block
                    type="dashed"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={onCreateView}
                >
                    New View
                </Button>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: `0 ${token.paddingXS}px ${token.paddingSM}px` }}>
                {/* Default — virtual, pinned */}
                <div
                    style={{
                        ...rowBaseStyle,
                        ...(activeViewId === undefined ? activeRowStyle : {}),
                    }}
                    onClick={() => navigate({ to: '.', search: { viewId: undefined } })}
                    onMouseEnter={(e) => { if (activeViewId !== undefined) e.currentTarget.style.background = token.colorFillTertiary }}
                    onMouseLeave={(e) => { if (activeViewId !== undefined) e.currentTarget.style.background = 'transparent' }}
                >
                    <TableOutlined style={{ fontSize: 14, flexShrink: 0 }} />
                    <Typography.Text
                        ellipsis
                        style={{ flex: 1, fontSize: 13, color: activeViewId === undefined ? token.colorPrimary : undefined }}
                    >
                        Default
                    </Typography.Text>
                </div>

                {/* Divider when saved views exist */}
                {filteredViews.length > 0 && (
                    <div style={{ height: 1, background: token.colorBorderSecondary, margin: `${token.marginXS}px 0` }} />
                )}

                {/* Saved views */}
                {filter.trim().length > 0 && filteredViews.length === 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12, padding: `${token.paddingXS}px ${token.paddingSM}px`, display: 'block' }}>
                        No views match your search.
                    </Typography.Text>
                )}
                {filteredViews.map((view) => {
                    const isActive = activeViewId === view.id
                    const isDropTarget = dragOver?.id === view.id
                    const dropBefore = isDropTarget && dragOver?.position === 'before'
                    const dropAfter = isDropTarget && dragOver?.position === 'after'
                    return (
                        <div
                            key={view.id}
                            draggable={dragEnabled}
                            onDragStart={(e) => handleDragStart(e, view.id)}
                            onDragOver={(e) => handleDragOver(e, view.id)}
                            onDrop={(e) => handleDrop(e, view.id)}
                            onDragEnd={handleDragEnd}
                            style={{
                                ...rowBaseStyle,
                                position: 'relative',
                                ...(isActive ? activeRowStyle : {}),
                            }}
                            onClick={() => navigate({ to: '.', search: { viewId: view.id } })}
                            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = token.colorFillTertiary }}
                            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                        >
                            {dropBefore && (
                                <div style={{ position: 'absolute', left: 0, right: 0, top: -1, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
                            )}
                            {dropAfter && (
                                <div style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: token.colorPrimary, pointerEvents: 'none', zIndex: 1 }} />
                            )}
                            <HolderOutlined
                                style={{
                                    color: token.colorTextTertiary,
                                    cursor: dragEnabled ? 'grab' : 'not-allowed',
                                    fontSize: 14,
                                    flexShrink: 0,
                                }}
                            />
                            <TableOutlined style={{ fontSize: 14, flexShrink: 0 }} />
                            <Typography.Text
                                ellipsis
                                style={{ flex: 1, fontSize: 13, color: isActive ? token.colorPrimary : undefined }}
                                title={view.name}
                            >
                                {view.name}
                            </Typography.Text>
                            <Dropdown
                                trigger={['click']}
                                placement="bottomRight"
                                menu={{
                                    items: [
                                        { key: 'rename', icon: <EditOutlined />, label: 'Rename view' },
                                        { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate view' },
                                        { type: 'divider' },
                                        { key: 'delete', icon: <DeleteOutlined />, label: 'Delete view', danger: true },
                                    ],
                                    onClick: ({ key, domEvent }) => {
                                        domEvent.stopPropagation()
                                        if (key === 'rename') onRenameView(view)
                                        else if (key === 'duplicate') onDuplicateView(view)
                                        else if (key === 'delete') onDeleteView(view)
                                    },
                                }}
                            >
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<MoreOutlined />}
                                    onClick={(e) => e.stopPropagation()}
                                />
                            </Dropdown>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
