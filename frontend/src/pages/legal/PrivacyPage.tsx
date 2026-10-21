import { Link } from 'react-router-dom'
import { LegalLayout } from './LegalLayout'
import { LEGAL } from '../../lib/legal'

/**
 * The Privacy Policy. Every statement here describes what the code does; documentation/Privacy_Notes.md
 * holds the detail behind each, and must be kept in step with this page when the code changes.
 */
export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      intro={
        <>
          <p>
            ZYRO is an online shop, a point-of-sale register and a set of AI tools for small businesses, run by {LEGAL.operator} ("we"). This page
            says what we collect, why, who else handles it, and what you can ask us to do with it.
          </p>
          <p>
            It speaks to two kinds of people: <strong>merchants</strong>, who run a shop on ZYRO, and <strong>shoppers</strong>, who buy from one.
            When you buy from a shop, that shop is the seller and decides how your order is handled; we hold your order details for the shop
            and use them only to provide ZYRO to it.
          </p>
        </>
      }
      sections={[
        {
          id: 'collect',
          heading: 'What we collect',
          body: (
            <>
              <p><strong>Merchants and their staff:</strong> email address, name (if given), a password (stored only as a one-way hash), the shop's details, products, prices and stock, and the plan you are on. Card payments for a plan are taken by Stripe; we never see the card number.</p>
              <p><strong>Shoppers:</strong> what you need to receive an order: name, phone number, email and delivery address, and what you ordered. An account, if you make one, adds a password (hashed). Reviews you write show the name you choose.</p>
              <p><strong>Bank-transfer receipts:</strong> a screenshot of a transfer you send in. It can show names and account details, so it is kept privately: only the shop's staff can open it, through a link that stops working after an hour.</p>
              <p><strong>Voice notes:</strong> a merchant's spoken instruction about their catalogue, and its transcript.</p>
              <p><strong>What shoppers search for in a shop:</strong> the words only, counted once per shop per day. Anything that looks like an email address, a phone number or a long number is never stored. No name, account, device or address is attached.</p>
              <p><strong>Technical records:</strong> each request to our servers is logged with its path, result and time, and an id you can quote to us; these logs do not record your IP address. To stop password guessing, the address a request came from is held by our rate limiter for the length of its window (at most an hour), then forgotten.</p>
            </>
          ),
        },
        {
          id: 'use',
          heading: 'How we use it',
          body: (
            <>
              <ul>
                <li>To run each shop: show products, take orders, record payments, stock and refunds.</li>
                <li>To sign you in and keep your account secure, including limits on repeated wrong passwords.</li>
                <li>To send the emails ZYRO sends for a shop, such as a reminder about items left in a cart.</li>
                <li>For cash on delivery, to estimate whether an order is likely to be refused, so a shop can ask for advance payment. This uses a scrambled form of the phone number and counts of past deliveries and refusals; never the number itself, and never a name.</li>
                <li>To show a merchant their own figures and a weekly tip worked out from their own totals only.</li>
              </ul>
              <p>We do not sell personal data, and we do not use it for advertising.</p>
            </>
          ),
        },
        {
          id: 'ai',
          heading: 'AI features',
          body: (
            <>
              <p>
                Some features send text or images to an AI provider, <strong>Anthropic</strong>, to be read or written. Each sends only what that
                feature needs, and nothing is sent unless the feature is used:
              </p>
              <ul>
                <li>Writing product descriptions, tags and marketing copy: the product's details.</li>
                <li>The shopping assistant: the shopper's question and the shop's products.</li>
                <li>Checking a bank-transfer receipt: the receipt image, to read the amount, date and reference printed on it. The AI never decides whether a payment is accepted; the shop does.</li>
                <li>Voice notes: the recording is turned into text on our own servers; only the text is sent, to suggest the catalogue change, which the merchant must confirm.</li>
                <li>The weekly tip: the shop's totals, never customer details.</li>
              </ul>
              <p>AI never handles card data, and never sets a price or an amount on its own.</p>
            </>
          ),
        },
        {
          id: 'share',
          heading: 'Who else handles it',
          body: (
            <>
              <p>Only the services ZYRO is built on, each for its own part, under its own obligations to protect the data:</p>
              <ul>
                <li><strong>Microsoft Azure</strong>: hosting, databases, file storage and logs.</li>
                <li><strong>MongoDB Atlas</strong>: the product catalogue database, hosted on Azure.</li>
                <li><strong>Stripe</strong>: card payments for orders and plans.</li>
                <li><strong>Anthropic</strong>: the AI features described above.</li>
                <li><strong>SendGrid</strong>: sending email, such as cart reminders.</li>
                <li>A local payment gateway, when a shop and a shopper choose one, for that payment only.</li>
              </ul>
              <p>We share data with nobody else unless the law requires it.</p>
            </>
          ),
        },
        {
          id: 'directory',
          heading: 'The public shop directory',
          body: (
            <p>
              A shop with at least three products may appear in the public list of shops, showing its name, logo, colour, currency, category and
              one line written by its owner. Nothing about its sales, orders, plan or staff. A merchant can switch this off in Settings at any time.
            </p>
          ),
        },
        {
          id: 'security',
          heading: 'How it is protected',
          body: (
            <ul>
              <li>Everything travels encrypted (HTTPS), and the databases accept only encrypted connections.</li>
              <li>Passwords are stored only as one-way hashes.</li>
              <li>Each shop's data is kept apart from every other shop's, and checked on every request.</li>
              <li>Receipts and voice notes are private files, opened only through links that expire.</li>
              <li>Our servers sign in to the database, storage and secrets with managed identities rather than shared passwords.</li>
            </ul>
          ),
        },
        {
          id: 'keep',
          heading: 'How long we keep it',
          body: (
            <p>
              For as long as the shop or the account exists, because a shop needs its order history. When a shop or an account is deleted at
              your request, its data is removed. Copies remain only in backups, which expire on a fixed schedule and are used for nothing except
              recovering from an outage. Search counts are not linked to anyone, so there is nothing personal in them to keep or remove.
            </p>
          ),
        },
        {
          id: 'rights',
          heading: 'What you can ask us',
          body: (
            <>
              <p>
                You can ask for a copy of the personal data we hold about you, for it to be corrected, or for it to be deleted, by writing to{' '}
                <a href={`mailto:${LEGAL.contactEmail}`} className="text-text underline underline-offset-4">{LEGAL.contactEmail}</a>. If you
                bought from a shop, you can also ask the shop, since it is the seller; we will help it answer.
              </p>
              <p>We answer within 30 days, and do not charge for it.</p>
            </>
          ),
        },
        {
          id: 'storage',
          heading: 'Cookies and storage in your browser',
          body: (
            <>
              <p>Only what ZYRO needs to work:</p>
              <ul>
                <li>A sign-in cookie that keeps you signed in. It cannot be read by the page's code.</li>
                <li>A random id that keeps a guest's cart, and one that keeps a conversation with a shop's assistant. Neither identifies you.</li>
                <li>Which part of ZYRO you last used (shopping or running a shop), so it opens there.</li>
                <li>On the register, the sale in progress, until it is finished or the tab is closed.</li>
              </ul>
              <p>No advertising, analytics or tracking cookies, from us or anyone else.</p>
            </>
          ),
        },
        {
          id: 'children',
          heading: 'Children',
          body: <p>ZYRO is not meant for children. Opening a shop requires being an adult able to enter a contract.</p>,
        },
        {
          id: 'changes',
          heading: 'Changes to this policy',
          body: (
            <p>
              When this policy changes, the date at the top changes, and merchants are told before a change that affects them takes effect. The
              rules for using ZYRO are in the <Link to="/terms" className="text-text underline underline-offset-4">Terms of Service</Link>.
            </p>
          ),
        },
      ]}
    />
  )
}
