# Phase 2.5, Module 1: POS Wireframes

Status: complete. Design only, no application code changed by this module.

## What was made

A private Design canvas of 11 artboards, stored as source in design/wireframes/pos (canvas.json plus one .dc.html per screen; Main.dc.html is the register). Canvas link (private): https://claude.ai/artifact/Uk1s2U9NKXJnMzra8zphun

Page "POS Screens":
- Sign in (1280x800): cashier login.
- Register (1280x800): product search and barcode field, product grid, cart, discount, customer, totals, charge button.
- Customer picker (520x680): search or add a customer, opens over the register.
- Payment (720x780): cash, card and other, split payments, change due.
- Sale complete (720x780): confirmation with print, email and new sale actions.
- Receipt (420x820): printable receipt layout.
- Sales history (1280x800): list of POS sales with search and filters.
- Return items (600x780): pick items and quantities to return, refund summary.
- Daily summary (1280x840): gross, refunds, net, sales count, payment method split, per-cashier totals.

Page "Flow & Components": the end-to-end flow diagram and the POS component inventory.

Sample data is consistent across screens: subtotal 125.00, 10% discount 12.50, 8% tax 9.00, total 121.50, paid as card 60.00 plus cash 70.00 (change 8.50), sale #1043; return refund 36.94; daily net 2,184.60.

## Fit with the existing backend

The screens use only what the commerce core already has: Order.channel POS, Payment.method (cash, card, other), Customer, Location, shared pricing and createOrder, Refund, and the single inventory ledger. Nothing on the register needs a second stock or order model.

## Assumptions and deferrals (all eight were accepted; what was built is in Phase2_5_Module8_POS_Backend.md)

1. Cash drawer open and close (float, counted cash, variance) is not designed. The daily summary only reports totals.
2. One register per store location. Multiple registers or terminals are not modelled.
3. Barcode input is a keyboard-style scanner into the search field. No printer or scanner drivers, no card terminal integration: card is recorded as a payment method, not processed.
4. No offline mode. The register needs the API.
5. Item-level returns are drawn, but the current refund flow refunds a whole payment. Partial item returns need backend work in the POS refunds item.
6. Held (parked) sales need storage that does not exist yet. The register shows the button as a later feature.
7. Open question: who may give a manual discount, and is there a percentage cap? Currently drawn as available to any cashier.
8. Roles: the login screen assumes cashier accounts through the existing staff module and permissions.

## Accessibility finding

The POS design uses darker text and accent colors than the shipped tokens because the Phase 0 values fail 4.5:1 contrast. The shipped tokens in frontend/src/index.css were corrected in the same change; details are in Audit_Phase0_to_Phase2.md. The Phase 0 canvas itself was not edited.

## Next

The POS backend, register screens and returns were built next; see Phase2_5_Module8_POS_Backend.md and Phase2_5_POS_Frontend.md. Phase 3 has not been started.