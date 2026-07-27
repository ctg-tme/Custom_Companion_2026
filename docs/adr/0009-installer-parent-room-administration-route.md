# ADR 0009: Route Installer Parent Room Administration through the Companion Device

- Status: Accepted
- Date: 2026-07-27

## Context

Complete Setup may run against a Companion Device that already has Parent Room Registrations or Pending Deregistrations. A Device Administrator needs to see that state and may need to remove a registration, but direct browser edits to `Custom-Campanion-Storage` would bypass invariants and direct browser control of a Parent Room Device would duplicate the runtime's ownership.

## Decision

Keep the authenticated Companion Installer JSXAPI session connected on Complete Setup and add two transaction-correlated local `Message.Send` actions:

- `InstallerParentInventoryRequest` asks the Companion Device for sanitized Parent Room Registrations and Pending Deregistrations. The response contains name, host, serial, active status, and tombstone creation time only; it never contains stored usernames or passwords.
- `InstallerParentDeregistrationRequest` identifies one saved Parent Room Registration by serial. After browser confirmation, the Companion Device runs the existing Parent Room Deregistration pipeline with an installer presentation channel.

The installer presentation channel skips PIN Mode and in-room prompts because the Device Administrator already authenticated to the Companion Device. It does not skip the operating-mode transition, active-call release, durable local retirement, Pending Deregistration tombstone, remote cleanup retry, acknowledgement matching, or terminal result. If the Parent Room Device cannot confirm cleanup, the registration disappears from the saved list and appears under Pending Deregistrations.

The Companion Device accepts either action only when it names the connected Companion Device and declares the Installer source role. The current runtime emits transaction-correlated deregistration progress for the applicable Standalone, local-retirement, and remote-confirmation stages. Progress is additive and advisory; the browser treats command acceptance only as request acceptance and waits for the matching terminal macro-log result, including for retained runtimes without progress.

## Consequences

- Existing Parent Room state is visible before a Device Administrator adds or removes a Parent Room Device.
- Parent Room credentials remain private to Companion Device storage and its existing network workflows.
- Browser removal has the same durable and retry semantics as PIN-authorized in-room deregistration.
- The Companion Installer never edits generated storage or directly controls a Parent Room Device.
- A later administrative client must preserve this Companion Device-owned boundary rather than interpreting the Installer source role as general authorization.
