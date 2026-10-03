import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { voiceApi, type VoiceNote } from '../../lib/voiceBargainApi'

/**
 * Voice notes (Part G). A shopkeeper with their hands full says what they want changed, and the shop
 * writes it down for them to approve.
 *
 * Nothing here applies on its own, and the page says so plainly. Speech across Urdu, Roman Urdu and
 * English is misheard often, and prices and stock are not things to change on a maybe.
 */
export function VoiceNotesPage() {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const [notes, setNotes] = useState<VoiceNote[] | null>(null)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  const load = useCallback(async () => {
    if (!storeId) return
    setNotes(await voiceApi.list(storeId))
  }, [storeId])

  useEffect(() => {
    load().catch((e) => setNotice({ tone: 'error', text: errorMessage(e, 'Could not load your voice notes.') }))
  }, [load])

  async function startRecording() {
    setNotice(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunks.current = []
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' })
        if (blob.size === 0) return
        await send(blob, mr.mimeType?.includes('mp4') ? 'note.m4a' : 'note.webm')
      }
      recorder.current = mr
      mr.start()
      setRecording(true)
    } catch {
      setNotice({ tone: 'error', text: 'Could not use the microphone. Check that your browser is allowed to use it.' })
    }
  }

  function stopRecording() {
    recorder.current?.stop()
    recorder.current = null
    setRecording(false)
  }

  async function send(blob: Blob, filename: string) {
    if (!storeId) return
    setBusy('send')
    setNotice({ tone: 'info', text: 'Listening to your note...' })
    try {
      const note = await voiceApi.record(storeId, blob, filename)
      setNotice(note.draft ? { tone: 'success', text: 'Here is what I heard. Read it, then confirm it if it is right.' } : { tone: 'info', text: note.problem ?? 'Nothing could be made of that note.' })
      await load()
    } catch (e) {
      setNotice({ tone: 'error', text: errorMessage(e, 'Could not send that recording.') })
    } finally {
      setBusy(null)
    }
  }

  async function act(note: VoiceNote, what: 'apply' | 'discard') {
    if (!storeId) return
    setBusy(note.id)
    setNotice(null)
    try {
      if (what === 'apply') {
        const res = await voiceApi.apply(storeId, note.id)
        setNotice({ tone: 'success', text: res.outcome })
      } else {
        await voiceApi.discard(storeId, note.id)
      }
      await load()
    } catch (e) {
      setNotice({ tone: 'error', text: errorMessage(e, 'Could not do that.') })
    } finally {
      setBusy(null)
    }
  }

  if (!activeStore) return <p className="text-sm text-text-secondary">Create a store first.</p>
  if (!notes) return notice?.tone === 'error' ? <Alert>{notice.text}</Alert> : <Spinner label="Loading voice notes" />

  const pending = notes.filter((n) => n.status === 'pending')
  const past = notes.filter((n) => n.status !== 'pending')

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Voice notes</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Say what you want changed, in Urdu, Roman Urdu or English. Nothing changes until you confirm it.
        </p>
      </div>

      {notice && <Alert tone={notice.tone === 'info' ? 'info' : notice.tone}>{notice.text}</Alert>}

      <section aria-label="Record" className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-white p-5">
        {recording ? (
          <Button onClick={stopRecording} className="h-12">
            Stop and send
          </Button>
        ) : (
          <Button onClick={() => void startRecording()} disabled={busy !== null} className="h-12">
            {busy === 'send' ? 'Sending...' : 'Record a note'}
          </Button>
        )}
        {recording && <span className="text-sm font-semibold text-danger">Recording... speak now</span>}
        <p className="w-full text-xs text-text-secondary">
          For example: "chai cup ka price 450 kar do", or "steel kettle ka stock pachas kar do".
        </p>
      </section>

      <section aria-label="Waiting for you" className="rounded-2xl border border-border bg-white p-5">
        <h2 className="font-display text-base font-bold">Waiting for you to confirm</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">Nothing is waiting.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {pending.map((n) => (
              <li key={n.id} className="flex flex-col gap-2 border-t border-border pt-3">
                <p className="text-sm">
                  <span className="text-text-secondary">You said:</span> "{n.transcript}"
                  {n.language && <span className="ml-2 text-xs text-text-muted">({n.language})</span>}
                </p>
                {n.audioUrl && <audio controls src={n.audioUrl} className="h-8 w-full max-w-sm" aria-label="Play the recording" />}
                {n.summary ? (
                  <>
                    <p className="rounded-[10px] bg-bg px-3 py-2 text-sm font-semibold">{n.summary}</p>
                    {n.draft?.warnings.map((w) => (
                      <p key={w} className="text-xs text-warning">
                        {w}
                      </p>
                    ))}
                    <div className="flex gap-2">
                      <Button className="h-9 px-4 text-xs" disabled={busy !== null} onClick={() => void act(n, 'apply')}>
                        {busy === n.id ? 'Saving...' : 'Yes, make this change'}
                      </Button>
                      <Button variant="secondary" className="h-9 px-4 text-xs" disabled={busy !== null} onClick={() => void act(n, 'discard')}>
                        Discard
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-text-secondary">{n.problem}</p>
                    <div>
                      <Button variant="secondary" className="h-9 px-4 text-xs" disabled={busy !== null} onClick={() => void act(n, 'discard')}>
                        Discard
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section aria-label="Past notes" className="rounded-2xl border border-border bg-white p-5">
          <h2 className="font-display text-base font-bold">Earlier notes</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {past.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={n.status === 'applied' ? 'success' : 'neutral'}>{n.status === 'applied' ? 'Done' : 'Discarded'}</Badge>
                <span className="text-text-secondary">"{n.transcript}"</span>
                <span className="text-xs text-text-muted">{formatDateTime(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
