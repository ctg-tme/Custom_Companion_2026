# ADR 0008: Start Parent Room Registration through the Authenticated Companion Installer

- Status: Accepted
- Date: 2026-07-24

## Context

The in-room Parent Room Registration wizard correctly owns Parent Room Device identity confirmation, macro provisioning, peripheral registration, readiness/configuration acknowledgement, durable local storage, and Pending Deregistration reconciliation. It is intentionally PIN-gated for an In-Room User.

A Device Administrator completing a Companion Installer deployment needs to register Parent Room Devices from the browser without reproducing those stages in a second implementation or displaying registration prompts on the Companion Device. Direct JSXAPI access to a Parent Room Device would break the boundary that keeps Parent Room provisioning owned by the Companion Device.

## Decision

After confirmed Companion Device initialization, the Companion Installer retains its authenticated JSXAPI connection and sends a transaction-correlated local `Message.Send` envelope with action `InstallerParentRegistrationRequest`. The message contains only the Parent Room Device host, expected serial, credentials, and an explicit acknowledgement that permits replacement of an existing registration or Pending Deregistration.

The Companion Device accepts this action only when it names the connected Companion Device and declares the Installer source role. It starts the existing Parent Room Registration pipeline with an installer presentation channel:

- PIN Mode and all in-room prompts are skipped because the Device Administrator already authenticated to the Companion Device.
- Live Parent Room Device serial verification, capacity checks, Parent Room macro installation, peripheral connection, ParentReady, ConfigAccepted, storage commit, and tombstone handling remain unchanged.
- Existing registrations and Pending Deregistrations still require the explicit replacement acknowledgement.
- The Companion Device emits a transaction-correlated terminal macro-log result. The installer waits for that result rather than treating command acceptance as registration success.

This route is not a direct Parent Room Device control API. RoomOS administrator authentication authorizes the browser's local command; the Companion Device remains the only component that contacts and mutates a Parent Room Device.

## Consequences

- Device Administrators can add one or more Parent Room Devices during installation without operating the Companion Device UI.
- In-Room User registration retains its PIN-gated flow and visible prompts.
- A submitted local message is only a request. Parent Room Registration is successful only after the Companion Device emits the matching completion result.
- The action is deliberately narrow and uses the existing message envelope, so a future caller must not treat its declared source role as a general network authorization mechanism.
