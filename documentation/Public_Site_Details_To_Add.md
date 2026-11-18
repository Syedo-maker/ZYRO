# Public site: details to add later

The public website says "coming soon" for its contact details and names the operator only as "Zyro".
When these exist, add them in `frontend/src/lib/legal.ts` and to the pages that use it. Nothing here is
published on the site.

| Detail | Value |
|---|---|
| Legal name of the operator | [to be added] |
| Registered address | [to be added] |
| Registration number, if any | [to be added] |
| Public contact email | [to be added] |
| Public contact phone or WhatsApp | [to be added] |
| Help center address | [to be added] |
| Social media accounts | [to be added] |

After a lawyer has reviewed the Terms of Service and the Privacy Policy, set `reviewedByLawyer` to `true`
in the same file. Until then both pages keep their "Template" note.

`frontend/e2e/public-content.e2e.mjs` fails if a personal name, an academic phrase, or a real email
address appears on a public page. When a real public contact address is added, allow that one address in
`frontend/e2e/banned-public-terms.mjs`.
