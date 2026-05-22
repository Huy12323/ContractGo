import React, { createContext, useReducer, useContext, useCallback, useMemo, useState } from 'react'
import { Modal, Tabs, Typography, Button, App, theme } from 'antd'
import { supabase } from '@/configs/supabase/config'
import { useQ_Tables_OrgEmployees } from '@/hooks/useQ_Tables_OrgEmployees'
import type { EmployeeDataTable_TableField } from '@/types/employeeTable.types'
import { useM_Employee_Update } from '@/hooks/useM_Employee_Update'
import { useM_Files_Upload } from '@/hooks/useM_Files_Upload'
import { AppEmployeeDetailModal_OverviewTab } from './AppEmployeeDetailModal_OverviewTab'
import { AppEmployeeDetailModal_TimeclockTab } from './AppEmployeeDetailModal_TimeclockTab'
import { isFileDeleteMarker } from './AppEmployeeDetailModal_FieldRenderer'

type Choice = { value: string; label: string }

// --- Provider Context ---------------------------------------------------
// Shell owns editMode + patch; nested tab bodies write into `patch` as the user
// edits fields. `isDirty` is derived from `Object.keys(patch).length > 0`.

class State {
    editMode: 'view' | 'edit' = 'view'
    patch: Record<string, unknown> = {}
}

const ContextDefault: {
    state: State
    setState: React.Dispatch<Partial<State>>
} = {
    state: new State(),
    setState: () => {},
}

const Reducer = (state: State, partial: Partial<State>): State => ({ ...state, ...partial })
const Context = createContext(ContextDefault)

const Provider_App_EmployeeDetailModal = ({ children }: { children: React.ReactNode }) => {
    const [state, setState] = useReducer(Reducer, new State())
    return (
        <Context.Provider value={{ state, setState }}>
            {children}
        </Context.Provider>
    )
}

export const useProvider_App_EmployeeDetailModal = () => useContext(Context)

// --- Modal --------------------------------------------------------------

type TabKey = 'overview' | 'timeclock'

type Props = {
    open: boolean
    employeeId: string | null
    entityId: string
    organizationId: string
    onClose: () => void
    fields?: EmployeeDataTable_TableField[]
    choicesByField?: Record<string, Choice[]>
    onFilePreview?: (ctx: { file_id: string; employee_id: string; column_id: string }) => void
    defaultTab?: TabKey
    initialDate?: Date
    timezone?: string
}

// Outer wrapper — keys the Provider so state resets every time a new employee
// row is expanded. Closed → null session key; open → employee id.
export const App_EmployeeDetailModal = (props: Props) => (
    <Provider_App_EmployeeDetailModal key={props.open && props.employeeId ? props.employeeId : 'closed'}>
        <AppEmployeeDetailModal_Shell {...props} />
    </Provider_App_EmployeeDetailModal>
)

