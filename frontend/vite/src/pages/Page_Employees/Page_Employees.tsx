import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { Typography, Button, Tooltip, Modal, Input, Form, Segmented, theme } from 'antd'
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
  PlusOutlined,
  DownOutlined,
  TeamOutlined,
  FileTextOutlined,
  SolutionOutlined,
  ApartmentOutlined,
  UnorderedListOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useOrganization } from '@/hooks/useOrganization'
import { useQ_Tables_OrgEntities } from '@/hooks/useQ_Tables_OrgEntities'
import { useQ_Tables_OrgDepartments } from '@/hooks/useQ_Tables_OrgDepartments'
import { useQ_Tables_OrgEmployeesWithDepartments } from '@/hooks/useQ_Tables_OrgEmployeesWithDepartments'
import { useM_EntitySettings_EntityCreate } from '@/hooks/useM_EntitySettings_EntityCreate'
import { useM_DeptSettings_DepartmentCreate } from '@/hooks/useM_DeptSettings_DepartmentCreate'
import { App_EntitySettingsModal } from '@/components/organization/App_EntitySettingsModal'
import { App_DepartmentSettingsModal } from '@/components/organization/App_DepartmentSettingsModal'
import { App_ViewFormsModal } from '@/components/employees/App_ViewFormsModal'
import { App_FieldManagerModal } from '@/components/employees/App_FieldManagerModal'
import { App_OnboardingModal } from '@/components/employees/App_OnboardingModal'
import { Utils_OrgTree_BuildTree, type OrgTreeNode } from '@/utils/Utils_OrgTree_BuildTree'
import { Provider_Page_Employees_List } from '@/providers/employees/Provider_Page_Employees_List'
import { PageEmployees_ListView } from './PageEmployees_ListView/PageEmployees_ListView'

// --- Chart constants ---
const CARD_WIDTH = 300
const GAP_X = 40
const CONNECTOR_HEIGHT = 32
const CONNECTOR_THICKNESS = 2.5
const EXPAND_BTN_SIZE = 28
const ZOOM_MIN = 0.25
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1
const HEADER_HEIGHT = 48

type ViewMode = 'chart' | 'list'

