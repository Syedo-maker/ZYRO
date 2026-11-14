import { Link } from 'react-router-dom'
import { LegalLayout } from './LegalLayout'
import { LEGAL } from '../../lib/legal'
import { usePageMeta } from '../../lib/pageMeta'

const mail = (subject: string) => `mailto:${LEGAL.contactEmail}?subject=${encodeURIComponent(subject)}`
const LINK = 'text-text underline underline-offset-4'

/** How to reach the people who run ZYRO, and when to ask a shop instead. */
export function ContactPage() {
  usePageMeta({ title: 'Contact | ZYRO', description: 'How to reach the team behind ZYRO, and how to get help with an order from a shop.' })
  return (
    <LegalLayout
      template={false}
      title="Contact"
      intro={
        <p>
          ZYRO is run by {LEGAL.operator}. Write to <a href={`mailto:${LEGAL.contactEmail}`} className={LINK}>{LEGAL.contactEmail}</a>; we answer
          within {LEGAL.replyWithin}.
        </p>
      }
      sections={[
        {
          id: 'orders',
          heading: 'A question about an order',
          body: (
            <p>
              Each shop on ZYRO sells its own products and handles its own orders, delivery and returns. Contact the shop you bought from: its
              details are in your order confirmation, and its returns and delivery rules are on its <strong>Shop policies</strong> page, linked at
              the bottom of every page of the shop. If a shop does not answer, write to us with your order number and the shop's name, and we will
              follow it up.
            </p>
          ),
        },
        {
          id: 'merchants',
          heading: 'Running a shop on ZYRO',
          body: (
            <p>
              For help with your shop, your plan or a payment, write to <a href={mail('Help with my shop')} className={LINK}>{LEGAL.contactEmail}</a>{' '}
              from the email you sign in with, and include your shop's name.
            </p>
          ),
        },
        {
          id: 'report',
          heading: 'Report a shop or a product',
          body: (
            <p>
              To report a shop selling something illegal, counterfeit or unsafe, or a listing that uses your work or trademark, write to{' '}
              <a href={mail('Report a shop')} className={LINK}>{LEGAL.contactEmail}</a> with a link to the page and what is wrong with it. The rules
              every shop agrees to are in the <Link to="/terms" className={LINK}>Terms of Service</Link>.
            </p>
          ),
        },
        {
          id: 'privacy',
          heading: 'Your personal data',
          body: (
            <p>
              To get a copy of your data, correct it or have it deleted, write to{' '}
              <a href={mail('My personal data')} className={LINK}>{LEGAL.contactEmail}</a>. The <Link to="/privacy" className={LINK}>Privacy Policy</Link>{' '}
              explains what we hold and why.
            </p>
          ),
        },
      ]}
    />
  )
}
