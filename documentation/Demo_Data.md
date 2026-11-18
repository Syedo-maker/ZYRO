# Demo data

`npm run seed:demo` in `backend/` fills an empty database with demo data only: a demo store
("Demo: Chai & Clay Co.") with products, categories, a published theme and four weeks of sample orders
dated relative to today, plus the small demo stores behind Product Scout.

It refuses to run on a database that has stores which are not demo stores, unless
`--allow-existing-stores` is passed. It needs `DATABASE_URL`, `MONGODB_URI` and `REDIS_URL`, with the
migrations already applied.

## On your own computer

| Role | Email |
|---|---|
| Owner | `video-owner@demo.zyro.local` |
| Manager | `video-manager@demo.zyro.local` |
| Cashier | `video-cashier@demo.zyro.local` |
| Customer | `video-shopper-ayesha@demo.zyro.local` |

Local password for all four: `Demo-Video-2026`. It is public, so it is for a local database only and
must not be reused anywhere. These details belong in this file and the terminal, never on a public page.

## On a hosted copy

The same email addresses are used, with a private password. Choose one of at least 12 characters and
set it as `DEMO_PASSWORD` in your terminal before seeding. Never write it in the repository, its
documentation or a chat. The seed refuses a database on another machine without it, refuses the public
passwords, and does not print it. Every demo account gets it, including the Product Scout demo stores,
so the public passwords do not work there. Run the seed with the same value if you run it again.
