import {
  AlignLeftOutlined,
  NumberOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  TagsOutlined,
  PaperClipOutlined,
} from '@ant-design/icons'
import type { EmployeeTable_FieldType } from '@/types/employeeTable.types'

// Pure mapping from field type → ANTD icon component. Used by the Grid column
// headers (indirectly via Glide's GridColumnIcon set), the toolbar's field-picker
// dropdowns (Hide Fields / Filters / Groups / Sort), and anywhere else a field
// type needs a visual prefix.
export const FieldTypeIcon = ({ type }: { type: EmployeeTable_FieldType }) => {
  switch (type) {
    case 'text':
      return <AlignLeftOutlined />
    case 'number':
      return <NumberOutlined />
    case 'date':
      return <CalendarOutlined />
    case 'boolean':
      return <CheckSquareOutlined />
    case 'single_select':
      return <TagsOutlined />
    case 'multi_select':
      return <TagsOutlined />
    case 'file':
      return <PaperClipOutlined />
  }
}