export const Page_Employees = () => {
  const { token } = theme.useToken()
  const { organization, organizationId } = useOrganization()
  const qEntities = useQ_Tables_OrgEntities({ organizationId })
  const qDepartments = useQ_Tables_OrgDepartments({ organizationId })
  const qEmployees = useQ_Tables_OrgEmployeesWithDepartments({ organizationId })

  const [viewMode, setViewMode] = useState<ViewMode>('chart')
  const [viewFormsOpen, setViewFormsOpen] = useState(false)
  const [fieldManagerOpen, setFieldManagerOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)

  // Build tree from flat data
  const tree = useMemo(
    () => Utils_OrgTree_BuildTree(organization?.name ?? 'Organization', 'org-root', qEntities.entities, qDepartments.departments),
    [organization?.name, qEntities.entities, qDepartments.departments],
  )

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(['org-root']))
  const [zoom, setZoom] = useState(0.85)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, scrollX: 0, scrollY: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)

  // Selected node for modals
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEntity, setSelectedEntity] = useState<{ id: string; name: string } | null>(null)
  const [selectedDept, setSelectedDept] = useState<{ id: string; name: string } | null>(null)
  const [createEntityOpen, setCreateEntityOpen] = useState(false)
  const [createDeptContext, setCreateDeptContext] = useState<{ entityId: string; parentId?: string } | null>(null)

  const mEntityCreate = useM_EntitySettings_EntityCreate()
  const mDeptCreate = useM_DeptSettings_DepartmentCreate()
  const [createEntityForm] = Form.useForm<{ name: string }>()
  const [createDeptForm] = Form.useForm<{ name: string }>()

  // Auto-expand entities on data load
  useEffect(() => {
    if (qEntities.entities.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        next.add('org-root')
        for (const e of qEntities.entities) next.add(e.id)
        return next
      })
    }
  }, [qEntities.entities])

  // Level color scheme (semantic colors from ANTD theme tokens)
  const levelColors = useMemo(() => [
    { bg: token.colorPrimaryBg, border: token.colorPrimary },    // org
    { bg: token.colorInfoBg, border: token.colorInfo },            // entity
    { bg: token.colorSuccessBg, border: token.colorSuccess },      // department + sub-dept
  ], [token])

  // Anchor preservation: keep the toggled node at the same screen position after re-render
  const anchorRef = useRef<{ id: string; screenX: number; screenY: number } | null>(null)

  const handleToggle = useCallback((id: string) => {
    const el = viewportRef.current?.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null
    if (el) {
      const rect = el.getBoundingClientRect()
      anchorRef.current = { id, screenX: rect.left, screenY: rect.top }
    }
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  useEffect(() => {
    if (!anchorRef.current || !viewportRef.current) return
    const { id, screenX, screenY } = anchorRef.current
    anchorRef.current = null
    const el = viewportRef.current.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null
    if (!el) return
    const rect = el.getBoundingClientRect()
    const dx = rect.left - screenX
    const dy = rect.top - screenY
    if (dx !== 0 || dy !== 0) {
      viewportRef.current.scrollLeft += dx
      viewportRef.current.scrollTop += dy
    }
  })

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((prev) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP))))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isPanning.current = true
    const vp = viewportRef.current
    panStart.current = { x: e.clientX, y: e.clientY, scrollX: vp?.scrollLeft ?? 0, scrollY: vp?.scrollTop ?? 0 }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current || !viewportRef.current) return
    viewportRef.current.scrollLeft = panStart.current.scrollX - (e.clientX - panStart.current.x)
    viewportRef.current.scrollTop = panStart.current.scrollY - (e.clientY - panStart.current.y)
  }, [])

  const handleMouseUp = useCallback(() => { isPanning.current = false }, [])

  const didDrag = useRef(false)
  const handleMouseDownWrapped = useCallback((e: React.MouseEvent) => {
    didDrag.current = false
    handleMouseDown(e)
  }, [handleMouseDown])
  const handleMouseMoveWrapped = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) didDrag.current = true
    handleMouseMove(e)
  }, [handleMouseMove])

  const handleFit = useCallback(() => {
    setZoom(0.85)
  }, [])

  const handleNodeClick = (node: OrgTreeNode) => {
    if (didDrag.current) return
    setSelectedNodeId(node.id)
    if (node.type === 'entity') setSelectedEntity({ id: node.sourceId!, name: node.name })
    if (node.type === 'department') setSelectedDept({ id: node.sourceId!, name: node.name })
  }

  const connectorColor = token.colorBorder

  const renderNode = (node: OrgTreeNode, depth: number): React.ReactNode => {
    const colors = levelColors[Math.min(depth, levelColors.length - 1)]!
    const isSelected = selectedNodeId === node.id
    const isExpanded = expandedIds.has(node.id)
    const hasChildren = node.children.length > 0
    const isDept = node.type === 'department'
    const people = isDept ? (qEmployees.peopleByDeptId[node.id] || { managers: [], employees: [] }) : { managers: [], employees: [] }
    const typeLabel = node.type === 'org' ? 'Organization' : node.type === 'entity' ? 'Entity' : depth >= 3 ? 'Sub-department' : 'Department'
    return (
      <div key={node.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Card */}
        <div
          data-node-id={node.id}
          onClick={(e) => { e.stopPropagation(); handleNodeClick(node) }}
          style={{
            width: CARD_WIDTH, cursor: 'pointer',
            borderRadius: token.borderRadiusLG,
            background: token.colorBgContainer,
            border: isSelected ? `2px solid ${colors.border}` : `1px solid ${token.colorBorderSecondary}`,
            boxShadow: isSelected ? `0 0 0 3px ${colors.bg}` : '0 1px 3px rgba(0,0,0,0.06)',
            transition: 'box-shadow 0.2s, border-color 0.2s',
            overflow: 'hidden',
          }}
        >
          {/* Colored label */}
          <div style={{ background: colors.border, padding: `8px ${token.paddingMD}px` }}>
            <Typography.Text strong ellipsis style={{ fontSize: 14, color: '#fff', display: 'block' }}>{node.name}</Typography.Text>
            <Typography.Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>{typeLabel}</Typography.Text>
          </div>

          {/* Body — org */}
          {node.type === 'org' && (
            <div style={{ padding: `6px ${token.paddingMD}px` }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{node.children.length} {node.children.length === 1 ? 'entity' : 'entities'}</Typography.Text>
            </div>
          )}

          {/* Body — entity */}
          {node.type === 'entity' && node.children.length > 0 && (
            <div style={{ padding: `6px ${token.paddingMD}px` }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}><TeamOutlined style={{ marginRight: 4 }} />{node.children.length} {node.children.length === 1 ? 'department' : 'departments'}</Typography.Text>
            </div>
          )}

          {/* Body — department: always show managers section */}
          {isDept && (
            <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `4px ${token.paddingMD}px`, fontSize: 11, color: token.colorTextTertiary }}>
                <SettingOutlined style={{ fontSize: 10 }} />
                <span>Managers{people.managers.length > 0 ? ` (${people.managers.length})` : ''}</span>
              </div>
              {people.managers.length > 0 ? people.managers.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `4px ${token.paddingMD}px`, fontSize: 13 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: token.colorFillTertiary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: token.colorTextSecondary, flexShrink: 0 }}>
                    {(p.first_name?.[0] || '?').toUpperCase()}
                  </div>
                  <Typography.Text ellipsis style={{ fontSize: 13 }}>{p.first_name} {p.last_name}</Typography.Text>
                </div>
              )) : (
                <div style={{ padding: `2px ${token.paddingMD}px 6px`, fontSize: 12, color: token.colorTextQuaternary }}>
                  No managers assigned
                </div>
              )}
            </div>
          )}
        </div>

        {/* Buttons below card */}
        <div style={{ display: 'flex', gap: 6, marginTop: 4, zIndex: 2 }}>
          {hasChildren && (
            <div onClick={(e) => { e.stopPropagation(); handleToggle(node.id) }}
              style={{ width: EXPAND_BTN_SIZE, height: EXPAND_BTN_SIZE, borderRadius: '50%', background: token.colorBgContainer, border: `1.5px solid ${token.colorBorderSecondary}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = token.colorPrimary }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = token.colorBorderSecondary }}>
              <DownOutlined style={{ fontSize: 12, color: token.colorTextSecondary, transition: 'transform 0.3s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }} />
            </div>
          )}
          <div onClick={(e) => {
              e.stopPropagation()
              if (node.type === 'org') setCreateEntityOpen(true)
              if (node.type === 'entity') setCreateDeptContext({ entityId: node.sourceId! })
              if (node.type === 'department') setCreateDeptContext({ entityId: node.entityId!, parentId: node.sourceId! })
            }}
            style={{ height: EXPAND_BTN_SIZE, minWidth: EXPAND_BTN_SIZE, borderRadius: EXPAND_BTN_SIZE / 2, background: token.colorBgContainer, border: `1.5px solid ${token.colorBorderSecondary}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.08)', padding: '0 8px', gap: 4 }}>
            <PlusOutlined style={{ fontSize: 12, color: token.colorTextSecondary }} />
            <span style={{ fontSize: 11, color: token.colorTextSecondary }}>{node.type === 'org' ? 'Add Entity' : node.type === 'entity' ? 'Add Dept' : 'Add Sub-dept'}</span>
          </div>
        </div>

        {/* Connector + children */}
        {isExpanded && hasChildren && (
          <>
            {/* Vertical line down from buttons */}
            <div style={{ width: CONNECTOR_THICKNESS, height: CONNECTOR_HEIGHT, background: connectorColor }} />

            {/* Children row — each child draws its own rail segments */}
            <div style={{ display: 'flex', gap: GAP_X }}>
              {node.children.map((child, i) => (
                <div key={child.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                  {node.children.length > 1 && i > 0 && (
                    <div style={{ position: 'absolute', top: 0, right: '50%', width: `calc(50% + ${GAP_X / 2}px)`, height: CONNECTOR_THICKNESS, background: connectorColor }} />
                  )}
                  {node.children.length > 1 && i < node.children.length - 1 && (
                    <div style={{ position: 'absolute', top: 0, left: '50%', width: `calc(50% + ${GAP_X / 2}px)`, height: CONNECTOR_THICKNESS, background: connectorColor }} />
                  )}
                  <div style={{ width: CONNECTOR_THICKNESS, height: node.children.length > 1 ? CONNECTOR_HEIGHT / 2 : 0, background: connectorColor, flexShrink: 0 }} />
                  {renderNode(child, depth + 1)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header bar */}
      <div style={{
        height: HEADER_HEIGHT,
        minHeight: HEADER_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `0 ${token.paddingMD}px`,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}>
        <Typography.Title level={5} style={{ margin: 0 }}>Employees</Typography.Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM }}>
          <Segmented
            size="small"
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
            options={[
              { value: 'chart', icon: <ApartmentOutlined /> },
              { value: 'list', icon: <UnorderedListOutlined /> },
            ]}
          />
          <Button icon={<SettingOutlined />} onClick={() => setFieldManagerOpen(true)}>
            Manage Fields
          </Button>
          <Button icon={<FileTextOutlined />} onClick={() => setViewFormsOpen(true)}>
            View Forms
          </Button>
          <Button icon={<SolutionOutlined />} type="primary" onClick={() => setOnboardingOpen(true)}>
            Onboarding
          </Button>
        </div>
      </div>

      {/* View content */}
      {viewMode === 'chart' ? (
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Zoom controls — fixed overlay top right */}
          <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 10, display: 'flex', alignItems: 'center', gap: 4, background: token.colorBgContainer, padding: '4px 8px', borderRadius: token.borderRadiusSM, boxShadow: token.boxShadowTertiary }}>
            <Tooltip title="Zoom out">
              <Button size="small" icon={<ZoomOutOutlined />} onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))} />
            </Tooltip>
            <Typography.Text style={{ fontSize: 12, minWidth: 40, textAlign: 'center' }}>
              {Math.round(zoom * 100)}%
            </Typography.Text>
            <Tooltip title="Zoom in">
              <Button size="small" icon={<ZoomInOutlined />} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))} />
            </Tooltip>
            <Tooltip title="Fit to view">
              <Button size="small" icon={<ExpandOutlined />} onClick={handleFit} />
            </Tooltip>
          </div>

          {/* Guide text — top left */}
          <Typography.Text
            type="secondary"
            style={{ position: 'absolute', top: 8, left: 12, fontSize: 12, zIndex: 10, pointerEvents: 'none', userSelect: 'none' }}
          >
            Click a node to view settings · Scroll to zoom · Drag to pan
          </Typography.Text>

          {/* Scrollable + pannable viewport */}
          <div
            ref={viewportRef}
            onWheel={handleWheel}
            onMouseDown={handleMouseDownWrapped}
            onMouseMove={handleMouseMoveWrapped}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              width: '100%', height: '100%',
              overflow: 'hidden',
              cursor: 'grab',
              userSelect: 'none',
              background: `radial-gradient(circle, ${token.colorBorderSecondary}25 1px, transparent 1px)`,
              backgroundSize: '24px 24px',
            }}
          >
            <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', padding: `${CONNECTOR_HEIGHT}px ${GAP_X}px`, display: 'inline-flex', minWidth: '100%', justifyContent: 'center' }}>
              {renderNode(tree, 0)}
            </div>
          </div>
        </div>
      ) : (
        <Provider_Page_Employees_List>
          <PageEmployees_ListView organizationId={organizationId} />
        </Provider_Page_Employees_List>
      )}

      {/* Field Manager Modal */}
      <App_FieldManagerModal
        open={fieldManagerOpen}
        onClose={() => setFieldManagerOpen(false)}
        organizationId={organizationId}
      />

      {/* View Forms Modal */}
      <App_ViewFormsModal
        open={viewFormsOpen}
        onClose={() => setViewFormsOpen(false)}
        organizationId={organizationId}
      />

      {/* Onboarding Modal */}
      <App_OnboardingModal
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        organizationId={organizationId}
      />

      {/* Create Entity Modal */}
      <Modal
        open={createEntityOpen}
        onCancel={() => { setCreateEntityOpen(false); createEntityForm.resetFields() }}
        title="Create Entity"
        onOk={() => createEntityForm.submit()}
        confirmLoading={mEntityCreate.mutation.isPending}
        destroyOnHidden
      >
        <Form
          form={createEntityForm}
          layout="vertical"
          style={{ marginTop: 16 }}
          onFinish={(values) => {
            mEntityCreate.mutation.mutate(
              { organization_id: organizationId, name: values.name },
              { onSuccess: () => { setCreateEntityOpen(false); createEntityForm.resetFields(); setExpandedIds((prev) => new Set(prev).add('org-root')) } },
            )
          }}
        >
          <Form.Item name="name" label="Entity Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="e.g. VN Branch" />
          </Form.Item>
          <button type="submit" hidden />
        </Form>
      </Modal>

      {/* Create Department Modal */}
      <Modal
        open={!!createDeptContext}
        onCancel={() => { setCreateDeptContext(null); createDeptForm.resetFields() }}
        title="Create Department"
        onOk={() => createDeptForm.submit()}
        confirmLoading={mDeptCreate.mutation.isPending}
        destroyOnHidden
      >
        <Form
          form={createDeptForm}
          layout="vertical"
          style={{ marginTop: 16 }}
          onFinish={(values) => {
            if (!createDeptContext) return
            mDeptCreate.mutation.mutate(
              { name: values.name, entity_id: createDeptContext.entityId, parent_id: createDeptContext.parentId },
              {
                onSuccess: () => {
                  const ctx = createDeptContext
                  setCreateDeptContext(null)
                  createDeptForm.resetFields()
                  setExpandedIds((prev) => {
                    const next = new Set(prev)
                    next.add(ctx.entityId)
                    if (ctx.parentId) next.add(ctx.parentId)
                    return next
                  })
                },
              },
            )
          }}
        >
          <Form.Item name="name" label="Department Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="e.g. Engineering" />
          </Form.Item>
          <button type="submit" hidden />
        </Form>
      </Modal>

      {/* Settings Modals */}
      {selectedEntity && (
        <App_EntitySettingsModal
          open={!!selectedEntity}
          onClose={() => { setSelectedEntity(null); setSelectedNodeId(null) }}
          entityId={selectedEntity.id}
          entityName={selectedEntity.name}
          organizationId={organizationId}
        />
      )}
      {selectedDept && (
        <App_DepartmentSettingsModal
          open={!!selectedDept}
          onClose={() => { setSelectedDept(null); setSelectedNodeId(null) }}
          departmentId={selectedDept.id}
          departmentName={selectedDept.name}
        />
      )}

      <style>{`@keyframes fadeScaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  )
}
