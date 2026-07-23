# ADR 0001: Keep Runtime Domain Modules Unbundled

- Status: Accepted
- Date: 2026-07-20

The deployment-tool deferral recorded below was superseded by ADR 0002. The Companion Installer now deploys the unbundled source while preserving this ADR's module responsibilities and activation rules.

## Context

The initial solution concentrated Companion Device and Parent Room workflows into eight numbered source macros. As Parent Connectivity, Paired Environment policy, Companion Device call synchronization, Parent Call Coordination, and Standby Coordination became stateful domains, the entry macros accumulated unrelated timers, cancellation tokens, subscriptions, policies, and xAPI operations.

Customers may prefer fewer visible files, but bundling would make the deployed source harder to inspect and edit in the RoomOS Macro Editor. Core mechanics were still in development when this decision was made; ADR 0002 later introduced the Companion Installer without changing the unbundled runtime boundary.

## Decision

Keep the deployable source unbundled and organize it as an extensible numbered set of macros with stable domain responsibilities. The current runtime uses 15 numbered macros; adding a cohesive domain module does not require bundling or changing the activation model.

- `Custom-Campanion_1_Main_2026` remains the only active Companion Device entry macro.
- Imported Companion Device modules remain under their numbered source names.
- `Custom-Campanion_7_RoomReference_2026` remains the inactive Parent Room entry source and is installed as the active `Custom-Campanion_Room_2026` macro.
- `Custom-Campanion_12_ParentCallCoordination_2026` is installed on the Parent Room Device under the same numbered name as an imported dependency.
- `Custom-Campanion_14_PinMode_2026` remains a Companion Device-only imported domain module and is never installed on a Parent Room Device.
- `Custom-Campanion_15_ParentRegistration_2026` remains a Companion Device-only imported domain module and owns registration, deregistration, and reconciliation state.
- Only the Parent Room entry macro is activated by Parent Room provisioning; its helper modules remain dependencies.
- No generated bundle is a runtime or release artifact.
- The Companion Installer installs the source macros and preserves these module boundaries.

## Consequences

- Domain state, policies, xAPI subscriptions, and initial reads are located with the behavior they govern.
- Device Administrators see more source macros, but each file has a smaller and clearer responsibility.
- Parent Room provisioning must copy every imported Parent Room dependency before activating and restarting the Parent Room runtime.
- Syntax and focused ownership checks run across all numbered macros.
- Future test tooling should exercise controller interfaces directly without requiring production bundling.
