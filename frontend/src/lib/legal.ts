/**
 * Who runs ZYRO and how to reach them: one place, used by the footer, the Terms of Service and the
 * Privacy Policy, so they can never disagree. These are the details the site already publishes. Before
 * ZYRO takes real merchants' money, the owners replace them with the legal name of the business that
 * operates it (Deployment_Runbook.md, "Before calling production live").
 */
export const LEGAL = {
  operator: 'Muhammad Ibrahim and Syed Sikander Gillani',
  contactEmail: 'finalyear860@gmail.com',
  /** When the Terms and the Privacy Policy last changed. */
  updated: '14 November 2026',
  /**
   * False until a lawyer has reviewed the Terms and the Privacy Policy. While false, both pages say
   * openly that they are a template not yet reviewed. Set it to true only after that review.
   */
  reviewedByLawyer: false,
  /** What the contact page promises about replies. The owners confirm this before launch. */
  replyWithin: 'two working days',
} as const
