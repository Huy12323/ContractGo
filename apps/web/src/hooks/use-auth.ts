import { useStore } from '@tanstack/react-store'
import { authStore } from '@/stores/auth'

export function useAuth() {
  const user = useStore(authStore, (s) => s.user)
  const session = useStore(authStore, (s) => s.session)
  const loading = useStore(authStore, (s) => s.loading)

  return { user, session, loading, isAuthenticated: !!session }
}
