import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Typography, Button, Tooltip, Modal, Input, Form, Card, Tag, theme } from 'antd'
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
  PlusOutlined,
  DownOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useOrganization } from '@/hooks/useOrganization'
import { useQ_Tables_OrgEntities } from '@/hooks/useQ_Tables_OrgEntities'
import { useM_EntitySettings_EntityCreate } from '@/hooks/useM_EntitySettings_EntityCreate'
import { useM_DeptSettings_DepartmentCreate } from '@/hooks/useM_DeptSettings_DepartmentCreate'
import { App_EntitySettingsModal } from '@/components/organization/App_EntitySettingsModal'
import { App_DepartmentSettingsModal } from '@/components/organization/App_DepartmentSettingsModal'
import { Utils_OrgTree_BuildTree, type OrgTreeNode } from '@/utils/Utils_OrgTree_BuildTree'

export const Route = createFileRoute('/_protected/$organizationId/org-chart/')({
  component: OrgChartPage,
})

// --- Layout constants ---
const LEVEL_SIZES = [
  { w: 260, fontSize: 14 },
  { w: 230, fontSize: 13 },
  { w: 200, fontSize: 12 },
]
const getLevelSize = (depth: number) => LEVEL_SIZES[Math.min(depth, LEVEL_SIZES.length - 1)]!
const GAP_X = 36
const GAP_Y = 56
const EXPAND_BTN_SIZE = 28
const EXPAND_BTN_OVERLAP = 14
const EXPAND_BTN_SPACE = EXPAND_BTN_SIZE - EXPAND_BTN_OVERLAP
const CARD_HEIGHT = 36
const ZOOM_MIN = 0.25
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1

const computeCardHeight = () => CARD_HEIGHT

// --- Layout types ---
type LayoutNode = {
  id: string
  x: number
  y: number
  w: number
  h: number
  depth: number
  node: OrgTreeNode
  children: LayoutNode[]
}

// --- Layout algorithm ---
const computeLayout = (node: OrgTreeNode, expandedIds: Set<string>, depth = 0): LayoutNode => {
  const size = getLevelSize(depth)
  const h = computeCardHeight()
  const isExpanded = expandedIds.has(node.id)
  const childLayouts = isExpanded && node.children.length > 0
    ? node.children.map((c) => computeLayout(c, expandedIds, depth + 1))
    : []
  return { id: node.id, x: 0, y: 0, w: size.w, h, depth, node, children: childLayouts }
}

const measureSubtreeWidth = (ln: LayoutNode): number => {
  if (ln.children.length === 0) return ln.w
  const childrenWidth = ln.children.reduce((sum, c) => sum + measureSubtreeWidth(c), 0)
  return Math.max(ln.w, childrenWidth + GAP_X * (ln.children.length - 1))
}

const positionSubtree = (ln: LayoutNode, left: number) => {
  const subtreeW = measureSubtreeWidth(ln)
  ln.x = left + subtreeW / 2 - ln.w / 2
  if (ln.children.length > 0) {
    let childLeft = left
    for (const child of ln.children) {
      positionSubtree(child, childLeft)
      childLeft += measureSubtreeWidth(child) + GAP_X
    }
  }
}

const positionVertical = (allNodes: LayoutNode[]) => {
  const depthMaxH: Record<number, number> = {}
  for (const n of allNodes) {
    depthMaxH[n.depth] = Math.max(depthMaxH[n.depth] ?? 0, n.h)
  }
  const depthY: Record<number, number> = { 0: 0 }
  const maxDepth = Math.max(...allNodes.map((n) => n.depth), 0)
  for (let d = 1; d <= maxDepth; d++) {
    const prevH = depthMaxH[d - 1] ?? 0
    depthY[d] = (depthY[d - 1] ?? 0) + prevH + EXPAND_BTN_SPACE + GAP_Y
  }
  for (const n of allNodes) n.y = depthY[n.depth] ?? 0
}

const flattenLayout = (ln: LayoutNode): LayoutNode[] => {
  const result: LayoutNode[] = [ln]
  for (const child of ln.children) result.push(...flattenLayout(child))
  return result
}

type Edge = { x1: number; y1: number; x2: number; y2: number }
const collectEdges = (ln: LayoutNode): Edge[] => {
  const edges: Edge[] = []
  for (const child of ln.children) {
    edges.push({ x1: ln.x + ln.w / 2, y1: ln.y + ln.h, x2: child.x + child.w / 2, y2: child.y })
    edges.push(...collectEdges(child))
  }
  return edges
}

const buildTreeLayout = (root: OrgTreeNode, expandedIds: Set<string>) => {
  const rootLayout = computeLayout(root, expandedIds, 0)
  positionSubtree(rootLayout, 0)
  const allNodes = flattenLayout(rootLayout)
  positionVertical(allNodes)
  const allEdges = collectEdges(rootLayout)
  const maxX = allNodes.length > 0 ? Math.max(...allNodes.map((n) => n.x + n.w)) : 400
  const maxY = allNodes.length > 0 ? Math.max(...allNodes.map((n) => n.y + n.h)) : 200
  return { nodes: allNodes, edges: allEdges, canvasW: maxX + 80, canvasH: maxY + 100 }
}

