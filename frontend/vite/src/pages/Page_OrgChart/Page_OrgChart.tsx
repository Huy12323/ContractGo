import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { Typography, Button, Tooltip, Modal, Input, Form, theme } from 'antd'
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
  PlusOutlined,
  DownOutlined,
  BankOutlined,
  BranchesOutlined,
  ApartmentOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/configs/supabase/config'
import { useOrganization } from '@/hooks/useOrganization'
import { useQ_Tables_OrgEntities } from '@/hooks/useQ_Tables_OrgEntities'
import { useQ_Tables_OrgDepartments } from '@/hooks/useQ_Tables_OrgDepartments'
import { useM_EntitySettings_EntityCreate } from '@/hooks/useM_EntitySettings_EntityCreate'
import { useM_DeptSettings_DepartmentCreate } from '@/hooks/useM_DeptSettings_DepartmentCreate'
import { App_EntitySettingsModal } from '@/components/organization/App_EntitySettingsModal'
import { App_DepartmentSettingsModal } from '@/components/organization/App_DepartmentSettingsModal'
import { Utils_OrgTree_BuildTree, type OrgTreeNode } from '@/utils/Utils_OrgTree_BuildTree'
import { QueryKeys } from '@/utils/query/queryKeys'

const CARD_WIDTH = 300
const GAP_X = 40
const CONNECTOR_HEIGHT = 32
const CONNECTOR_THICKNESS = 2.5
const EXPAND_BTN_SIZE = 28
const ZOOM_MIN = 0.25
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1
const HEADER_HEIGHT = 40
const FIT_MARGIN = 60

const computeFitTransform = ({ vpW, vpH, contentW, contentH, zoomMin, zoomMax, margin }: { vpW: number; vpH: number; contentW: number; contentH: number; zoomMin: number; zoomMax: number; margin: number }) => {
  const scaleX = (vpW - margin * 2) / contentW
  const scaleY = (vpH - margin * 2) / contentH
  const zoom = Math.max(zoomMin, Math.min(zoomMax, Math.min(scaleX, scaleY)))
  return { zoom, pan: { x: (vpW - contentW * zoom) / 2, y: margin } }
}

const applyZoomAnchored = ({ prevPan, prevZoom, newZoom, anchor }: { prevPan: { x: number; y: number }; prevZoom: number; newZoom: number; anchor: { x: number; y: number } }) => ({
  x: anchor.x - (anchor.x - prevPan.x) * (newZoom / prevZoom),
  y: anchor.y - (anchor.y - prevPan.y) * (newZoom / prevZoom),
})

type EmpWithDepts = { id: string; first_name: string; last_name: string; email: string; entity_id: string; rel__department__employee: { department_id: string; is_manager: boolean }[] }
type DeptPeople = { managers: EmpWithDepts[]; employees: EmpWithDepts[] }

