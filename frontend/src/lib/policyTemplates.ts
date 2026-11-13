import type { PolicyKind } from './policiesApi'

/**
 * Starting points for a shop's policies, written for a small shop selling in Pakistan (cash on
 * delivery, bank and wallet transfers, couriers). They are templates, not legal advice: each starts
 * with a line saying so, and Settings warns the owner while that line is still there.
 */
export const TEMPLATE_NOTE = 'TEMPLATE: have a lawyer review this, change everything in [brackets] to fit your shop, then delete this line.'

export const isStillTemplate = (text: string) => text.trimStart().startsWith('TEMPLATE:') || /\[[^\]\n]{2,60}\]/.test(text)

export const POLICY_TEMPLATES: Record<PolicyKind, (shop: string) => string> = {
  refund: (shop) => `${TEMPLATE_NOTE}

Returns
You can return an item to ${shop} within [7] days of receiving it if it is unused, in its original packaging, and you have the order number. Items that cannot be returned: [perishable goods, personal care items, items made to order, sale items].

Damaged or wrong items
If your order arrives damaged, faulty or not what you ordered, tell us within [48 hours] at [phone or WhatsApp number] with a photo. We will replace it or refund you, and we pay the return delivery.

How refunds are paid
- Paid by card: refunded to the same card. Your bank may take [5 to 10] working days to show it.
- Paid by bank or wallet transfer: refunded to the account you name, within [5] working days of the return reaching us.
- Paid cash on delivery: refunded by bank or wallet transfer to the account you name.
Delivery charges are refunded only when the item was damaged, faulty or wrong.

Refused parcels
If you refuse a cash-on-delivery parcel without a reason above, we may ask for advance payment on your next order.

Contact
[Shop email] / [phone or WhatsApp number]`,

  shipping: (shop) => `${TEMPLATE_NOTE}

Where we deliver
${shop} delivers across [Pakistan] through [courier name or names].

How long it takes
Orders are packed within [1 to 2] working days. Delivery usually takes [2 to 4] working days to major cities and [4 to 7] working days elsewhere. Public holidays and weather can add a few days.

Delivery charges
[Rs 200] per order, or free on orders over [Rs 3,000]. The charge is shown at checkout before you pay.

Cash on delivery
You pay the courier in cash when the parcel arrives. Please keep the exact amount ready. The courier will call the phone number you gave before delivering.

Tracking
When your order ships, we send the courier's tracking number by [email, SMS or WhatsApp].

If a delivery fails
The courier tries [two] times. After that the parcel comes back to us; we will contact you to arrange a new delivery, which may have a delivery charge.

Contact
[Shop email] / [phone or WhatsApp number]`,

  privacy: (shop) => `${TEMPLATE_NOTE}

Who we are
${shop} ("we") sells through an online shop run on ZYRO. We decide how your order details are used; ZYRO stores them for us and follows its own privacy policy at /privacy.

What we collect
To deliver your order: your name, phone number, delivery address, email (if given) and what you ordered. If you pay by bank or wallet transfer, the receipt you upload. If you make an account: your email and a password, which is stored scrambled and never visible to us.

What we use it for
To process, deliver and support your order; to call you about delivery; to send a reminder about items left in your cart if you are signed in (each email has a link to stop them); and to keep the records the law requires.

Who else sees it
The courier (name, phone, address); our payment providers when you pay online; ZYRO, which hosts the shop. We do not sell your details or use them for advertising.

How long we keep it
Order records for [5] years, for accounts and tax. Everything else is deleted when it is no longer needed.

Your choices
You can ask us for a copy of your details, to correct them, or to delete them, at [shop email]. We will reply within [30] days.`,

  terms: (shop) => `${TEMPLATE_NOTE}

These terms apply when you buy from ${shop} ("we") through this online shop.

Orders
An order is confirmed when we send the order confirmation. We may cancel an order if an item turns out to be out of stock or a price was clearly wrong; if you already paid, we refund you in full.

Prices
Prices are in Pakistani rupees and include [all taxes / the taxes shown at checkout]. Delivery charges are shown at checkout before you pay.

Payment
We accept [card payment, cash on delivery, bank or wallet transfer]. For cash on delivery you pay the courier when the parcel arrives.

Delivery, returns and refunds
See our shipping policy and our returns and refunds policy on this page.

Product information
We describe products as accurately as we can. Colours on screen may differ slightly from the real item.

Contact
[Shop name, address, email, phone or WhatsApp number]

Law
These terms are governed by the laws of [Pakistan]. [Optional: any dispute goes to the courts of (city).]`,
}
