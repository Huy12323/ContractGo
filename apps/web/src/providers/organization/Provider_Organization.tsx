import React, { createContext, useReducer } from 'react'

class State {
  organizationId: string = ''
}

const ContextDefault: { state: State; setState: React.Dispatch<Partial<State>> } = {
  state: new State(),
  setState: () => {},
}

const Reducer = (state: State, partial: Partial<State>): State => ({ ...state, ...partial })
const Context = createContext(ContextDefault)

export const Provider_Organization = ({
  children,
  initialState,
}: {
  children: React.ReactNode
  initialState?: Partial<State>
}) => {
  const [state, setState] = useReducer(
    Reducer,
    initialState ? { ...new State(), ...initialState } : new State(),
  )
  return <Context.Provider value={{ state, setState }}>{children}</Context.Provider>
}

export const useProvider_Organization = () => React.useContext(Context)
