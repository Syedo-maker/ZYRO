import { useEffect, useState } from 'react'
import { uploadsAreDemoOnly } from '../../lib/siteInfo'

/** Beside an upload control, on a deployment whose disk is temporary. Otherwise nothing is shown. */
export function UploadsDemoNotice() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    let cancelled = false
    void uploadsAreDemoOnly().then((demoOnly) => {
      if (!cancelled) setShow(demoOnly)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!show) return null
  return <p className="text-xs text-text-secondary">Demo site: uploaded files may disappear when the server restarts.</p>
}
