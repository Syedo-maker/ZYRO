import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../../lib/apiClient'
import type { StoreTheme } from '../../../lib/storeTheme'
import { themeApi, type ThemeState } from '../../../lib/themeApi'

/**
 * The Studio's working copy of the store theme (Store Themes, Part 2).
 *
 * Every change shows at once in the controls and is saved as a draft shortly after (a colour being
 * dragged or a word being typed becomes one Undo step, not fifty). The server answers with the draft
 * after the contrast guard and the tokens the preview wears; any correction it made comes back as
 * `notice` for the page to announce. Undo, Redo, restore, the assistant and polish all go through
 * the server too, so the draft trail lives in one place.
 */
export function useThemeDraft(storeId: string, onError: (message: string) => void) {
  const [state, setState] = useState<ThemeState | null>(null)
  const [theme, setTheme] = useState<StoreTheme | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pending = useRef<{ theme: StoreTheme; timer: number } | null>(null)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const accept = useCallback((next: ThemeState) => {
    setState(next)
    // A change typed while this was in flight wins over the server's copy; it is saved next.
    if (!pending.current) setTheme(next.draft)
    if (next.corrections.length > 0) setNotice(next.corrections.map((c) => c.message).join(' '))
  }, [])

  useEffect(() => {
    let cancelled = false
    themeApi
      .get(storeId)
      .then((s) => {
        if (cancelled) return
        setState(s)
        setTheme(s.draft)
      })
      .catch((e) => !cancelled && setLoadError(e instanceof ApiError ? e.detail ?? e.message : 'Could not load the theme.'))
    return () => {
      cancelled = true
    }
  }, [storeId])

  const flush = useCallback(async () => {
    const job = pending.current
    if (!job) return
    window.clearTimeout(job.timer)
    pending.current = null
    setSaving(true)
    try {
      accept(await themeApi.saveDraft(storeId, job.theme))
    } catch (e) {
      onErrorRef.current(e instanceof ApiError ? e.detail ?? e.message : 'Could not save the theme.')
      // Show what is really saved rather than a change that did not stick.
      themeApi.get(storeId).then((s) => {
        setState(s)
        setTheme(s.draft)
      }).catch(() => undefined)
    } finally {
      setSaving(false)
    }
  }, [accept, storeId])

  /** A change from the controls: shown now, saved after `delay` ms of quiet. */
  const change = useCallback(
    (next: StoreTheme, delay = 450) => {
      setTheme(next)
      setNotice(null)
      if (pending.current) window.clearTimeout(pending.current.timer)
      pending.current = { theme: next, timer: window.setTimeout(() => void flush(), delay) }
    },
    [flush]
  )

  /** Runs a server action (undo, publish, assistant...) after any change still waiting to be saved. */
  const run = useCallback(
    async <T extends { state?: ThemeState } | ThemeState>(action: () => Promise<T>): Promise<T | null> => {
      await flush()
      setSaving(true)
      try {
        const result = await action()
        const next = 'draft' in result ? (result as ThemeState) : (result as { state?: ThemeState }).state
        if (next) {
          setState(next)
          setTheme(next.draft)
          setNotice(next.corrections.length > 0 ? next.corrections.map((c) => c.message).join(' ') : null)
        }
        return result
      } catch (e) {
        onErrorRef.current(e instanceof ApiError ? e.detail ?? e.message : 'Something went wrong. Please try again.')
        return null
      } finally {
        setSaving(false)
      }
    },
    [flush]
  )

  useEffect(() => () => {
    // Leaving the page: save what is waiting rather than dropping it.
    if (pending.current) void flush()
  }, [flush])

  /** Takes a state the page fetched itself (the assistant's answer carries one). */
  const adopt = useCallback((next: ThemeState) => {
    setState(next)
    setTheme(next.draft)
    setNotice(next.corrections.length > 0 ? next.corrections.map((c) => c.message).join(' ') : null)
  }, [])

  return { state, theme, saving, notice, loadError, change, run, flush, adopt }
}
