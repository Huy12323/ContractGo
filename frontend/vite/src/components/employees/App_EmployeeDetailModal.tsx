import React, { createContext, useReducer, useContext, useCallback, useMemo } from 'react'
import { Modal, Tabs, Typography, Button, App, theme } from 'antd'
import { supabase } from '@/configs/supabase/config'
import { useQ_Tables_OrgEmployees } from '@/hooks/useQ_Tables_OrgEmployees'
import type { EmployeeDataTable_TableField } from '@/types/employeeTable.types'
import { useM_Employee_Update } from '@/hooks/useM_Employee_Update'
import { useM_Files_Upload } from '@/hooks/useM_Files_Upload'
import { AppEmployeeDetailModal_DetailsTab } from './AppEmployeeDetailModal_DetailsTab'
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

type Props = {
    open: boolean
    employeeId: string | null
    organizationId: string
    onClose: () => void
    fields: EmployeeDataTable_TableField[]
    choicesByField: Record<string, Choice[]>
    onFilePreview?: (ctx: { file_id: string; employee_id: string; column_id: string }) => void
}

// Outer wrapper — keys the Provider so state resets every time a new employee
// row is expanded. Closed → null session key; open → employee id.
export const App_EmployeeDetailModal = (props: Props) => (
    <Provider_App_EmployeeDetailModal key={props.open && props.employeeId ? props.employeeId : 'closed'}>
        <AppEmployeeDetailModal_Shell {...props} />
    </Provider_App_EmployeeDetailModal>
)

const AppEmployeeDetailModal_Shell = ({ open, employeeId, organizationId, onClose, fields, choicesByField, onFilePreview }: Props) => {
    const { token } = theme.useToken()
    const { message, modal } = App.useApp()
    const pModal = useProvider_App_EmployeeDetailModal()
    const { editMode, patch } = pModal.state
    const isDirty = Object.keys(patch).length > 0
    const mUpdateEmployee = useM_Employee_Update()
    const mFilesUpload = useM_Files_Upload()

    // Subscribe to the employees query (shared cache with the grid) so the modal
    // re-renders with fresh data when the mutation's invalidation fires.
    const qEmployees = useQ_Tables_OrgEmployees({ organizationId })
    const employee = useMemo(
        () => (employeeId ? qEmployees.employees.find((e) => e.id === employeeId) ?? null : null),
        [qEmployees.employees, employeeId],
    )

    const resetToView = useCallback(() => {
        pModal.setState({ editMode: 'view', patch: {} })
    }, [pModal])

    const saveChanges = useCallback(async (): Promise<boolean> => {
        if (!employee) return false
        try {
            // Normalize file-column patches before the DB update:
            //   File instance            → upload to R2, insert files row, replace with file_id
            //   { __delete, file_id }    → delete R2 object + files row, replace with null
            //   anything else            → pass through unchanged
            const normalized: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(patch)) {
                if (value instanceof File) {
                    const result = await mFilesUpload.mutation.mutateAsync({
                        file: value,
                        employee_id: employee.id,
                        column_id: key,
                    })
                    normalized[key] = result.file_id
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
        }
    }, [employee, patch, mUpdateEmployee.mutation, mFilesUpload.mutation, message])

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
        if (!isDirty) {
            resetToView()
            return
        }
        promptDirty(() => {})
    }, [isDirty, resetToView, promptDirty])

    // Direct Save button — save, then return to view; does not close.
    const handleSaveAndView = useCallback(async () => {
        const ok = await saveChanges()
        if (ok) resetToView()
    }, [saveChanges, resetToView])

    // Modal close paths (X click, mask click, Escape). Clean → close directly;
    // dirty → prompt (Save or Discard both close; Continue editing stays).
    const handleClose = useCallback(() => {
        if (!isDirty) {
            resetToView()
            onClose()
            return
        }
        promptDirty(onClose)
    }, [isDirty, resetToView, onClose, promptDirty])

    // Edit / Cancel / Save belong to the Details tab (they operate on employee
    // fields). Today the modal has only one tab, so rendering them in the modal
    // footer is fine. When a second tab lands (Contracts, Files, etc.), lift an
    // `activeTab` state and render each tab's actions conditionally — or let
    // each tab contribute its own footer slot via the Tabs items config.
    const detailsTabFooter =
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
                  <Button key="cancel" onClick={handleCancelEdit}>
                      Cancel
                  </Button>,
                  <Button
                      key="save"
                      type="primary"
                      disabled={!isDirty}
                      loading={mUpdateEmployee.mutation.isPending}
                      onClick={handleSaveAndView}
                  >
                      Save
                  </Button>,
              ]

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            width={960}
            title={null}
            footer={detailsTabFooter}
            destroyOnHidden
        >
            <div style={{ paddingBottom: token.paddingLG }}>
                <Typography.Title level={3} style={{ margin: 0 }} ellipsis>
                    {employee?.__full_name ?? ''}
                </Typography.Title>
            </div>
            <Tabs
                items={[
                    {
                        key: 'details',
                        label: 'Details',
                        children: employee ? (
                            <AppEmployeeDetailModal_DetailsTab
                                employee={employee}
                                fields={fields}
                                choicesByField={choicesByField}
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
                ]}
            />
        </Modal>
    )
}
