# 0007: Releases are blue-green, with automatic rollback

**Status:** Accepted, 2026-10-21.

## Context

A release that breaks checkout costs merchants sales until it is undone. Rebuilding and redeploying the
previous version takes minutes.

## Decision

The API and the site run in multiple-revision mode. Each release (`infra/scripts/release.sh`) pins
traffic to what is live, runs migrations, starts new revisions with no traffic, waits until they are
healthy, moves traffic, and smoke-tests the live site. Any failure moves traffic back to the previous
revision, which is still running: a rollback in seconds, with no rebuild. Production receives the
exact images staging tested, copied between registries.

## Consequences

- **Migrations must be backward compatible with the release before**: add, never remove or rename,
  in one step. The old revision keeps serving during a release and after a rollback.
- Up to five inactive revisions are kept, at no cost while inactive.
- A person approves every production release (the GitHub environment's required reviewers).
