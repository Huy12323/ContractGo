import React, { createContext, useReducer } from "react";

/**
 * CG-048. WHICH of the two workspaces this subtree is mounted under.
 *
 * `'org'` is a real organization named in the URL; `'personal'` is the hidden
 * per-user workspace that `/me/*` provisions. Below this provider the two are
 * the same thing — a personal workspace IS an `organizations` row, so every
 * query, mutation, RLS policy and edge function authorizes on `organizationId`
 * exactly as it always has. The scope decides ONE thing: where links point.
 * Anything else branching on it is a sign the model has been misapplied.
 */
export type OrganizationScope = "org" | "personal";

class State {
    organizationId: string = "";
    /** Defaults to `'org'`, so every mount that predates CG-048 is unchanged. */
    scope: OrganizationScope = "org";
}

const ContextDefault: { state: State; setState: React.Dispatch<Partial<State>> } = {
    state: new State(),
    setState: () => {},
};

const Reducer = (state: State, partial: Partial<State>): State => ({ ...state, ...partial });
const Context = createContext(ContextDefault);

export const Provider_Organization = ({
    children,
    initialState,
}: {
    children: React.ReactNode;
    initialState?: Partial<State>;
}) => {
    const [state, setState] = useReducer(
        Reducer,
        initialState ? { ...new State(), ...initialState } : new State()
    );
    return <Context.Provider value={{ state, setState }}>{children}</Context.Provider>;
};

export const useProvider_Organization = () => React.useContext(Context);
