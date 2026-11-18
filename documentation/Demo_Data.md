# Demo data

`npm run seed:demo` in `backend/` fills an empty database with demo data only: a demo store
("Demo: Chai & Clay Co.") with products, categories, a published theme and four weeks of sample orders
dated relative to today, plus the small demo stores behind Product Scout.

It refuses to run on a database that has stores which are not demo stores, unless
`--allow-existing-stores` is passed. It needs `DATABASE_URL`, `MONGODB_URI` and `REDIS_URL`, with the
migrations already applied.

| Role | Email |
|---|---|
| Owner | `video-owner@demo.zyro.local` |
| Manager | `video-manager@demo.zyro.local` |
| Cashier | `video-cashier@demo.zyro.local` |
| Customer | `video-shopper-ayesha@demo.zyro.local` |

Demo password for all four: `Demo-Video-2026`. It is for demo data only: these accounts hold nothing
real, and this password must not be reused anywhere. These details belong in this file and the
terminal, never on a public page.