export const Page_OrgChart = () => {
  const { token } = theme.useToken()
  const { organization, organizationId } = useOrganization()
  const qEntities = useQ_Tables_OrgEntities({ organizationId })
  const qDepartments = useQ_Tables_OrgDepartments({ organizationId })

  const qEmployees = useQuery({
    enabled: !!organizationId,
    queryKey: [...QueryKeys.employees.list(), ...QueryKeys.departments.list(), { organizationId }, 'orgchart'],
    queryFn: async () => {
      const sb_FromEmployees_Select = await supabase
        .from('employees')
        .select('id, first_name, last_name, email, entity_id, rel__department__employee(department_id, is_manager)')
        .eq('organization_id', organizationId)
        .order('first_name', { ascending: true })
      if (sb_FromEmployees_Select.error) throw sb_FromEmployees_Select.error
      return sb_FromEmployees_Select.data as EmpWithDepts[]
    },
  })

  const employees = useMemo(() => qEmployees.data || [], [qEmployees.data])

  const peopleByDeptId = useMemo(() => {
    const map: Record<string, DeptPeople> = {}
    for (const emp of employees) {
      for (const link of emp.rel__department__employee ?? []) {
        if (!map[link.department_id]) map[link.department_id] = { managers: [], employees: [] }
        if (link.is_manager) map[link.department_id]!.managers.push(emp)
        else map[link.department_id]!.employees.push(emp)
      }
    }
    return map
  }, [employees])

  const tree = useMemo(
    () => Utils_OrgTree_BuildTree(organization?.name ?? 'Organization', 'org-root', qEntities.entities, qDepartments.departments),
    [organization?.name, qEntities.entities, qDepartments.departments],
  )

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(['org-root']))
  const [zoom, setZoom] = useState(0.85)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const didInitialFit = useRef(false)
  const zoomRef = useRef(zoom)
  const panDuringDragRef = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEntity, setSelectedEntity] = useState<{ id: string; name: string } | null>(null)
  const [selectedDept, setSelectedDept] = useState<{ id: string; name: string } | null>(null)
  const [createEntityOpen, setCreateEntityOpen] = useState(false)
  const [createDeptContext, setCreateDeptContext] = useState<{ entityId: string; parentId?: string } | null>(null)

  const mEntityCreate = useM_EntitySettings_EntityCreate()
  const mDeptCreate = useM_DeptSettings_DepartmentCreate()
  const [createEntityForm] = Form.useForm<{ name: string }>()
  const [createDeptForm] = Form.useForm<{ name: string }>()

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

  const levelColors = useMemo(() => [
    { bg: token.colorPrimaryBg, border: token.colorPrimary },
    { bg: token.colorInfoBg, border: token.colorInfo },
    { bg: token.colorFillQuaternary, border: token.colorTextSecondary },
  ], [token])

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
    if (dx !== 0 || dy !== 0) setPan((prev) => ({ x: prev.x - dx, y: prev.y - dy }))
  })

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const vp = viewportRef.current
    if (!vp) return
    const vpRect = vp.getBoundingClientRect()
    const anchor = { x: e.clientX - vpRect.left, y: e.clientY - vpRect.top }
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta))
    if (newZoom === zoom) return
    setPan(applyZoomAnchored({ prevPan: pan, prevZoom: zoom, newZoom, anchor }))
    setZoom(newZoom)
  }, [zoom, pan])

  const zoomAtViewportCenter = useCallback((delta: number) => {
    const vp = viewportRef.current
    if (!vp) return
    const anchor = { x: vp.clientWidth / 2, y: vp.clientHeight / 2 }
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta))
    if (newZoom === zoom) return
    setPan(applyZoomAnchored({ prevPan: pan, prevZoom: zoom, newZoom, anchor }))
    setZoom(newZoom)
  }, [zoom, pan])

  const handleZoomIn = useCallback(() => zoomAtViewportCenter(ZOOM_STEP), [zoomAtViewportCenter])
  const handleZoomOut = useCallback(() => zoomAtViewportCenter(-ZOOM_STEP), [zoomAtViewportCenter])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isPanning.current = true
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }, [pan.x, pan.y])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return
    const nx = panStart.current.panX + (e.clientX - panStart.current.x)
    const ny = panStart.current.panY + (e.clientY - panStart.current.y)
    panDuringDragRef.current = { x: nx, y: ny }
    const z = zoomRef.current
    if (innerRef.current) innerRef.current.style.transform = `translate(${nx}px, ${ny}px) scale(${z})`
    if (gridRef.current) {
      const tileSize = 24 * z
      const tx = ((nx % tileSize) + tileSize) % tileSize
      const ty = ((ny % tileSize) + tileSize) % tileSize
      gridRef.current.style.transform = `translate(${tx}px, ${ty}px)`
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    isPanning.current = false
    if (panDuringDragRef.current) {
      setPan(panDuringDragRef.current)
      panDuringDragRef.current = null
    }
  }, [])

  const didDrag = useRef(false)
  const handleMouseDownWrapped = useCallback((e: React.MouseEvent) => { didDrag.current = false; handleMouseDown(e) }, [handleMouseDown])
  const handleMouseMoveWrapped = useCallback((e: React.MouseEvent) => { if (isPanning.current) didDrag.current = true; handleMouseMove(e) }, [handleMouseMove])

  const handleFit = useCallback(() => {
    const vp = viewportRef.current
    const inner = innerRef.current
    if (!vp || !inner) return
    const fit = computeFitTransform({ vpW: vp.clientWidth, vpH: vp.clientHeight, contentW: inner.offsetWidth, contentH: inner.offsetHeight, zoomMin: ZOOM_MIN, zoomMax: ZOOM_MAX, margin: FIT_MARGIN })
    setZoom(fit.zoom)
    setPan(fit.pan)
  }, [])

  useEffect(() => {
    if (didInitialFit.current) return
    const vp = viewportRef.current
    const inner = innerRef.current
    if (!vp || !inner || inner.offsetWidth === 0) return
    if (qEntities.query.isPending) return
    const hasEntities = qEntities.entities.length > 0
    if (hasEntities && !expandedIds.has(qEntities.entities[0]!.id)) return
    didInitialFit.current = true
    const fit = computeFitTransform({ vpW: vp.clientWidth, vpH: vp.clientHeight, contentW: inner.offsetWidth, contentH: inner.offsetHeight, zoomMin: ZOOM_MIN, zoomMax: ZOOM_MAX, margin: FIT_MARGIN })
    setZoom(fit.zoom)
    setPan(fit.pan)
  }, [tree, expandedIds, qEntities.entities, qEntities.query.isPending])

  const handleNodeClick = useCallback((node: OrgTreeNode) => {
    if (didDrag.current) return
    setSelectedNodeId(node.id)
    if (node.type === 'entity') setSelectedEntity({ id: node.sourceId!, name: node.name })
    if (node.type === 'department') setSelectedDept({ id: node.sourceId!, name: node.name })
  }, [])

  const connectorColor = token.colorBorder
  const gridTileSize = 24 * zoom
  const gridTx = ((pan.x % gridTileSize) + gridTileSize) % gridTileSize
  const gridTy = ((pan.y % gridTileSize) + gridTileSize) % gridTileSize

  const renderNode = (node: OrgTreeNode, depth: number): React.ReactNode => {
    const colors = levelColors[Math.min(depth, levelColors.length - 1)]!
    const isSelected = selectedNodeId === node.id
    const isExpanded = expandedIds.has(node.id)
    const hasChildren = node.children.length > 0
    const isDept = node.type === 'department'
    const people = isDept ? (peopleByDeptId[node.id] || { managers: [], employees: [] }) : { managers: [], employees: [] }
    const typeLabel = node.type === 'org' ? 'Organization' : node.type === 'entity' ? 'Entity' : depth >= 3 ? 'Sub-department' : 'Department'
    const LevelIcon = node.type === 'org' ? BankOutlined : node.type === 'entity' ? BranchesOutlined : ApartmentOutlined
    return (
      <div key={node.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div data-node-id={node.id} onClick={(e) => { e.stopPropagation(); handleNodeClick(node) }}
          style={{ width: CARD_WIDTH, cursor: 'pointer', borderRadius: token.borderRadiusLG, background: token.colorBgContainer, border: isSelected ? `2px solid ${colors.border}` : `1px solid ${token.colorBorderSecondary}`, boxShadow: isSelected ? `0 0 0 3px ${colors.bg}` : '0 1px 3px rgba(0,0,0,0.06)', transition: 'box-shadow 0.2s, border-color 0.2s', overflow: 'hidden' }}>
          <div style={{ background: colors.border, padding: `8px ${token.paddingMD}px`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <LevelIcon style={{ fontSize: 28, color: '#fff', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text strong ellipsis style={{ fontSize: 14, color: '#fff', display: 'block' }}>{node.name}</Typography.Text>
              <Typography.Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>{typeLabel}</Typography.Text>
            </div>
          </div>
          {node.type === 'org' && (
            <div style={{ padding: `6px ${token.paddingMD}px` }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}><BranchesOutlined style={{ marginRight: 4 }} />{node.children.length} {node.children.length === 1 ? 'entity' : 'entities'}</Typography.Text>
            </div>
          )}
          {node.type === 'entity' && node.children.length > 0 && (
            <div style={{ padding: `6px ${token.paddingMD}px` }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}><ApartmentOutlined style={{ marginRight: 4 }} />{node.children.length} {node.children.length === 1 ? 'department' : 'departments'}</Typography.Text>
            </div>
          )}
          {isDept && (
            <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 4 }}>
              {people.managers.length > 0 ? people.managers.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `4px ${token.paddingMD}px`, fontSize: 13 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: token.colorFillTertiary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: token.colorTextSecondary, flexShrink: 0 }}>
                    {(p.first_name?.[0] || '?').toUpperCase()}
                  </div>
                  <Typography.Text ellipsis style={{ fontSize: 13 }}>{p.first_name} {p.last_name}</Typography.Text>
                </div>
              )) : (
                <div style={{ padding: `2px ${token.paddingMD}px 6px`, fontSize: 12, color: token.colorTextQuaternary }}>No managers assigned</div>
              )}
            </div>
          )}
        </div>
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
            <span style={{ fontSize: 11, color: token.colorTextSecondary }}>{node.type === 'org' ? 'Entity' : 'Department'}</span>
          </div>
        </div>
        {isExpanded && hasChildren && (
          <>
            <div style={{ width: CONNECTOR_THICKNESS, height: CONNECTOR_HEIGHT, background: connectorColor }} />
            <div style={{ display: 'flex', gap: GAP_X }}>
              {node.children.map((child, i) => (
                <div key={child.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                  {node.children.length > 1 && i > 0 && <div style={{ position: 'absolute', top: 0, right: '50%', width: `calc(50% + ${GAP_X / 2}px)`, height: CONNECTOR_THICKNESS, background: connectorColor }} />}
                  {node.children.length > 1 && i < node.children.length - 1 && <div style={{ position: 'absolute', top: 0, left: '50%', width: `calc(50% + ${GAP_X / 2}px)`, height: CONNECTOR_THICKNESS, background: connectorColor }} />}
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

  const renderedChart = useMemo(
    () => renderNode(tree, 0),
    [tree, expandedIds, selectedNodeId, peopleByDeptId, token, levelColors, connectorColor, handleNodeClick, handleToggle],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ height: HEADER_HEIGHT, minHeight: HEADER_HEIGHT, display: 'flex', alignItems: 'center', padding: `0 ${token.paddingMD}px`, borderBottom: `1px solid ${token.colorBorderSecondary}`, background: token.colorBgContainer }}>
        <Typography.Title level={5} style={{ margin: 0 }}>Org Chart</Typography.Title>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 10, display: 'flex', alignItems: 'center', gap: 4, background: token.colorBgContainer, padding: '4px 8px', borderRadius: token.borderRadiusSM, boxShadow: token.boxShadowTertiary }}>
          <Tooltip title="Zoom out"><Button size="small" icon={<ZoomOutOutlined />} onClick={handleZoomOut} /></Tooltip>
          <Typography.Text style={{ fontSize: 12, minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</Typography.Text>
          <Tooltip title="Zoom in"><Button size="small" icon={<ZoomInOutlined />} onClick={handleZoomIn} /></Tooltip>
          <Tooltip title="Fit to view"><Button size="small" icon={<ExpandOutlined />} onClick={handleFit} /></Tooltip>
        </div>
        <Typography.Text type="secondary" style={{ position: 'absolute', top: 8, left: 12, fontSize: 12, zIndex: 10, pointerEvents: 'none', userSelect: 'none' }}>
          Click a node to view settings · Scroll to zoom · Drag to pan
        </Typography.Text>
        <div ref={viewportRef} onWheel={handleWheel} onMouseDown={handleMouseDownWrapped} onMouseMove={handleMouseMoveWrapped} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
          style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', cursor: 'grab', userSelect: 'none' }}>
          <div ref={gridRef} style={{ position: 'absolute', left: -gridTileSize, top: -gridTileSize, width: `calc(100% + ${gridTileSize * 2}px)`, height: `calc(100% + ${gridTileSize * 2}px)`, background: `radial-gradient(circle, ${token.colorTextQuaternary} 1.2px, transparent 1.2px)`, backgroundSize: `${gridTileSize}px ${gridTileSize}px`, transform: `translate(${gridTx}px, ${gridTy}px)`, willChange: 'transform', pointerEvents: 'none' }} />
          <div ref={innerRef} style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', display: 'inline-flex' }}>
            {renderedChart}
          </div>
        </div>
      </div>

      <Modal open={createEntityOpen} onCancel={() => { setCreateEntityOpen(false); createEntityForm.resetFields() }} title="Create Entity" onOk={() => createEntityForm.submit()} confirmLoading={mEntityCreate.mutation.isPending} destroyOnHidden>
        <Form form={createEntityForm} layout="vertical" style={{ marginTop: 16 }} onFinish={(values) => { mEntityCreate.mutation.mutate({ organization_id: organizationId, name: values.name }, { onSuccess: () => { setCreateEntityOpen(false); createEntityForm.resetFields(); setExpandedIds((prev) => new Set(prev).add('org-root')) } }) }}>
          <Form.Item name="name" label="Entity Name" rules={[{ required: true, message: 'Name is required' }]}><Input placeholder="e.g. VN Branch" /></Form.Item>
          <button type="submit" hidden />
        </Form>
      </Modal>

      <Modal open={!!createDeptContext} onCancel={() => { setCreateDeptContext(null); createDeptForm.resetFields() }} title="Create Department" onOk={() => createDeptForm.submit()} confirmLoading={mDeptCreate.mutation.isPending} destroyOnHidden>
        <Form form={createDeptForm} layout="vertical" style={{ marginTop: 16 }} onFinish={(values) => { if (!createDeptContext) return; mDeptCreate.mutation.mutate({ name: values.name, entity_id: createDeptContext.entityId, parent_id: createDeptContext.parentId }, { onSuccess: () => { const ctx = createDeptContext; setCreateDeptContext(null); createDeptForm.resetFields(); setExpandedIds((prev) => { const next = new Set(prev); next.add(ctx.entityId); if (ctx.parentId) next.add(ctx.parentId); return next }) } }) }}>
          <Form.Item name="name" label="Department Name" rules={[{ required: true, message: 'Name is required' }]}><Input placeholder="e.g. Engineering" /></Form.Item>
          <button type="submit" hidden />
        </Form>
      </Modal>

      {selectedEntity && <App_EntitySettingsModal open={!!selectedEntity} onClose={() => { setSelectedEntity(null); setSelectedNodeId(null) }} entityId={selectedEntity.id} entityName={selectedEntity.name} organizationId={organizationId} />}
      {selectedDept && <App_DepartmentSettingsModal open={!!selectedDept} onClose={() => { setSelectedDept(null); setSelectedNodeId(null) }} departmentId={selectedDept.id} departmentName={selectedDept.name} />}

      <style>{`@keyframes fadeScaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  )
}