// --- Main component ---
function OrgChartPage() {
  const { token } = theme.useToken()
  const { organization, organizationId } = useOrganization()
  const qEntities = useQ_Tables_OrgEntities({ organizationId })

  // Build tree from flat data
  const tree = useMemo(
    () => Utils_OrgTree_BuildTree(organization?.name ?? 'Organization', 'org-root', qEntities.entities, []),
    [organization?.name, qEntities.entities],
  )

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(['org-root']))
  const [zoom, setZoom] = useState(0.85)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const didInitialFit = useRef(false)
  const anchorRef = useRef<{ id: string; x: number; y: number } | null>(null)

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

  const { nodes, edges, canvasW, canvasH } = useMemo(
    () => buildTreeLayout(tree, expandedIds),
    [tree, expandedIds],
  )

  const handleToggle = useCallback((id: string) => {
    const current = nodes.find((n) => n.id === id)
    if (current) anchorRef.current = { id, x: current.x, y: current.y }
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [nodes])

  // Initial fit
  useEffect(() => {
    if (didInitialFit.current || !viewportRef.current) return
    didInitialFit.current = true
    const vw = viewportRef.current.clientWidth
    const fitZoom = Math.min(0.9, (vw - 60) / canvasW)
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitZoom))
    setZoom(clamped)
    setPan({ x: Math.max(0, (vw - canvasW * clamped) / 2), y: 24 })
  }, [canvasW])

  // Anchor preservation
  useEffect(() => {
    if (!anchorRef.current) return
    const { id, x: oldX, y: oldY } = anchorRef.current
    anchorRef.current = null
    const newNode = nodes.find((n) => n.id === id)
    if (!newNode) return
    const dx = (newNode.x - oldX) * zoom
    const dy = (newNode.y - oldY) * zoom
    if (dx !== 0 || dy !== 0) setPan((prev) => ({ x: prev.x - dx, y: prev.y - dy }))
  }, [nodes, zoom])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((prev) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP))))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isPanning.current = true
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return
    setPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    })
  }, [])

  const handleMouseUp = useCallback(() => { isPanning.current = false }, [])

  const handleFit = useCallback(() => {
    if (!viewportRef.current) return
    const vw = viewportRef.current.clientWidth
    const vh = viewportRef.current.clientHeight
    const fitZoom = Math.min((vw - 60) / canvasW, (vh - 60) / canvasH, 1)
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitZoom))
    setZoom(clamped)
    setPan({
      x: Math.max(0, (vw - canvasW * clamped) / 2),
      y: Math.max(0, (vh - canvasH * clamped) / 2),
    })
  }, [canvasW, canvasH])

  const handleNodeClick = (node: OrgTreeNode) => {
    setSelectedNodeId(node.id)
    if (node.type === 'entity') setSelectedEntity({ id: node.sourceId!, name: node.name })
    if (node.type === 'department') setSelectedDept({ id: node.sourceId!, name: node.name })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Canvas */}
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          flex: 1,
          overflow: 'hidden',
          cursor: isPanning.current ? 'grabbing' : 'grab',
          position: 'relative',
          background: `radial-gradient(circle, ${token.colorBorderSecondary}25 1px, transparent 1px)`,
          backgroundSize: '24px 24px',
        }}
      >
        {/* Guide text — top left */}
        <Typography.Text
          type="secondary"
          style={{ position: 'absolute', top: 8, left: 12, fontSize: 12, zIndex: 10, pointerEvents: 'none', userSelect: 'none' }}
        >
          Click a node to view settings · Scroll to zoom · Drag to pan
        </Typography.Text>

        {/* Zoom controls — top right */}
        <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
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

        <div style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'absolute',
          width: canvasW,
          height: canvasH,
        }}>
          {/* SVG connectors */}
          <svg width={canvasW} height={canvasH} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
            {edges.map((e, i) => {
              const midY = e.y1 + (e.y2 - e.y1) * 0.5
              return (
                <path
                  key={i}
                  d={`M ${e.x1} ${e.y1} C ${e.x1} ${midY}, ${e.x2} ${midY}, ${e.x2} ${e.y2}`}
                  fill="none"
                  stroke={token.colorTextQuaternary}
                  strokeWidth={2}
                  opacity={0.7}
                />
              )
            })}
          </svg>

          {/* Node cards — follows demo OrgCard pattern */}
          {nodes.map((ln) => {
            const size = getLevelSize(ln.depth)
            const isSelected = selectedNodeId === ln.id
            const isExpanded = expandedIds.has(ln.id)
            const hasChildren = ln.node.children.length > 0

            return (
              <div key={ln.id} style={{ position: 'absolute', left: ln.x, top: ln.y, width: ln.w, animation: 'fadeScaleIn 0.25s ease-out' }}>
                <div
                  onClick={(e) => { e.stopPropagation(); handleNodeClick(ln.node) }}
                  style={{ cursor: 'pointer' }}
                >
                  <Card
                    size="small"
                    hoverable
                    style={{
                      width: '100%',
                      height: CARD_HEIGHT,
                      border: isSelected
                        ? `2px solid ${token.colorPrimary}`
                        : `1px solid ${token.colorBorderSecondary}`,
                      boxShadow: isSelected
                        ? `0 0 0 3px ${token.colorPrimaryBg}`
                        : '0 1px 6px rgba(0,0,0,0.06)',
                      background: token.colorBgContainer,
                      transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
                    }}
                    styles={{ body: { padding: 0, height: '100%', display: 'flex', alignItems: 'center' } }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', width: '100%' }}>
                      <Typography.Text strong ellipsis style={{ flex: 1, fontSize: size.fontSize }}>
                        {ln.node.name}
                      </Typography.Text>
                      <Tag style={{ margin: 0, fontSize: 10, lineHeight: '18px' }}>
                        <TeamOutlined /> {ln.node.children.length}
                      </Tag>
                    </div>
                  </Card>
                </div>

                {/* Bottom buttons: expand (center) + add (right of center) */}
                {(
                  <div style={{ position: 'absolute', left: '50%', bottom: EXPAND_BTN_OVERLAP - EXPAND_BTN_SIZE, transform: 'translateX(-50%)', zIndex: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                    {/* Expand/collapse — centered, connector lines originate here */}
                    {hasChildren && (
                      <div
                        onClick={(e) => { e.stopPropagation(); handleToggle(ln.id) }}
                        style={{
                          width: EXPAND_BTN_SIZE, height: EXPAND_BTN_SIZE, borderRadius: '50%',
                          background: token.colorBgContainer, border: `1.5px solid ${token.colorBorderSecondary}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                          transition: 'background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = token.colorPrimary; e.currentTarget.style.boxShadow = `0 2px 10px ${token.colorPrimaryBg}` }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = token.colorBorderSecondary; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)' }}
                      >
                        <DownOutlined style={{ fontSize: 12, color: token.colorTextSecondary, transition: 'transform 0.3s ease', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                      </div>
                    )}

                    {/* Add button — pill on hover */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        if (ln.node.type === 'org') setCreateEntityOpen(true)
                        if (ln.node.type === 'entity') setCreateDeptContext({ entityId: ln.node.sourceId! })
                        if (ln.node.type === 'department') setCreateDeptContext({ entityId: ln.node.entityId!, parentId: ln.node.sourceId! })
                      }}
                        style={{
                          height: EXPAND_BTN_SIZE, minWidth: EXPAND_BTN_SIZE, borderRadius: EXPAND_BTN_SIZE / 2,
                          background: token.colorBgContainer, border: `1.5px solid ${token.colorBorderSecondary}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                          transition: 'all 0.25s ease',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                          padding: '0 4px', overflow: 'hidden', whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = token.colorPrimary
                          e.currentTarget.style.boxShadow = `0 2px 10px ${token.colorPrimaryBg}`
                          e.currentTarget.style.padding = '0 10px'
                          const label = e.currentTarget.querySelector<HTMLSpanElement>('[data-add-label]')
                          if (label) { label.style.opacity = '1'; label.style.maxWidth = '120px'; label.style.marginLeft = '4px' }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = token.colorBorderSecondary
                          e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)'
                          e.currentTarget.style.padding = '0 4px'
                          const label = e.currentTarget.querySelector<HTMLSpanElement>('[data-add-label]')
                          if (label) { label.style.opacity = '0'; label.style.maxWidth = '0'; label.style.marginLeft = '0' }
                        }}
                      >
                        <PlusOutlined style={{ fontSize: 12, color: token.colorTextSecondary, flexShrink: 0 }} />
                        <span
                          data-add-label
                          style={{ fontSize: 11, color: token.colorTextSecondary, opacity: 0, maxWidth: 0, marginLeft: 0, transition: 'all 0.25s ease', overflow: 'hidden', whiteSpace: 'nowrap' }}
                        >
                          {ln.node.type === 'org' ? 'Add Entity' : ln.node.type === 'entity' ? 'Add Department' : 'Add Sub-dept'}
                        </span>
                      </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

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
              { onSuccess: () => { setCreateEntityOpen(false); createEntityForm.resetFields() } },
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
              { onSuccess: () => { setCreateDeptContext(null); createDeptForm.resetFields() } },
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
          onClose={() => setSelectedEntity(null)}
          entityId={selectedEntity.id}
          entityName={selectedEntity.name}
          organizationId={organizationId}
        />
      )}
      {selectedDept && (
        <App_DepartmentSettingsModal
          open={!!selectedDept}
          onClose={() => setSelectedDept(null)}
          departmentId={selectedDept.id}
          departmentName={selectedDept.name}
        />
      )}

      <style>{`@keyframes fadeScaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  )
}
