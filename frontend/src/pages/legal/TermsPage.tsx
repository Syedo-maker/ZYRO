import { Link } from 'react-router-dom'
import { LegalLayout } from './LegalLayout'
import { LEGAL } from '../../lib/legal'

/** The Terms of Service: what ZYRO provides, what a merchant is responsible for, and the limits on both. */
export function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      intro={
        <>
          <p>
            These terms are the agreement between you and {LEGAL.operator} ("we"), who run ZYRO. By opening a shop or an account on ZYRO you
            accept them. They are written to be read; if anything is unclear, ask us at{' '}
            <a href={`mailto:${LEGAL.contactEmail}`} className="text-text underline underline-offset-4">{LEGAL.contactEmail}</a>.
          </p>
          <p>
            How we handle personal data is in the <Link to="/privacy" className="text-text underline underline-offset-4">Privacy Policy</Link>,
            which is part of these terms.
          </p>
        </>
      }
      sections={[
        {
          id: 'service',
          heading: 'What ZYRO is',
          body: (
            <p>
              ZYRO gives a business an online shop, a point-of-sale register for its counter, and AI tools that help write listings, answer
              shoppers and read figures. The shop belongs to the merchant. We provide the software it runs on; we are not a party to the sales
              made in it.
            </p>
          ),
        },
        {
          id: 'accounts',
          heading: 'Accounts',
          body: (
            <ul>
              <li>You must be an adult able to enter a contract, and the details you give must be true.</li>
              <li>You are responsible for your password and for what happens under your account, including what your staff do with the access you give them.</li>
              <li>Tell us at once if you think someone else has used your account.</li>
            </ul>
          ),
        },
        {
          id: 'merchants',
          heading: "A merchant's responsibilities",
          body: (
            <>
              <p>As the seller, you are responsible for:</p>
              <ul>
                <li>what you sell being legal to sell, and described truthfully, including any text an AI tool drafted for you;</li>
                <li>your prices, taxes, delivery and returns, and keeping the promises you make to your customers;</li>
                <li>your customers' personal data, which you may use only to serve them and as the law allows;</li>
                <li>checking a payment before treating an order as paid. ZYRO's checks on a bank-transfer receipt are a help, not a guarantee.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'payments',
          heading: 'Payments',
          body: (
            <ul>
              <li>Card payments are processed by Stripe, under Stripe's own terms. Cash on delivery and bank transfers are paid to the merchant directly.</li>
              <li>Money from a sale belongs to the merchant. Refunds and disputes are between the merchant and the customer.</li>
            </ul>
          ),
        },
        {
          id: 'plans',
          heading: 'Plans and billing',
          body: (
            <ul>
              <li>The Free plan costs nothing. Paid plans are billed monthly in advance through Stripe, at the prices on the pricing page when you subscribe.</li>
              <li>You can cancel a paid plan at any time; it runs to the end of the month you have paid for, then the shop moves to the Free plan. We do not refund part of a month.</li>
              <li>Each plan includes a monthly allowance of AI use; extra AI packs can be bought and are not refundable once used.</li>
              <li>We tell paying merchants before a price change takes effect, and it applies from their next billing month.</li>
            </ul>
          ),
        },
        {
          id: 'ai',
          heading: 'AI features',
          body: (
            <p>
              AI suggestions can be wrong. Nothing an AI tool writes is published, applied to your catalogue or used to accept a payment until a
              person has reviewed it and chosen to; that choice is yours. Do not rely on AI output for legal, tax or financial advice.
            </p>
          ),
        },
        {
          id: 'use',
          heading: 'What is not allowed',
          body: (
            <ul>
              <li>Selling anything illegal, counterfeit, or that infringes someone else's rights.</li>
              <li>Misleading or defrauding customers, or using ZYRO to collect payments for something you do not deliver.</li>
              <li>Trying to reach another shop's data, overload the service, or get around its limits or security.</li>
              <li>Sending spam, or using shoppers' details for anything other than serving them.</li>
            </ul>
          ),
        },
        {
          id: 'availability',
          heading: 'Availability and changes',
          body: (
            <p>
              We work to keep ZYRO running and secure, and to recover quickly when something goes wrong, but we cannot promise it will never be
              interrupted. We may change or improve features; if we stop offering something a paying merchant relies on, we will say so in
              advance.
            </p>
          ),
        },
        {
          id: 'ending',
          heading: 'Ending the agreement',
          body: (
            <p>
              You can close your shop or account at any time by writing to us. We may suspend or close a shop that breaks these terms, after
              warning you where the law and the situation allow. When a shop closes, you can ask for a copy of your data first.
            </p>
          ),
        },
        {
          id: 'liability',
          heading: 'Limits on liability',
          body: (
            <p>
              As far as the law allows, we are not liable for indirect losses, such as lost profits, or for losses caused by a merchant, a
              customer, or a service we rely on. Our total liability to a merchant in any year is limited to what that merchant paid us in that
              year. Nothing here limits a liability the law does not allow to be limited.
            </p>
          ),
        },
        {
          id: 'law',
          heading: 'Law and changes to these terms',
          body: (
            <p>
              These terms are governed by the laws of Pakistan. When they change, the date at the top changes, and merchants are told before a
              change that affects them takes effect; using ZYRO after that means accepting the new terms.
            </p>
          ),
        },
      ]}
    />
  )
}
