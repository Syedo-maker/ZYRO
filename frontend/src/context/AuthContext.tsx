import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { apiFetch, refreshAccessToken, setAccessToken } from '../lib/apiClient'
import type { AuthSession, User } from '../types/api'
import type { MyStore } from '../types/store'

interface RegisterInput {
  email: string
  password: string
  storeName: string
  storeSlug: string
}

interface CustomerRegisterInput {
  email: string
  password: string
  name?: string
}

interface LoginInput {
  email: string
  password: string
}

interface AuthContextValue {
  user: User | null
  stores: MyStore[]
  /** The store the admin UI currently operates on: defaults to the first store the user has. */
  activeStore: MyStore | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  /** A shopper's account: no store, works at every store. */
  registerCustomer: (input: CustomerRegisterInput) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function loadSessionData(): Promise<{ user: User; stores: MyStore[] }> {
  const [user, stores] = await Promise.all([
    apiFetch<User>('/users/me'),
    apiFetch<MyStore[]>('/users/me/stores'),
  ])
  return { user, stores }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [stores, setStores] = useState<MyStore[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // On first load, a returning user has no in-memory access token but may still have a
  // valid httpOnly refresh cookie; try to restore the session silently before rendering
  // protected routes, so a page reload doesn't force a re-login.
  //
  // hasAttemptedRestore guards against React 18/19 StrictMode double-invoking this effect
  // in development: refresh rotates the token (deletes the old one, issues a new one), so
  // firing it twice concurrently is a real race, not just a wasted duplicate request; the
  // backend now handles that race safely (auth.service.ts), but there's no reason to fire
  // it twice on every single mount regardless.
  const hasAttemptedRestore = useRef(false)
  useEffect(() => {
    if (hasAttemptedRestore.current) return
    hasAttemptedRestore.current = true

    void (async () => {
      const refreshed = await refreshAccessToken()
      if (refreshed) {
        try {
          const session = await loadSessionData()
          setUser(session.user)
          setStores(session.stores)
        } catch {
          setAccessToken(null)
        }
      }
      setIsLoading(false)
    })()
  }, [])

  async function login(input: LoginInput) {
    const session = await apiFetch<AuthSession>('/auth/login', { method: 'POST', body: input })
    setAccessToken(session.accessToken)
    setUser(session.user)
    setStores(await apiFetch<MyStore[]>('/users/me/stores'))
  }

  async function register(input: RegisterInput) {
    const session = await apiFetch<AuthSession>('/auth/register', { method: 'POST', body: input })
    setAccessToken(session.accessToken)
    setUser(session.user)
    setStores(await apiFetch<MyStore[]>('/users/me/stores'))
  }

  async function registerCustomer(input: CustomerRegisterInput) {
    const session = await apiFetch<AuthSession>('/auth/register-customer', { method: 'POST', body: input })
    setAccessToken(session.accessToken)
    setUser(session.user)
    setStores([])
  }

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' })
    setAccessToken(null)
    setUser(null)
    setStores([])
  }

  const value: AuthContextValue = {
    user,
    stores,
    activeStore: stores[0] ?? null,
    isLoading,
    isAuthenticated: user !== null,
    login,
    register,
    registerCustomer,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
