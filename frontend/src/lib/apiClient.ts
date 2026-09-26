// Talks to the backend per backend/openapi.yaml. Defaults to a relative path so requests
// go through Vite's dev-server proxy (vite.config.ts) and stay same-origin: needed for
// the httpOnly refresh-token cookie to be sent reliably. Override via VITE_API_URL for a
// deployment where the frontend and backend aren't proxied together.
const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1'

// Access token lives in memory only (not localStorage) so it isn't reachable by an
// XSS payload reading browser storage; matches the backend's own httpOnly-cookie
// choice for the refresh token (see documentation/Phase1_Module1_Auth_MultiTenancy.md).
let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export class ApiError extends Error {
  status: number
  type: string
  detail?: string
  /** Any other members of the problem body, e.g. `upgrade` on a 402 plan limit. */
  extra: Record<string, unknown>

  constructor(status: number, type: string, title: string, detail?: string, extra: Record<string, unknown> = {}) {
    super(title)
    this.status = status
    this.type = type
    this.detail = detail
    this.extra = extra
  }
}

async function parseErrorBody(res: Response): Promise<ApiError> {
  try {
    const body = await res.json()
    const { type, title, status: _status, detail, ...extra } = body
    return new ApiError(res.status, type ?? 'about:blank', title ?? res.statusText, detail, extra)
  } catch {
    return new ApiError(res.status, 'about:blank', res.statusText)
  }
}

interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /** Internal: prevents infinite refresh loops. */
  _isRetry?: boolean
}

async function refreshAccessToken(): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
  if (!res.ok) return false
  const data = (await res.json()) as { accessToken: string }
  setAccessToken(data.accessToken)
  return true
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, _isRetry, headers, ...rest } = options
  const isFormData = body instanceof FormData

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    credentials: 'include', // always sent: the httpOnly refresh cookie rides along even on requests that don't need it
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  })

  if (res.status === 401 && !_isRetry) {
    const refreshed = await refreshAccessToken()
    if (refreshed) return apiFetch<T>(path, { ...options, _isRetry: true })
  }

  if (!res.ok) throw await parseErrorBody(res)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** What to show on the login and register forms. Rate-limit answers say how long to wait. */
export function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 429 && err.detail ? `${err.message}. ${err.detail}` : err.message
  }
  return 'Something went wrong. Please try again.'
}

export { refreshAccessToken }
