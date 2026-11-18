/**
 * Who runs Zyro and how to reach them: one place, used by the footer, the contact page, the Terms of
 * Service and the Privacy Policy, so they can never disagree. Contact details are not published yet, so
 * the site says "coming soon" as plain text: no links, no invented addresses. The details still to be
 * added are listed in documentation/Public_Site_Details_To_Add.md.
 */
export const LEGAL = {
  operator: 'Zyro',
  /** Shown wherever a page would give an address to write to. */
  contactEmail: 'Email: coming soon',
  /** When the Terms and the Privacy Policy last changed. */
  updated: '18 November 2026',
  /**
   * False until a lawyer has reviewed the Terms and the Privacy Policy. While false, both pages say
   * openly that they are a template not yet reviewed. Set it to true only after that review.
   */
  reviewedByLawyer: false,
} as const

/** The contact block of the footer and the contact page: plain text until the details exist. */
export const CONTACT_LINES = ['Email: coming soon', 'Contact: coming soon', 'Help center: coming soon'] as const
