import { Store } from '@tanstack/store'
import { supabase } from '@/api/supabase'
import type { User, Session } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
}

export const authStore = new Store<AuthState>({
  user: null,
  session: null,
  loading: true,
})

export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession()

  authStore.setState((prev) => ({
    ...prev,
    user: session?.user ?? null,
    session,
    loading: false,
  }))

  supabase.auth.onAuthStateChange((_event, session) => {
    authStore.setState((prev) => ({
      ...prev,
      user: session?.user ?? null,
      session,
    }))
  })
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signUp(email: string, password: string) {
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
