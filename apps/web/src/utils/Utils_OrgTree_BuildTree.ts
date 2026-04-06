import type { Tables_OrgEntities_QueryData } from '@/hooks/useQ_Tables_OrgEntities'
import type { Tables_EntityDepartments_QueryData } from '@/hooks/useQ_Tables_EntityDepartments'

export type OrgTreeNodeType = 'org' | 'entity' | 'department'

export type OrgTreeNode = {
  id: string
  name: string
  type: OrgTreeNodeType
  sourceId?: string
  entityId?: string
  children: OrgTreeNode[]
}

const buildDeptTree = (
  departments: Tables_EntityDepartments_QueryData,
  parentId: string | null,
  entityId: string,
): OrgTreeNode[] =>
  departments
    .filter((d) => d.parent_id === parentId)
    .map((d) => ({
      id: d.id,
      name: d.name,
      type: 'department' as const,
      sourceId: d.id,
      entityId,
      children: buildDeptTree(departments, d.id, entityId),
    }))

export const Utils_OrgTree_BuildTree = (
  orgName: string,
  orgRootId: string,
  entities: Tables_OrgEntities_QueryData,
  allDepartments: Tables_EntityDepartments_QueryData,
): OrgTreeNode => ({
  id: orgRootId,
  name: orgName,
  type: 'org',
  children: entities.map((entity) => ({
    id: entity.id,
    name: entity.name,
    type: 'entity' as const,
    sourceId: entity.id,
    entityId: entity.id,
    children: buildDeptTree(
      allDepartments.filter((d) => d.entity_id === entity.id),
      null,
      entity.id,
    ),
  })),
})
