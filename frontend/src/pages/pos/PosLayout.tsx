import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { PosProvider, usePos } from '../../context/PosContext'
import { Button } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import { ApiError } from '../../lib/apiClient'
import { posApi } from '../../lib/posApi'
import { formatDateTime } from '../../lib/format'
import type { PosSession, PosShift } from '../../types/pos'
import { CloseShiftDialog } from './ShiftPanels'

/** /pos: signed out goes to the till login; otherwise straight to the store's register. */
export function PosEntry() {
  const { isLoading, isAuthenticated, stores } = useAuth()
  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/pos/login" replace />
  if (stores.length === 0) return <Centered>This account has no store. Ask the owner to add you as staff.</Centered>
  if (stores.length === 1) return <Navigate to={`/pos/${stores[0].id}`} replace />
  return (
    <Centered>
      <h1 className="font-display text-lg font-bold mb-3">Which store?</h1>
      <ul className="flex flex-col gap-2">
        {stores.map((s) => (
          <li key={s.id}>
            <Link to={`/pos/${s.id}`} className="block rounded-[10px] border border-border px-4 py-3 font-semibold hover:bg-bg">
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-bg">
      <div className="w-full max-w-md bg-white border border-border rounded-2xl p-8 text-sm">{children}</div>
    </div>
  )
}

/** Signs the till in to one store: loads who is at the register and the open shift, then shows the pages. */
export function PosLayout() {
  const { storeId = '' } = useParams()
  const { isLoading, isAuthenticated, logout } = useAuth()
  const [data, setData] = useState<{ session: PosSession; shift: PosShift | null } | null>(null)
  const [error, setError] = useState<{ status: number; message: string } | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    setData(null)
    setError(null)
    Promise.all([posApi.session(storeId), posApi.currentShift(storeId)])
      .then(([session, shift]) => {
        if (!cancelled) setData({ session, shift })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(
          err instanceof ApiError
            ? { status: err.status, message: err.status === 403 ? 'This account is not set up to use the register at this store.' : (err.detail ?? err.message) }
            : { status: 0, message: 'Could not reach the server. Check the connection and reload.' }
        )
      })
    return () => {
      cancelled = true
    }
  }, [storeId, isAuthenticated])

  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/pos/login" replace />
  if (error) {
    return (
      <Centered>
        <Alert>{error.message}</Alert>
        <div className="flex gap-3 mt-4">
          <Button variant="secondary" onClick={() => void logout()}>
            Sign out
          </Button>
          <Link to="/pos" className="inline-flex items-center text-sm font-semibold text-brand">
            Choose another store
          </Link>
        </div>
      </Centered>
    )
  }
  if (!data) {
    return (
      <Centered>
        <Spinner label="Opening the register" />
      </Centered>
    )
  }

  return (
    <PosProvider key={storeId} storeId={storeId} session={data.session} initialShift={data.shift}>
      <PosFrame />
    </PosProvider>
  )
}

function PosFrame() {
  const { session, shift, storeId } = usePos()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [closing, setClosing] = useState(false)

  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-[10px] px-4 py-2 text-sm font-semibold transition-colors ${isActive ? 'bg-white/15 text-white' : 'text-white/75 hover:text-white'}`

  async function signOut() {
    await logout()
    navigate('/pos/login')
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg print:bg-white">
      <header className="bg-text text-white flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 print:hidden">
        <div className="font-display text-lg font-bold">ZYRO</div>
        <div className="text-sm text-white/75">{session.store.name}</div>
        <nav aria-label="Register sections" className="flex gap-1">
          <NavLink to={`/pos/${storeId}`} end className={link}>
            Register
          </NavLink>
          <NavLink to={`/pos/${storeId}/history`} className={link}>
            Sales
          </NavLink>
          {session.permissions.analytics && (
            <NavLink to={`/pos/${storeId}/summary`} className={link}>
              Daily summary
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-4 text-sm">
          {shift ? (
            <>
              <span className="text-white/75">Shift open since {formatDateTime(shift.openedAt)}</span>
              <button
                onClick={() => setClosing(true)}
                className="rounded-[10px] border border-white/40 px-3 py-1.5 font-semibold hover:bg-white/10"
              >
                Close shift
              </button>
            </>
          ) : (
            <span className="text-white/75">No shift open</span>
          )}
          <span className="text-white/75">{session.user.name ?? session.user.email}</span>
          <button onClick={() => void signOut()} className="font-semibold text-white hover:underline">
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        <Outlet />
      </main>

      {closing && <CloseShiftDialog onClose={() => setClosing(false)} />}
    </div>
  )
}
