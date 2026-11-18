import { Link } from 'react-router-dom'
import { LegalLayout } from './LegalLayout'
import { CONTACT_LINES } from '../../lib/legal'
import { usePageMeta } from '../../lib/pageMeta'

const LINK = 'text-text underline underline-offset-4'

/** How to reach Zyro (coming soon, as plain text), and when to ask a shop instead. */
export function ContactPage() {
  usePageMeta({ title: 'Contact | ZYRO', description: 'How to get help with an order from a shop, and when Zyro’s own contact details will be available.' })
  return (
    <LegalLayout
      template={false}
      title="Contact"
      intro={
        <>
          <p>Zyro is in early access, and our contact details are on the way.</p>
          <ul className="space-y-1 text-text-muted">
            {CONTACT_LINES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      }
      sections={[
        {
          id: 'orders',
          heading: 'A question about an order',
          body: (
            <p>
              Each shop on ZYRO sells its own products and handles its own orders, delivery and returns. Contact the shop you bought from: its
              details are in your order confirmation, and its returns and delivery rules are on its <strong>Shop policies</strong> page, linked at
              the bottom of every page of the shop.
            </p>
          ),
        },
        {
          id: 'merchants',
          heading: 'Running a shop on ZYRO',
          body: <p>Help for shop owners with a shop, a plan or a payment: coming soon.</p>,
        },
        {
          id: 'report',
          heading: 'Report a shop or a product',
          body: (
            <p>
              A way to report a shop selling something illegal, counterfeit or unsafe, or a listing that uses your work or trademark, is coming
              soon. The rules every shop agrees to are in the <Link to="/terms" className={LINK}>Terms of Service</Link>.
            </p>
          ),
        },
        {
          id: 'privacy',
          heading: 'Your personal data',
          body: (
            <p>
              A way to ask for a copy of your data, or to have it corrected or deleted, is coming soon. The{' '}
              <Link to="/privacy" className={LINK}>Privacy Policy</Link> explains what we hold and why.
            </p>
          ),
        },
      ]}
    />
  )
}
