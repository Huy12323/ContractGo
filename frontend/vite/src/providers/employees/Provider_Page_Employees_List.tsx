import React, { createContext, useReducer } from 'react'
import type {
    EmployeeView_Config,
    EmployeeTable_ToolState,
    EmployeeTable_FilterNode,
    EmployeeTable_FilterGroup,
    EmployeeTable_SortEntry,
    EmployeeTable_GroupEntry,
} from '@/types/employeeTable.types'

export const emptyToolState: EmployeeTable_ToolState = {
    sort: [],
    filter: null,
    groupBy: [],
    hiddenKeys: [],
    fieldOrder: [],
    search: '',
}

export const emptyConfig: EmployeeView_Config = {
    sort: [],
    filter: null,
    groupBy: [],
    hiddenKeys: [],
    fieldOrder: [],
}

export const projectConfigFromToolState = (toolState: EmployeeTable_ToolState): EmployeeView_Config => ({
    sort: toolState.sort,
    filter: toolState.filter,
    groupBy: toolState.groupBy,
    hiddenKeys: toolState.hiddenKeys,
    fieldOrder: toolState.fieldOrder,
})

const equalArraysOfStrings = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

const equalSortEntries = (a: EmployeeTable_SortEntry[], b: EmployeeTable_SortEntry[]) =>
    a.length === b.length && a.every((e, i) => e.field === b[i]!.field && e.direction === b[i]!.direction)

const equalGroupEntries = (a: EmployeeTable_GroupEntry[], b: EmployeeTable_GroupEntry[]) =>
    a.length === b.length && a.every((e, i) => e.field === b[i]!.field && e.direction === b[i]!.direction)

const equalFilterNode = (a: EmployeeTable_FilterNode | null, b: EmployeeTable_FilterNode | null): boolean => {
    if (a === b) return true
    if (a === null || b === null) return false
    if (a.kind !== b.kind) return false
    if (a.kind === 'condition' && b.kind === 'condition') {
        return a.field === b.field && a.operator === b.operator && a.value === b.value
    }
    if (a.kind === 'group' && b.kind === 'group') {
        if (a.combinator !== b.combinator) return false
        if (a.children.length !== b.children.length) return false
        return a.children.every((c, i) => equalFilterNode(c, b.children[i]!))
    }
    return false
}

export const equalConfig = (a: EmployeeView_Config, b: EmployeeView_Config): boolean =>
    equalSortEntries(a.sort, b.sort)
    && equalGroupEntries(a.groupBy, b.groupBy)
    && equalArraysOfStrings(a.hiddenKeys, b.hiddenKeys)
    && equalArraysOfStrings(a.fieldOrder, b.fieldOrder)
    && equalFilterNode(a.filter as EmployeeTable_FilterGroup | null, b.filter as EmployeeTable_FilterGroup | null)

class State {
    savedConfig: EmployeeView_Config | null = null
    savedName: string | null = null
    toolState: EmployeeTable_ToolState = emptyToolState
}

const ContextDefault: { state: State; setState: React.Dispatch<Partial<State>> } = {
    state: new State(),
    setState: () => {},
}

const Reducer = (state: State, partial: Partial<State>): State => ({ ...state, ...partial })
const Context = createContext(ContextDefault)

export const Provider_Page_Employees_List = ({ children }: { children: React.ReactNode }) => {
    const [state, setState] = useReducer(Reducer, new State())
    return <Context.Provider value={{ state, setState }}>{children}</Context.Provider>
}

export const useProvider_Page_Employees_List = () => {
    const ctx = React.useContext(Context)
    const setToolState = (partial: Partial<EmployeeTable_ToolState>) =>
        ctx.setState({ toolState: { ...ctx.state.toolState, ...partial } })
    const isDirty = ctx.state.savedConfig !== null
        && !equalConfig(ctx.state.savedConfig, projectConfigFromToolState(ctx.state.toolState))
    return { ...ctx, setToolState, isDirty }
}
