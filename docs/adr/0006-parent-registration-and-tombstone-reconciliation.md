# ADR 0006: Reconcile Parent Room Deregistration with Explicit Tombstones

- Status: Accepted
- Date: 2026-07-22

## Context

A Parent Room may serve up to three companion boards through one shared installed macro package. Removing one room from one board therefore cannot safely uninstall or deactivate the Parent macros. Board and Parent devices can also be offline, restart, or lose an acknowledgement between local retirement, Parent registration removal, and peripheral cleanup.

Treating a timeout as proof of deregistration would lose the only credentials the board can use to complete remote cleanup. Keeping the room selectable until the Parent responds would make deletion appear broken and could allow a retired Parent to continue affecting the board. Re-registering the same Parent serial while cleanup is pending also creates two conflicting intents unless one is explicitly chosen as newer.

## Decision

Parent Room Deregistration retires the selectable board record immediately after durable local writes, while preserving a hidden `pendingDeregistrations` tombstone until the Parent explicitly acknowledges the same transaction.

- The shared Parent macro package is never removed or deactivated by board deregistration.
- A tombstone retains the Parent serial, display/host fields, connection credentials, board peripheral ID, transaction ID, and creation time. It is not selectable and cannot become active.
- The Parent handles `DeregisterRequest` idempotently. It confirms the board peripheral is absent or purges it once, removes the board config and registration records, persists both, and only then sends `DeregistrationAccepted`.
- Silence, transport failure, authentication failure, or timeout is not proof of cleanup. The board retains the tombstone.
- Cleanup is attempted when deletion begins, when the board initializes, and whenever a valid message arrives from the tombstoned Parent.
- The Parent sends `RegistrationValidation` for saved boards at initialization. An actively registered board replies `RegistrationValidated`; a tombstoned board retries deregistration. An unknown board may ignore the Parent without affecting its normal experience.
- A matching transaction ID is required to remove a tombstone. Stale acknowledgements are ignored.
- Re-registering a tombstoned serial requires explicit confirmation. Acceptance makes registration the newer intent and runs the full handshake; only `ConfigAccepted` plus the local registration write replaces the tombstone.
- If both a durable registration and an old tombstone are found after a partial storage write, the durable registration is the newer committed intent and the stale tombstone is removed.

## Consequences

- Deletion is responsive in the board UI even when the Parent is offline, while remote state converges when communication returns.
- Parent macros remain available to other boards, and the Parent's registered-board limit is eventually reclaimed.
- Credentials can remain in hidden board storage after deletion until explicit Parent cleanup is proven. Device Administrators must continue protecting Macro Editor and generated storage access.
- Clean Installation can erase tombstones and therefore abandons any unconfirmed remote cleanup; this remains an explicit administrator reset.
- Parent validation cannot infer deregistration from a missing response. Only a board that still has an active registration or tombstone can provide explicit evidence.
