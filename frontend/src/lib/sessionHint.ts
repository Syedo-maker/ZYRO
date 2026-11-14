/**
 * Whether this browser had a signed-in session last time we knew, so a signed-out visitor's page load
 * does not ask the server to restore a session that does not exist. That request answered 401 on every
 * page for everyone signed out, and browsers print it as a red console error.
 *
 * Only a yes/no flag: the session itself is the httpOnly refresh cookie, which scripts cannot read.
 * "unknown" (nothing stored yet, or storage refused) means try the restore, exactly as before.
 */
const KEY = 'zyro_signed_in'

export type SessionHint = 'yes' | 'no' | 'unknown'

export function readSessionHint(): SessionHint {
  try {
    const value = localStorage.getItem(KEY)
    return value === '1' ? 'yes' : value === '0' ? 'no' : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function writeSessionHint(signedIn: boolean): void {
  try {
    localStorage.setItem(KEY, signedIn ? '1' : '0')
  } catch {
    // Storage refused: every load then tries the restore, as it always did.
  }
}

/** Restoring on page load is worth a request unless we know there is no session. */
export const shouldTryRestore = (hint: SessionHint) => hint !== 'no'