const AppEmployeeDetailModal_Shell = ({ open, employeeId, entityId, organizationId, onClose, fields, choicesByField, onFilePreview, defaultTab = 'overview', initialDate, timezone }: Props) => {
    const { token } = theme.useToken()
    const { message, modal } = App.useApp()
    const pModal = useProvider_App_EmployeeDetailModal()
    const { editMode, patch } = pModal.state
    const isDirty = Object.keys(patch).length > 0
    const [activeTab, setActiveTab] = useState<TabKey>(defaultTab)
    const mUpdateEmployee = useM_Employee_Update({ entityId })
    const mFilesUpload = useM_Files_Upload()

    // Subscribe to the employees query (shared cache with the grid) so the modal
    // re-renders with fresh data when the mutation's invalidation fires.
    const qEmployees = useQ_Tables_OrgEmployees({ entityId })
    const employee = useMemo(
        () => (employeeId ? qEmployees.employees.find((e) => e.id === employeeId) ?? null : null),
        [qEmployees.employees, employeeId],
    )
    const resolvedTimezone = timezone ?? (employee?.entities as { timezone?: string } | null)?.timezone ?? 'UTC'

    // Lock applied for the entire save flow (file uploads + DB update + cleanup).
    // The mutation's own `isPending` only covers the final DB write; the file-upload
    // phase can take much longer for heavy files and previously left the Save button
    // clickable, allowing repeat clicks → duplicate uploads / audit-log noise.
    const [isSaving, setIsSaving] = useState(false)

    const resetToView = useCallback(() => {
        pModal.setState({ editMode: 'view', patch: {} })
    }, [pModal])

    const saveChanges = useCallback(async (): Promise<boolean> => {
        if (!employee) return false
        if (isSaving) return false
        setIsSaving(true)
        try {
            // Normalize file-column patches before the DB update:
            //   File instance            → upload to R2, insert files row, replace with file_id;
            //                              if the column already pointed to an old file, delete
            //                              the old file (R2 + thumbnail + files row) best-effort
            //                              so we don't orphan storage on every replace
            //   { __delete, file_id }    → delete R2 object + thumbnail + files row, replace with null
            //   anything else            → pass through unchanged
            const currentValues = employee as unknown as Record<string, unknown>
            const normalized: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(patch)) {
                if (value instanceof File) {
                    const result = await mFilesUpload.mutation.mutateAsync({
                        resource_type: 'employee_col',
                        file: value,
                        employee_id: employee.id,
                        column_id: key,
                    })
                    normalized[key] = result.file_id
                    // Replace flow — if the column previously held a file_id, delete that
                    // old file now. We do this AFTER the new upload succeeds so a failed
                    // new upload doesn't strand the employee with no file at all.
                    const previousFileId = currentValues[key]
                    if (typeof previousFileId === 'string' && previousFileId && previousFileId !== result.file_id) {
                        try {
                            await supabase.functions.invoke('files_r2_delete', {
                                body: { file_id: previousFileId },
                            })
                        } catch (cleanupErr) {
                            // Best-effort cleanup — orphaned R2 objects + files row are a
                            // soft problem, not worth failing the save over. Logged for
                            // future reconciliation.
                            console.warn(`Failed to delete replaced file ${previousFileId}:`, cleanupErr)
                        }
                    }
                } else if (isFileDeleteMarker(value)) {
                    const invoke = await supabase.functions.invoke('files_r2_delete', {
                        body: { file_id: value.file_id },
                    })
                    if (invoke.error) {
                        let serverMessage = 'Failed to delete file'
                        try {
                            const ctx = (invoke.error as { context?: { json?: () => Promise<{ error?: string }> } }).context
                            const body = await ctx?.json?.()
                            if (body?.error) serverMessage = body.error
                        } catch {
                            /* fall back */
                        }
                        throw new Error(serverMessage)
                    }
                    normalized[key] = null
                } else {
                    normalized[key] = value
                }
            }
            await mUpdateEmployee.mutation.mutateAsync({ employeeId: employee.id, patch: normalized })
            return true
        } catch (err) {
            console.error(err)
            message.error(err instanceof Error ? err.message : 'Failed to save')
            return false
        } finally {
            setIsSaving(false)
        }
    }, [employee, patch, mUpdateEmployee.mutation, mFilesUpload.mutation, message, isSaving])

    // Three-way dirty prompt. `afterResolve` runs after Save-success or Discard —
    // Cancel button passes a no-op (stays open in view mode); close paths pass
    // onClose (returns to the grid).
    const promptDirty = useCallback(
        (afterResolve: () => void) => {
            const instance = modal.confirm({
                title: 'Unsaved changes',
                content: 'You have unsaved changes. What would you like to do?',
                okText: 'Save changes',
                cancelText: 'Discard',
                closable: false,
                maskClosable: false,
                onOk: async () => {
                    const ok = await saveChanges()
                    if (ok) {
                        resetToView()
                        afterResolve()
                    }
                },
                onCancel: () => {
                    resetToView()
                    afterResolve()
                },
                footer: (_, { OkBtn, CancelBtn }) => (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: token.marginXS }}>
                        <Button onClick={() => instance.destroy()}>Continue editing</Button>
                        <CancelBtn />
                        <OkBtn />
                    </div>
                ),
            })
        },
        [modal, saveChanges, resetToView, token.marginXS],
    )

    // Cancel button in edit mode — returns to view; does not close the modal.
    const handleCancelEdit = useCallback(() => {
        if (isSaving) return
        if (!isDirty) {
            resetToView()
            return
        }
        promptDirty(() => {})
    }, [isSaving, isDirty, resetToView, promptDirty])

    // Direct Save button — save, then return to view; does not close.
    const handleSaveAndView = useCallback(async () => {
        if (isSaving) return
        const ok = await saveChanges()
        if (ok) resetToView()
    }, [isSaving, saveChanges, resetToView])

    // Modal close paths (X click, mask click, Escape). Clean → close directly;
    // dirty → prompt (Save or Discard both close; Continue editing stays).
    // While a save is in flight, suppress all close paths so the modal can't be
    // dismissed mid-upload — the only way out is to wait for the save to settle.
    const handleClose = useCallback(() => {
        if (isSaving) return
        if (!isDirty) {
            resetToView()
            onClose()
            return
        }
        promptDirty(onClose)
    }, [isSaving, isDirty, resetToView, onClose, promptDirty])

    const handleTabChange = useCallback((key: string) => {
        const next = key as TabKey
        if (activeTab === 'overview' && editMode === 'edit' && isDirty) {
            promptDirty(() => setActiveTab(next))
            return
        }
        if (editMode === 'edit') resetToView()
        setActiveTab(next)
    }, [activeTab, editMode, isDirty, promptDirty, resetToView])

    const overviewFooter =
        editMode === 'view'
            ? [
                  <Button
                      key="edit"
                      type="primary"
                      onClick={() => pModal.setState({ editMode: 'edit' })}
                  >
                      Edit
                  </Button>,
              ]
            : [
                  <Button key="cancel" onClick={handleCancelEdit} disabled={isSaving}>
                      Cancel
                  </Button>,
                  <Button
                      key="save"
                      type="primary"
                      disabled={!isDirty || isSaving}
                      loading={isSaving}
                      onClick={handleSaveAndView}
                  >
                      Save
                  </Button>,
              ]

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            width={activeTab === 'timeclock' ? 1200 : 960}
            title={null}
            footer={activeTab === 'overview' ? overviewFooter : null}
            destroyOnHidden
        >
            <div style={{ paddingBottom: token.paddingLG }}>
                <Typography.Title level={3} style={{ margin: 0 }} ellipsis>
                    {employee?.__full_name ?? ''}
                </Typography.Title>
            </div>
            <Tabs
                activeKey={activeTab}
                onChange={handleTabChange}
                items={[
                    {
                        key: 'overview',
                        label: 'Overview',
                        children: employee ? (
                            <AppEmployeeDetailModal_OverviewTab
                                employee={employee}
                                fields={fields}
                                choicesByField={choicesByField}
                                entityId={entityId}
                                organizationId={organizationId}
                                onFilePreview={(ctx) =>
                                    onFilePreview?.({
                                        file_id: ctx.file_id,
                                        employee_id: employee.id,
                                        column_id: ctx.column_id,
                                    })
                                }
                            />
                        ) : null,
                    },
                    {
                        key: 'timeclock',
                        label: 'Timeclock',
                        children: employee ? (
                            <AppEmployeeDetailModal_TimeclockTab
                                employeeId={employee.id}
                                entityId={entityId}
                                timezone={resolvedTimezone}
                                initialRefDate={initialDate}
                            />
                        ) : null,
                    },
                ]}
            />
        </Modal>
    )
}
