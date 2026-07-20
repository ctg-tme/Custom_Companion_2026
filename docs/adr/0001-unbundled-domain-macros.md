# ADR 0001: Keep Runtime Domain Modules Unbundled

- Status: Accepted
- Date: 2026-07-20

## Context

The initial solution concentrated board and parent workflows into eight numbered source macros. As Parent Connectivity, Paired Environment policy, board call synchronization, parent call coordination, and standby coordination became stateful domains, the entry macros accumulated unrelated timers, cancellation tokens, subscriptions, policies, and xAPI operations.

Customers may prefer fewer visible files, but bundling would make the deployed source harder to inspect and edit in the RoomOS Macro Editor. Core mechanics are still in development, and a deployment tool is intentionally deferred until those mechanics are complete.

## Decision

Keep the deployable source unbundled and organize it as 13 numbered macros with stable domain responsibilities.

- `Custom-Campanion_1_Main_2026` remains the only active companion-board entry macro.
- Imported board modules remain under their numbered source names.
- `Custom-Campanion_7_RoomReference_2026` remains the inactive parent entry source and is installed as the active `Custom-Campanion_Room_2026` macro.
- `Custom-Campanion_12_ParentCallCoordination_2026` is installed on the parent under the same numbered name as an imported dependency.
- Only the parent entry macro is activated by parent provisioning; its helper modules remain dependencies.
- No generated bundle is a runtime or release artifact.
- A future deployment tool may install the source macros, but it must preserve these module boundaries and is deferred until core behavior is complete.

## Consequences

- Domain state, policies, xAPI subscriptions, and initial reads are located with the behavior they govern.
- Device Administrators see more source macros, but each file has a smaller and clearer responsibility.
- Parent provisioning must copy every imported parent dependency before activating and restarting the parent runtime.
- Syntax and focused ownership checks run across all numbered macros.
- Future test tooling should exercise controller interfaces directly without requiring production bundling.
