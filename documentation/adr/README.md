# Architecture decision records

One file per decision that shaped ZYRO and would be expensive to reverse. Each says what was
decided, why, what else was considered, and what it costs. A decision is never edited after the
fact; a later one that replaces it says so, and the old one is marked superseded.

| # | Decision | Status |
|---|---|---|
| [0001](0001-one-origin-for-site-and-api.md) | The site and the API share one origin, through an nginx container | Accepted |
| [0002](0002-mongodb-atlas-not-cosmos.md) | MongoDB Atlas on Azure, not Cosmos DB for MongoDB | Accepted |
| [0003](0003-azure-managed-redis.md) | Azure Managed Redis, single endpoint, no eviction | Accepted |
| [0004](0004-private-files-by-signed-link.md) | Receipts and voice notes are private files, reached only by expiring links | Accepted |
| [0005](0005-workers-in-their-own-process.md) | Background workers run in their own process | Accepted |
| [0006](0006-merchant-colour-on-storefronts.md) | Storefronts wear the merchant's colour, adjusted for contrast | Accepted |
| [0007](0007-blue-green-releases.md) | Releases are blue-green, with automatic rollback | Accepted |
| [0008](0008-contract-checked-in-every-test.md) | The API contract is checked in every test, in both directions | Accepted |
