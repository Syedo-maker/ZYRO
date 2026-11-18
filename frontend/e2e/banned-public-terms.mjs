// What must never appear on the public site or in the platform's emails: names, academic wording,
// personal contact details, and demo logins. Used by public-content.e2e.mjs and check-built-site.mjs.
export const BANNED = [
  // People and institutions
  /finalyear\d*/i, /muhammad\s+ibrahim/i, /\bibrahim\b/i, /syed\s+sikander/i, /\bsikander\b/i, /\bgillani\b/i,
  /saad\s+ilyas/i, /\bilyas\b/i, /shifa\s+tameer/i, /tameer-e-millat/i, /\bBSAI\b/i, /mibrahim/i,
  // Academic wording
  /final[\s-]+year/i, /\bFYP\b/i, /bachelor of science/i, /supervised by/i, /\bsupervisor\b/i, /developed by/i,
  /submitted to/i, /group members/i, /coursework/i, /student project/i, /university project/i, /\buniversity\b/i,
  /registered company/i, /\bbuilt as\b/i,
  // Demo logins and internal notes
  /demo (password|credential|account|login)/i, /test account/i, /password123/i, /internal note/i,
]

/** The subset safe to look for in minified JavaScript, where libraries bring their own words. */
export const BANNED_IN_BUNDLE = BANNED.filter((re) => !/university|built as|developed by|submitted to|test account|supervisor/.test(re.source))

/** Any real-looking email address (documentation addresses at example.com are allowed). */
export const EMAIL = /[a-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi
/** A Pakistani mobile number written out in full. */
export const PHONE = /(?:\+92[\s-]?3\d{2}[\s-]?\d{7}|\b03\d{2}[\s-]?\d{7}\b)/

export function findBanned(text, list = BANNED) {
  const hits = []
  for (const re of list) {
    const m = new RegExp(re.source, re.flags.replace('g', '')).exec(text)
    if (m) hits.push(m[0])
  }
  return hits
}
