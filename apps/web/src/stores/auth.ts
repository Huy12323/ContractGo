import { Store } from '@tanstack/store'
import { supabase } from '@/api/supabase'
import { queryClient } from '@/lib/query-client'
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

let userInitiatedSignOut = false

export function initAuth() {
  supabase.auth.onAuthStateChange((event, session) => {
    switch (event) {
      case 'INITIAL_SESSION':
        authStore.setState((prev) => ({
          ...prev,
          user: session?.user ?? null,
          session,
          loading: false,
        }))
        break

      case 'SIGNED_IN':
      case 'TOKEN_REFRESHED':
        authStore.setState((prev) => ({
          ...prev,
          user: session?.user ?? null,
          session,
        }))
        break

      case 'SIGNED_OUT':
        queryClient.clear()
        if (userInitiatedSignOut) {
          userInitiatedSignOut = false
          window.location.href = '/login'
        } else {
          window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`
        }
        return
    }
  })
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signUp(email: string, password: string, fullName: string) {
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (error) throw error
}

export async function signOut() {
  userInitiatedSignOut = true
  const { error } = await supabase.auth.signOut()
  if (error) {
    userInitiatedSignOut = false
    throw error
  }
}

export async function resendVerification(email: string) {
  const { error } = await supabase.auth.resend({ type: 'signup', email })
  if (error) throw error
}

export async function resetPasswordForEmail(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) throw error
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

export async function verifyRecoveryOtp(email: string, token: string) {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' })
  if (error) throw error
}
