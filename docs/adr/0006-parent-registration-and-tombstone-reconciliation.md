# ADR 0006: Reconcile Parent Room Deregistration with Explicit Tombstones

- Status: Accepted
- Date: 2026-07-22

## Context

A Parent Room Device may serve up to three Companion Devices through one shared installed macro package. Deregistering one Parent Room Device from one Companion Device therefore cannot safely uninstall or deactivate the Parent Room macros. Companion Devices and Parent Room Devices can also be offline, restart, or lose an acknowledgement between local retirement, Parent Room Registration removal, and peripheral cleanup.

Treating a timeout as proof of deregistration would lose the only credentials the Companion Device can use to complete remote cleanup. Keeping the Parent Room Device selectable until it responds would make deregistration appear broken and could allow a retired Parent Room Device to continue affecting the Companion Device. Re-registering the same Parent Room Device serial while cleanup is pending also creates two conflicting intents unless one is explicitly chosen as newer.

## Decision

Parent Room Deregistration retires the selectable Parent Room Device record immediately after durable local writes, while preserving a hidden `pendingDeregistrations` tombstone until the Parent Room Device explicitly acknowledges the same transaction.

- The shared Parent Room macro package is never removed or deactivated by Companion Device deregistration.
- A tombstone retains the Parent Room Device serial, display/host fields, connection credentials, Companion Device peripheral ID, transaction ID, and creation time. It is not selectable and cannot become active.
- The Parent Room Device handles `DeregisterRequest` idempotently. It confirms the Companion Device peripheral is absent or purges it once, removes the Companion Device config and registration records, persists both, and only then sends `DeregistrationAccepted`.
- Silence, transport failure, authentication failure, or timeout is not proof of cleanup. The Companion Device retains the tombstone.
- The user-visible removal workflow stays locked while it retries for 60 seconds. It reports `Parent Room Device Deregistered` only after the matching acknowledgement; otherwise it reports `Parent Room Deregistration Pending`, and a later acknowledgement replaces that notice with confirmed success.
- Cleanup is attempted when deregistration begins, when the Companion Device initializes, and whenever a valid message arrives from the tombstoned Parent Room Device.
- The Parent Room Device sends `RegistrationValidation` for saved Companion Devices at initialization. An actively registered Companion Device replies `RegistrationValidated`; a tombstoned Companion Device retries deregistration. An unknown Companion Device may ignore the Parent Room Device without affecting its normal experience.
- A matching transaction ID is required to remove a tombstone. Stale acknowledgements are ignored.
- Re-registering a tombstoned serial requires explicit confirmation. Acceptance makes registration the newer intent, suppresses the older tombstone's cleanup retries during the handshake, and only `ConfigAccepted` plus the local registration write replaces the tombstone.
- If both a durable registration and an old tombstone are found after a partial storage write, the durable registration is the newer committed intent and the stale tombstone is removed.

## Consequences

- Deregistration is responsive in the Companion Device UI even when the Parent Room Device is offline, while remote state converges when communication returns.
- Parent Room macros remain available to other Companion Devices, and the Parent Room Device's registered-device limit is eventually reclaimed.
- Credentials can remain in hidden Companion Device storage after deregistration until explicit Parent Room Deregistration cleanup is proven. Device Administrators must continue protecting Macro Editor and generated storage access.
- Clean Installation can erase tombstones and therefore abandons any unconfirmed remote cleanup; this remains an explicit administrator reset.
- Parent Room Device validation cannot infer deregistration from a missing response. Only a Companion Device that still has an active registration or tombstone can provide explicit evidence.
