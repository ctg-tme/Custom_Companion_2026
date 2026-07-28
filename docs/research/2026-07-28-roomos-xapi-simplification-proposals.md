# RoomOS xAPI Simplification Opportunities

- Research date: 2026-07-28
- Application baseline: `640353591f5ccfdc3ec37f3cae1880325bf4ad49`
  (`0.1.2.64`)
- Schema baseline: Cisco
  [`86904ec2394865044f5be807a001b67b81069596`](https://github.com/cisco-ce/roomos.cisco.com/commit/86904ec2394865044f5be807a001b67b81069596)
- Research status: analysis only; no runtime, installer, manifest, version, or
  device changes

## Question

Which xAPIs could simplify RoomOS solutions like Custom Companion, based on the
current public schema and the concrete work the project has had to implement?

This note deliberately separates:

1. **Existing xAPIs to adopt now** — objects present in both the project's minimum
   RoomOS 11.32.1 schema and the current 26.7.1 schema.
2. **Proposed Cisco xAPI additions** — paths or fields that do not exist in the
   26.7.1 schema. Their names, types, indexed status shape, literals, multiline
   bodies, and event children follow the conventions used by the published
   schema, but they are design proposals rather than available product features.

## Executive conclusion

The largest opportunity is not another meeting control. It is a native,
least-privilege RoomOS-to-RoomOS device link. Custom Companion currently builds
secure peer identity, credential storage, HTTP queuing, XML serialization,
application messages, heartbeats, remote status reads, callback routing, and
reconciliation above general-purpose `HttpClient`, `/getxml`, `/putxml`,
`Message Send`, and `Peripherals` primitives. A trusted link with typed remote
xAPI execution and feedback would remove most of that infrastructure.

The next most valuable primitives are:

| Priority | xAPI family | Main workload removed |
| --- | --- | --- |
| 1 | Trusted RoomOS DeviceLink with correlated messages | Stored peer passwords, Basic Authorization headers, `/getxml` and `/putxml`, XML parsing/building, the three-socket queue, custom message envelopes/callback routing, and much heartbeat/reachability code |
| 2 | Transactional Macro Projects with health | Per-file save/activate ordering, unconditional runtime restarts, source comparison, Release Contract log anchors, and ambiguous partial installs |
| 3 | Native macro storage | `Memory-Storage-Functions-V2`, generated JavaScript storage, storage-macro parsing, and application-level compare/write retry patterns |
| 4 | Reversible configuration policies | Manual Standalone capture/apply/restore, continuous re-enforcement, missing-snapshot handling, and restart windows that can learn Paired values as Standalone preferences |
| 5 | Stable call identity and correlation | URI/platform heuristics, repeated call-detail reads, current-booking matching heuristics, display-name lobby matching, and sparse-event polling |
| 6 | Form/progress messages and scoped alerts | Multi-stage TextInput/Prompt state machines, password-confirmation routing, progress-modal watchdogs, and global alert ownership arbitration |
| 7 | Runtime xAPI capability discovery | Optional-path exception probing, firmware/product matrices, and tests that infer path availability from selected release metadata |
| 8 | Owned UI Extension packages | Full XML reconciliation, WebWidget `ActivityData` normalization, ownership inference, and teardown risk to unrelated UI |
| 9 | HTTPClient validation diagnostics | Generic TLS/network remediation and repeated trial requests during registration and installer preflight |

There are also useful schema-backed improvements available immediately. The most
important are the indexed `Conference Call[n] BookingId`, `Meeting`,
`SessionType`, `ProximityCall`, `MeetingPlatform`, lobby capabilities, and typed
participant-list events. They can make the current call model more authoritative
without waiting for a new xAPI.

## Research method

### Official schema

Cisco's repository currently publishes **RoomOS 26.7.1 June 2026** as its newest
versioned schema file. It contains 3,083 objects:

- 634 Commands
- 1,448 Configurations
- 184 Events
- 817 Statuses

The project's minimum **11.32.1 September 2025** schema contains:

- 624 Commands
- 1,221 Configurations
- 181 Events
- 777 Statuses

Every existing recommendation below was checked in both schemas. Every proposed
path was compared as an exact `type + path` candidate against 26.7.1, and no
proposed path matched. Proposed additions to existing commands or events were
also checked against their current parameter or child lists.

Primary schema evidence:

- [Cisco schema directory](https://github.com/cisco-ce/roomos.cisco.com/tree/86904ec2394865044f5be807a001b67b81069596/schemas)
- [RoomOS 26.7.1 schema](https://github.com/cisco-ce/roomos.cisco.com/blob/86904ec2394865044f5be807a001b67b81069596/schemas/26.7.1%20June%202026.json)
- [RoomOS 11.32.1 schema](https://github.com/cisco-ce/roomos.cisco.com/blob/86904ec2394865044f5be807a001b67b81069596/schemas/11.32.1%20September%202025.json)
- [Current RoomOS xAPI browser](https://roomos.cisco.com/xapi)

The schema is evidence that an object is published for listed products, not that
every target device and operating state has been hardware-validated. Existing
recommendations still need focused device acceptance where noted.

### Current application workload

The current deployable runtime has 15 unbundled macros and 11,210 source lines.
The concentration of work indicates where general-purpose RoomOS primitives are
forcing application-level infrastructure:

| Current module | Lines | Work that a stronger xAPI could absorb |
| --- | ---: | --- |
| [`Custom-Campanion_15_ParentRegistration_2026.js`](../../Custom-Campanion_15_ParentRegistration_2026.js) | 1,546 | Multi-screen input, validation, credentials, provisioning stages, transaction correlation, replacement intent, and deregistration tombstones |
| [`Custom-Campanion_11_BoardCallSync_2026.js`](../../Custom-Campanion_11_BoardCallSync_2026.js) | 1,261 | Call identity normalization, join correlation, retries, authentication, stale-response rejection, and convergence |
| [`Custom-Campanion_10_PairedEnvironment_2026.js`](../../Custom-Campanion_10_PairedEnvironment_2026.js) | 1,193 | Configuration snapshots, optional-path detection, enforcement, restoration, DND renewal, and UI/WebWidget ownership |
| [`Custom-Campanion_12_ParentCallCoordination_2026.js`](../../Custom-Campanion_12_ParentCallCoordination_2026.js) | 1,087 | Call classification, repeated status reads, booking matching, participant polling, name matching, and lobby admission |
| [`Custom-Campanion_6_DeviceComms_2026.js`](../../Custom-Campanion_6_DeviceComms_2026.js) | 879 | HTTP queue, concurrency, TLS posture, Basic Authorization, XML building/parsing, non-2xx validation, and message envelopes |
| [`Custom-Campanion_7_RoomReference_2026.js`](../../Custom-Campanion_7_RoomReference_2026.js) | 872 | Installed peer runtime, registration authority, callback handling, persistent peer state, UI, and cleanup |
| [`Custom-Campanion_4_UI_2026.js`](../../Custom-Campanion_4_UI_2026.js) | 840 | Full panel XML generation, prompt/input helpers, alert ownership, icon and WebWidget reconciliation |

These line counts are not a claim that all code disappears with one primitive.
Domain rules remain. They show that transport, deployment, persistence, lifecycle,
and UI mechanics are large enough to justify platform-level APIs.

Recent history reinforces the same conclusion: several work packages were needed
to normalize WebWidget `ActivityData`, preserve ownership across transitions, and
track Standalone changes. Another large work package added transaction-correlated
registration progress and protected newer registration intent from older cleanup.
Those are sound application solutions, but they are also evidence of missing
ownership, transaction, and typed-state primitives.

## Existing xAPIs to adopt now

All paths in this section are present in both 11.32.1 and 26.7.1. These are not
Cisco feature requests.

### 1. Use the complete indexed Conference call context

The current Parent Room code reads `Status Call`, then separately obtains meeting
platform, protocol, and Webex invite link and applies fallbacks. The published
indexed conference call tree has additional authoritative fields:

| Existing status | Schema meaning | Suggested use |
| --- | --- | --- |
| `Conference Call[n] BookingId` | Booking identifier assigned to the conference | Fetch the active call's booking directly with `Bookings Get`, especially for Meeting Password resolution; retain identity fallback only when the field is empty |
| `Conference Call[n] Meeting` | Whether the device is in a Webex meeting | Prefer this to inferring Webex solely from protocol, URI, or free text |
| `Conference Call[n] SessionType` | `Call`, `Share`, or `InstantMeeting` | Prevent share-only sessions from entering call synchronization |
| `Conference Call[n] ProximityCall` | Whether the device is used in a paired Webex-app/Proximity call | Classify or exclude Webex-app paired behavior explicitly rather than treating it as an ordinary endpoint-originated meeting |
| `Conference Call[n] MeetingPlatform` | `Unknown`, `GoogleMeet`, `MSTeams`, `Webex`, or `Zoom` | Keep as the first platform signal, with documented fallback because Cisco describes it as inherited from `Bookings Put` |
| `Conference Call[n] Webex MeetingInviteLink` | Join link when the current meeting supports it | Keep as the first Companion Guest join target |

Primary references:
[BookingId](https://roomos.cisco.com/xapi/Status.Conference.Call.BookingId/),
[Meeting](https://roomos.cisco.com/xapi/Status.Conference.Call.Meeting/),
[SessionType](https://roomos.cisco.com/xapi/Status.Conference.Call.SessionType/),
[ProximityCall](https://roomos.cisco.com/xapi/Status.Conference.Call.ProximityCall/),
[MeetingPlatform](https://roomos.cisco.com/xapi/Status.Conference.Call.MeetingPlatform/),
and
[MeetingInviteLink](https://roomos.cisco.com/xapi/Status.Conference.Call.Webex.MeetingInviteLink/).
The exact booking lookup is
[Bookings Get](https://roomos.cisco.com/xapi/Command.Bookings.Get/).

Implementation direction:

1. Read the indexed `Conference Call[n]` entry that corresponds to the active
   call rather than an unindexed singleton when possible. Do not assume `n`
   equals a `Status Call` CallId: the published schema does not define that
   relationship, so correlate by observed fields until Proposal 5 supplies a
   stable identifier.
2. Carry `BookingId`, `Meeting`, `SessionType`, and `ProximityCall` in the
   Parent-authoritative `CallSync` details.
3. When `BookingId` is present, use
   `Command Bookings Get { Id: BookingId }` rather than listing and heuristically
   matching all current bookings. Retain the current URI/number matching only as
   a backwards-compatible fallback when `BookingId` is empty or `Bookings Get`
   cannot resolve it.
4. Use `Meeting=True`, `SessionType`, and `ProximityCall` before platform and URI
   heuristics.

Device acceptance must establish indexing behavior on each supported platform
and what fields are populated for scheduled, ad-hoc, Personal Room, Webex-app
paired, local-share, and unsupported-platform calls.

### 2. Use call capabilities instead of deriving permission from the roster

`Conference Call[n] Capabilities AdmitFromLobby` reports `Available` or
`Unavailable`, and `Conference Call[n] Capabilities IsModerator` reports
`True` or `False`. The current code searches the roster, finds the self
participant, and derives admission authority from host/cohost fields. Prefer the
capabilities as the permission gate, while keeping the self-participant fields
for user guidance and diagnostics.

Primary references:
[AdmitFromLobby](https://roomos.cisco.com/xapi/Status.Conference.Call.Capabilities.AdmitFromLobby/)
and
[IsModerator](https://roomos.cisco.com/xapi/Status.Conference.Call.Capabilities.IsModerator/).

This does not solve participant identity, but it removes one fragile inference
and makes host-role transitions visible through a status subscription.

### 3. Subscribe to the full typed participant lifecycle

The 11.32.1 and 26.7.1 schemas both contain:

- `Event Conference ParticipantList ParticipantAdded`
- `Event Conference ParticipantList ParticipantUpdated`
- `Event Conference ParticipantList ParticipantDeleted`
- `Event Conference ParticipantList NewList`
- `Event Conference ParticipantList ListCleared`

The current code subscribes to `ParticipantUpdated` when available and then starts
a bounded poll. Registering the full published event set can trigger one
coalesced `Conference ParticipantList Search` on real lifecycle changes and make
polling a short fallback rather than the primary discovery window. The event
payload is already rich: `CallId`, `ParticipantId`, `DisplayName`, `Status`,
host/cohost fields, URI, device data, and other participant state.

Primary references:
[ParticipantAdded](https://roomos.cisco.com/xapi/Event.Conference.ParticipantList.ParticipantAdded/),
[ParticipantUpdated](https://roomos.cisco.com/xapi/Event.Conference.ParticipantList.ParticipantUpdated/),
and
[ParticipantDeleted](https://roomos.cisco.com/xapi/Event.Conference.ParticipantList.ParticipantDeleted/).

This needs a device POC because event completeness during the lobby transition is
the exact uncertainty the current fallback poll protects against.

### 4. Use macro inventory and lifecycle as installation milestones

The schemas already expose:

- `Command Macros Macro Get` with optional `Name` and `Content`
- `Command Macros Runtime Status`
- `Event Macros Macro Saved`
- `Event Macros Macro Activated`
- `Event Macros Macro Started`
- `Event Macros Runtime Reloading`
- `Event Macros Runtime Reloaded`
- `Event Macros Runtime Ready`

Primary references:
[Macro Get](https://roomos.cisco.com/xapi/Command.Macros.Macro.Get/),
[Runtime Status](https://roomos.cisco.com/xapi/Command.Macros.Runtime.Status/),
[Macro Started](https://roomos.cisco.com/xapi/Event.Macros.Macro.Started/), and
[Runtime Ready](https://roomos.cisco.com/xapi/Event.Macros.Runtime.Ready/).

Two bounded improvements are available now:

1. Compare remote macro inventory/content before saving the Parent Room package,
   so an unchanged package need not be rewritten and need not force a Macro
   Runtime restart.
2. Use save/activate/start/runtime lifecycle events as transport and runtime
   milestones in the Companion Installer.

`Runtime Ready` and `Macro Started` do **not** prove Custom Companion completed its
own asynchronous initialization. The existing application-specific
initialization result remains necessary until RoomOS provides application health
status.

### 5. Inspect the administrator-owned HTTPClient allow list

`Command HttpClient Allow Hostname List` returns the administrator-maintained list
of up to ten permitted server expressions. When the list is non-empty, requests
can be sent only to matching hosts. The command is present in both compared
schemas.

Primary reference:
[HttpClient Allow Hostname List](https://roomos.cisco.com/xapi/Command.HttpClient.Allow.Hostname.List/).

The runtime and installer can read this list during prerequisite validation and
report when a requested Parent or Companion host is definitely excluded. They
should not add, remove, or clear entries: the allow list remains part of the
Device Administrator-owned HTTPClient posture.

This check improves one failure class but does not validate DNS, TCP reachability,
certificate chain trust, SAN matching, or credentials. Proposal 9 addresses that
larger gap.

### 6. Use structured UI inventory wherever it is reliable

`UserInterface Extensions List`, `Export`, `Panel Update`,
`Widget SetValue`, `Widget UnsetValue`, and
`Status UserInterface Extensions Widget[n] Value` are present in both schemas.
Continue preferring `Panel Update` for presentation-only changes and widget value
commands for feedback rather than resaving panel XML.

Primary references:
[Extensions List](https://roomos.cisco.com/xapi/Command.UserInterface.Extensions.List/),
[Extensions Export](https://roomos.cisco.com/xapi/Command.UserInterface.Extensions.Export/),
[Panel Update](https://roomos.cisco.com/xapi/Command.UserInterface.Extensions.Panel.Update/),
and
[Widget Value](https://roomos.cisco.com/xapi/Status.UserInterface.Extensions.Widget.Value/).

This is an incremental improvement, not an ownership solution. The current
WebWidget list response exposes the URL through `ActivityData`, and RoomOS still
does not expose an owned-package model. Proposal 8 covers that missing primitive.

## Proposed Cisco xAPI additions

The paths in this section are absent from the RoomOS 26.7.1 schema. Unless a
proposal explicitly says it extends an existing object, every listed
Configuration, Command, Status, and Event path is new.

The proposed `RequestId` fields use a `String` valuespace and are echoed without
interpretation. This follows the transaction-correlation pattern Custom Companion
already has to implement in its application envelope. Multiline bodies are
strings containing JSON or XML, matching existing multiline commands such as
`Macros Macro Save` and `UserInterface Extensions Panel Save`; the schema need
not add a JSON primitive type.

### Proposal 1: trusted RoomOS DeviceLink and correlated messages

#### Gap

`Peripherals Connect`, `HeartBeat`, and `Purge` provide inventory/liveness but no
mutual RoomOS identity, permission grant, credential vault, typed remote xAPI, or
remote feedback. `HttpClient` provides general HTTP requests but requires the
application to own remote credentials, headers, TLS diagnosis, URL construction,
serialization, parsing, concurrency, retries, and callbacks.

#### Proposed schema

**Configuration**

| Path | Valuespace | Purpose |
| --- | --- | --- |
| `Peripherals DeviceLink Mode` | Literal `Off\|On` | Administrator gate for accepting and initiating trusted RoomOS links |

**Commands**

| Path | Parameters/body |
| --- | --- |
| `Peripherals DeviceLink Pair` | `Address:String` required; `RemoteSerialNumber:String` required; `PairingCode:String` required; `Direction:Literal Outbound\|Inbound\|Bidirectional` required; `AccessProfile:String` required; `RequestId:String` optional |
| `Peripherals DeviceLink Unpair` | `ID:String` required; `RequestId:String` optional |
| `Peripherals DeviceLink xAPI Get` | `ID:String` required; `Type:Literal Configuration\|Status` required; `Path:String` required; `RequestId:String` optional |
| `Peripherals DeviceLink xAPI Command` | `ID:String` required; `Path:String` required; `RequestId:String` optional; multiline JSON command parameters/body |
| `Peripherals DeviceLink xAPI Feedback Register` | `ID:String` required; `SubscriptionId:String` required; `Type:Literal Configuration\|Status\|Event` required; `Path:String` required; `InitialValue:Literal False\|True` optional |
| `Peripherals DeviceLink xAPI Feedback Deregister` | `ID:String` required; `SubscriptionId:String` required |
| `Peripherals DeviceLink Message Send` | `ID:String` required; `Channel:String` required; `MessageId:String` required; `CorrelationId:String` optional; `ContentType:Literal Text\|JSON` required; `RequestId:String` optional; multiline content |

**Statuses**

- `Peripherals DeviceLink[n] ID` — String
- `Peripherals DeviceLink[n] Direction` — Literal
  `Outbound|Inbound|Bidirectional`
- `Peripherals DeviceLink[n] State` — Literal
  `Pairing|Connected|Degraded|Disconnected|Revoked`
- `Peripherals DeviceLink[n] RemoteSerialNumber` — String
- `Peripherals DeviceLink[n] RemoteProductPlatform` — String
- `Peripherals DeviceLink[n] LastSeen` — String timestamp
- `Peripherals DeviceLink[n] Capability[n]` — String

**Events**

| Path | Children |
| --- | --- |
| `Peripherals DeviceLink StateChanged` | `ID:String`, `RequestId:String`, `State:Literal`, `Reason:Literal`, `RemoteSerialNumber:String` |
| `Peripherals DeviceLink xAPI Feedback` | `ID:String`, `SubscriptionId:String`, `Sequence:Integer`, `Type:Literal Configuration\|Status\|Event`, `Path:String`, `Value:String` |
| `Peripherals DeviceLink Message Received` | `ID:String`, `Channel:String`, `MessageId:String`, `CorrelationId:String`, `ContentType:Literal Text\|JSON`, `Text:String` |
| `Peripherals DeviceLink Message DeliveryStatus` | `ID:String`, `Channel:String`, `MessageId:String`, `CorrelationId:String`, `Status:Literal Delivered\|Rejected\|Expired`, `Reason:Literal` |

#### Required semantics

- Pairing proves the expected remote serial before creating the durable link.
- RoomOS stores link secrets; macros receive only an opaque `ID`.
- `AccessProfile` is an administrator-created allow list of readable paths and
  executable commands. It must not imply remote Admin access.
- Feedback carries a monotonically increasing `Sequence` and can include the
  initial value atomically with registration.
- Structured messages preserve `MessageId`, `CorrelationId`, channel, and content
  type end to end. Delivery acknowledgement is generated by RoomOS rather than
  inferred from a second application message.
- Message channels are separately allowed by `AccessProfile`; accepting a link
  does not grant every installed macro a shared broadcast bus.
- Revocation is authoritative and automatically removes feedback registrations.
- TLS and device identity use RoomOS-managed certificates rather than a password
  copied into a JavaScript storage macro.

#### Custom Companion workload removed

This is the highest-payoff proposal. It can remove or radically shrink
DeviceComms' Basic Authorization, URL/XML builders, response XML parser, socket
queue, non-2xx normalization, parent identity GET, custom JSON-in-`Message Send`
envelope/transaction maps, callback credentials, and explicit peripheral
heartbeat. It can also
replace the Parent-installed runtime for simple status forwarding; Parent logic
that must execute locally, such as lobby admission, can remain as a much smaller
project.

### Proposal 2: transactional Macro Projects and declared health

#### Gap

RoomOS exposes per-file macro save/activate/deactivate/remove commands and runtime
restart. It has lifecycle events but no atomic project, package revision, content
checksum status, rollback, or application-declared health. Installers therefore
infer a release from filenames and source, and verify application initialization
through human-readable macro log messages.

#### Proposed schema

**Configuration**

None. Project installation remains an Admin command rather than ordinary device
configuration.

**Commands**

| Path | Parameters/body |
| --- | --- |
| `Macros Project Validate` | `ProjectId:String` required; `Revision:String` required; `ExpectedRevision:String` optional; `Mode:Literal Merge\|ReplaceOwned` optional; `RequestId:String` optional; multiline JSON project manifest and source |
| `Macros Project Apply` | Same parameters plus `Restart:Literal Never\|IfChanged\|Always` and `DryRun:Literal False\|True`; multiline JSON project manifest and source |
| `Macros Project Remove` | `ProjectId:String` required; `ExpectedRevision:String` optional; `RemoveStorage:Literal False\|True` default `False`; `RequestId:String` optional |
| `Macros Project Health Set` | `ProjectId:String` required; `State:Literal Starting\|Ready\|Degraded\|Failed` required; `Code:String` optional; `Text:String` optional |

`Macros Project Health Set` should be callable only by a running macro owned by
that Project, even if the macro has a broader role.

**Statuses**

- `Macros Project[n] ID` — String
- `Macros Project[n] Revision` — String
- `Macros Project[n] Checksum` — String
- `Macros Project[n] State` — Literal
  `Inactive|Starting|Running|Failed|Updating`
- `Macros Project[n] Health` — Literal
  `Unknown|Starting|Ready|Degraded|Failed`
- `Macros Project[n] LastError` — String
- `Macros Project[n] Macro[n] Name` — String
- `Macros Project[n] Macro[n] Active` — Literal `True|False`
- `Macros Project[n] Macro[n] Checksum` — String
- `Macros Project[n] Macro[n] State` — Literal
  `Inactive|Starting|Running|Failed`

**Events**

| Path | Children |
| --- | --- |
| `Macros Project ApplyCompleted` | `ProjectId:String`, `Revision:String`, `RequestId:String`, `Status:Literal Applied\|Unchanged\|Rejected\|RolledBack`, `Reason:String`, repeated `Macro` children with `Name`, `Status`, and `Checksum` |
| `Macros Project HealthChanged` | `ProjectId:String`, `Revision:String`, `Health:Literal`, `Code:String`, `Text:String` |

#### Required semantics

- Validate the whole package, imports, roles, activation set, storage policy, and
  size before any source changes.
- Apply all changes or restore the prior Project revision.
- `ReplaceOwned` removes only macros recorded as owned by that Project.
- `IfChanged` restarts only when active executable content or activation changes.
- Project health is separate from Macro Runtime readiness.

#### Custom Companion workload removed

This replaces multi-command putxml installation, per-file source reads, blind
rewrites, activation ordering, forced runtime restarts, legacy filename
reconciliation, and log-string initialization verification. It also gives the
Companion Installer and lab deployment workflow a typed, revision-correlated
result.

### Proposal 3: native macro storage with revisions and protected values

#### Gap

Macros have no durable key/value API. Custom Companion imports
`Memory-Storage-Functions-V2`, creates `Custom-Campanion-Storage`, validates
generated macro state, and builds application retry/reconciliation around writes.
Credentials required for autonomous callbacks are stored with general state.

#### Proposed schema

**Configuration**

None. Storage quotas and access are RoomOS-owned.

**Commands**

| Path | Parameters/body |
| --- | --- |
| `Macros Storage Get` | `Namespace:String` required; `Key:String` required |
| `Macros Storage Set` | `Namespace:String` required; `Key:String` required; `ExpectedRevision:String` optional; `Protection:Literal Plain\|Secret` default `Plain`; `RequestId:String` optional; multiline value |
| `Macros Storage Remove` | `Namespace:String` required; `Key:String` required; `ExpectedRevision:String` optional; `RequestId:String` optional |
| `Macros Storage List` | `Namespace:String` optional; `IncludeValues:Literal False\|True` default `False` |

**Statuses**

- `Macros Storage Namespace[n] Name` — String
- `Macros Storage Namespace[n] Revision` — String
- `Macros Storage Namespace[n] BytesUsed` — Integer
- `Macros Storage Namespace[n] Quota` — Integer

Secret keys and values must never appear in Status. A successful secret write
returns an opaque `SecretReference:String` that other approved xAPIs, such as a
DeviceLink or future HTTPClient profile, can accept without revealing the value
to the caller again.

**Event**

`Macros Storage Changed` children:
`Namespace:String`, `Key:String`, `Operation:Literal Set|Removed`,
`Revision:String`, and `RequestId:String`. The value is never included.

#### Required semantics

- Namespace ownership defaults to the calling Macro Project.
- `ExpectedRevision` is compare-and-set; a mismatch rejects without mutation.
- A multi-key transaction should be supported by allowing repeated entries in a
  multiline `Set` body or by a later `Macros Storage Transaction Apply`.
- `Secret` values are encrypted at rest, omitted from list/export/log output, and
  readable only by the owning project and explicitly authorized Admin sessions.
- Secret consumers take the opaque `SecretReference`; they do not require the
  macro to read a plaintext value and construct an Authorization header.
- Project removal defaults to preserving storage; destructive removal is explicit.

#### Custom Companion workload removed

This removes the external runtime dependency and generated storage macro,
eliminates source-file state parsing, provides native optimistic concurrency, and
separates protected credentials from ordinary registration and preference state.
Domain migrations, limits, tombstone semantics, and validation remain application
responsibilities.

### Proposal 4: reversible, continuously enforced configuration policies

#### Gap

A RoomOS macro can read and set configurations, but it cannot ask RoomOS to own a
temporary reversible policy. Custom Companion must capture exact Standalone
values, persist them, apply Paired values, subscribe to each path, reapply drift,
and restore the snapshot. Restart timing can still expose a transition window in
which a Paired-enforced value is learned as a Standalone preference.

#### Proposed schema

**Configuration**

None. This family manages temporary overlays; it does not create another
administrator configuration tree.

**Commands**

| Path | Parameters/body |
| --- | --- |
| `Configuration Policy Validate` | `PolicyId:String` required; `Revision:String` required; `RequestId:String` optional; multiline JSON array of `{Path, Value}` |
| `Configuration Policy Activate` | `PolicyId:String` required; `Revision:String` required; `Enforcement:Literal Once\|Continuous` default `Continuous`; `Persistence:Literal Runtime\|Device` default `Runtime`; `Timeout:Integer` optional; `RequestId:String` optional; multiline JSON array of `{Path, Value}` |
| `Configuration Policy Deactivate` | `PolicyId:String` required; `Restore:Literal False\|True` default `True`; `RequestId:String` optional |

**Statuses**

- `Configuration Policy[n] ID` — String
- `Configuration Policy[n] State` — Literal
  `Validating|Active|Degraded|Restoring|Inactive|Failed`
- `Configuration Policy[n] Owner` — String
- `Configuration Policy[n] Revision` — String
- `Configuration Policy[n] Enforcement` — Literal `Once|Continuous`
- `Configuration Policy[n] Persistence` — Literal `Runtime|Device`
- `Configuration Policy[n] Expires` — String timestamp
- `Configuration Policy[n] FailedPath[n]` — String

**Event**

`Configuration Policy StateChanged` children:
`PolicyId:String`, `Revision:String`, `RequestId:String`, `State:Literal`,
`Reason:Literal`, and repeated `FailedPath` strings.

#### Required semantics

- Activation atomically captures current values before changing any path.
- Validation reports unsupported, unauthorized, or state-dependent paths without
  mutation.
- A failed activation changes nothing.
- `Continuous` reasserts policy inside RoomOS and reports degradation rather than
  requiring one subscription per configuration.
- `Device` persistence retains the original snapshot and active overlay across
  reboot until explicit deactivation or timeout.
- Deactivation restores the complete original snapshot atomically.
- Conflicting policies are rejected or resolved through explicit priority; last
  writer must not silently destroy another policy's restoration value.

#### Custom Companion workload removed

This absorbs most configuration capture, per-path availability probing,
subscription-driven re-enforcement, stored Standalone preference snapshots,
restore ordering, and the documented Paired-to-Standalone restart hazard. It does
not replace required microphone mute, volume, DND, call-limit, or other command
and status policies unless Cisco later extends the model beyond Configuration.

#### Adjacent owner-scoped Do Not Disturb lease

Configuration overlays do not solve command-owned state. As a focused companion
proposal, extend the existing `Conference DoNotDisturb Activate` command with
`LeaseId:String` and `Owner:String`, and extend `Deactivate` with required
`LeaseId:String`. Add:

- `Status Conference DoNotDisturb Lease[n] ID` — String
- `Status Conference DoNotDisturb Lease[n] Owner` — String
- `Status Conference DoNotDisturb Lease[n] State` — Literal `Active|Expired|Released`
- `Status Conference DoNotDisturb Lease[n] Expires` — String timestamp
- `Event Conference DoNotDisturb Lease StateChanged` children
  `LeaseId:String`, `Owner:String`, `State:Literal`, `Reason:Literal`

Multiple leases compose: Do Not Disturb remains active until the final active
lease is released or expires, and one owner cannot deactivate another owner's
lease. A macro-owned lease can optionally release automatically when its project
stops. This removes Custom Companion's two-minute renewal timer for a five-minute
lease and prevents it from clearing administrator- or application-owned DND.

### Proposal 5: stable call identity, join correlation, and participant tags

#### Gap

The existing schema exposes useful call fields but no single stable Webex meeting
identity shared by multiple endpoints, no canonical Guest join target, and no
correlation value echoed through the call lifecycle. `Webex Join` has
`TrackingData`, but the 26.7.1 `CallSuccessful`, `CallFailed`, and
`CallDisconnect` children do not include it. Participant-list results and events
also do not expose an application tag supplied by the joining endpoint.

#### Proposed schema

**Configuration**

None.

**Extensions to the existing `Webex Join` command**

- Add `CorrelationId:String` optional.
- Add `ParticipantTag:String` optional.
- Add `HandoffToken:String` optional as an alternative to `Number` for an opaque
  same-meeting handoff.

`TrackingData` remains call-history metadata. `CorrelationId` is local lifecycle
correlation. `ParticipantTag` is visible only to authorized meeting moderators
through the participant list.

**New statuses**

- `Conference Call[n] MeetingId` — String, stable and equal on all endpoints in
  the same Webex meeting
- `Conference Call[n] JoinTarget` — String, canonical joinable meeting target
- `Conference Call[n] CorrelationId` — String copied from `Webex Join`

**New commands**

| Path | Parameters/result |
| --- | --- |
| `Conference Call Handoff Create` | `CallId:Integer` required; `Audience:Literal RoomOSDevice` required; `Timeout:Integer` optional; `RequestId:String` optional; returns `HandoffToken:String`, `MeetingId:String`, and `Expires:String` |
| `Conference Call Handoff Revoke` | `HandoffToken:String` required; `RequestId:String` optional |

**Extensions to existing participant results/events**

Add `ParticipantTag:String` to the result of
`Conference ParticipantList Search` and to:

- `Event Conference ParticipantList ParticipantAdded`
- `Event Conference ParticipantList ParticipantUpdated`
- `Event Conference ParticipantList ParticipantDeleted`

**New event**

`Conference Call StateChanged` children:
`CallId:Integer`, `Status:Literal`, `MeetingId:String`,
`MeetingPlatform:Literal`, `BookingId:String`, `JoinTarget:String`,
`CorrelationId:String`, `Reason:Literal`.

**Extensions to existing call events**

Add `CorrelationId:String` and `MeetingId:String` to `CallSuccessful`,
`CallFailed`, and `CallDisconnect`. `CallFailed` should also include
`CallId:Integer` when RoomOS allocated one.

#### Required semantics

- `MeetingId` is not a dial string and must not contain a meeting password.
- Two RoomOS endpoints in the same meeting see the same `MeetingId`.
- `JoinTarget` is safe to hand to `Webex Join Number` but contains no secret.
- `HandoffToken` is short-lived, single-purpose, revocable, and resolves meeting
  identity plus any Guest authentication context inside RoomOS without exposing a
  Meeting Password or reusable credential to the macro.
- `ParticipantTag` has a documented privacy boundary and is visible only where
  the caller is authorized to inspect the roster.
- Call events carry the same correlation value from command acceptance to the
  terminal event.

#### Custom Companion workload removed

The Parent can publish `MeetingId` and `JoinTarget` instead of a large set of
URI/number fallbacks. The Companion can compare the current meeting exactly and
correlate late success/failure events without generation heuristics. The Parent
can admit the exact waiting Companion by `ParticipantTag` rather than display
name, and no longer needs to GET the Companion's `/Status/Call` merely to prove
that a same-named lobby participant joined the same meeting.

### Proposal 6: form/progress messages and owner-scoped alerts

#### Gap

RoomOS `TextInput` collects one value and `Prompt` collects one choice. Complex
workflows require many display/response/clear subscriptions, FeedbackId routing,
password confirmation, timers, and application state. `Alert Display` and
`Alert Clear` have no `FeedbackId` in 26.7.1, so the alert is a global surface and
applications must arbitrate ownership themselves.

#### Proposed schema

**Configuration**

None.

**New commands**

| Path | Parameters/body |
| --- | --- |
| `UserInterface Message Form Display` | `FeedbackId:String` required; `Title:String` required; `Text:String` optional; `Duration:Integer` optional; `Target:Literal OSD\|RoomScheduler\|Controller` optional; `PeripheralId:String` optional; multiline JSON field definitions |
| `UserInterface Message Form Clear` | `FeedbackId:String` required; `Target:Literal OSD\|RoomScheduler\|Controller` optional; `PeripheralId:String` optional |
| `UserInterface Message Progress Display` | `FeedbackId:String` required; `Title:String` required; `Text:String` optional; `Maximum:Integer` optional; `Value:Integer` optional; `Cancelable:Literal False\|True` default `False`; `Target:Literal OSD\|RoomScheduler\|Controller` optional |
| `UserInterface Message Progress Update` | `FeedbackId:String` required; `Text:String` optional; `Value:Integer` optional |
| `UserInterface Message Progress Clear` | `FeedbackId:String` required; `Result:Literal Completed\|Failed\|Canceled` optional; `Text:String` optional |

Each field definition contains:
`Id:String`, `Type:Literal Text|Password|Choice|Toggle`,
`Label:String`, `Required:Literal False|True`,
`MinLength:Integer`, `MaxLength:Integer`, `Pattern:String`,
`ConfirmWith:String`, and repeated `Option` values as applicable.

**New events**

| Path | Children |
| --- | --- |
| `UserInterface Message Form Response` | `FeedbackId:String`; repeated `Field` children with `Id:String` and `Value:String` |
| `UserInterface Message Form Cleared` | `FeedbackId:String`, `Reason:Literal Submitted\|UserDismissed\|TimedOut\|Replaced\|Command` |
| `UserInterface Message Progress Canceled` | `FeedbackId:String` |
| `UserInterface Message Progress Cleared` | `FeedbackId:String`, `Result:Literal Completed\|Failed\|Canceled\|Replaced` |

**Extensions to existing Alert commands/events**

- Add `FeedbackId:String` optional to `UserInterface Message Alert Display`.
- Add `FeedbackId:String` optional to `UserInterface Message Alert Clear`.
- Echo `FeedbackId` in the existing
  `Event UserInterface Message Alert Display`.
- Add `FeedbackId:String` and `Reason:Literal` children to the existing
  `Event UserInterface Message Alert Cleared`.

#### Required semantics

- `Password` values are masked, never echoed into display metadata, and omitted
  from generic UI diagnostics.
- `ConfirmWith` performs equality validation on-device without returning the
  confirmation field separately.
- `Pattern` uses a documented bounded regular-expression subset.
- A clear with `FeedbackId` affects the alert only when the current alert has
  that identifier; otherwise it is an idempotent no-op. Omitting `FeedbackId`
  preserves today's global clear behavior for backwards compatibility.
- A form emits one terminal Response or Cleared event.
- Progress updates preserve one `FeedbackId`; an application does not clear and
  recreate a Prompt to change the current stage.

#### Custom Companion workload removed

One form can collect Parent host, expected serial, username, password, and
confirmation. The xAPI can enforce field shape and password equality before one
Response event, replacing much of the registration wizard's stage routing and
watchdogs. A Progress surface replaces the locked zero-duration Prompt,
Prompt.Cleared reopening, and per-stage UI watchdog pattern. Scoped alerts remove
the custom Companion Alert Ownership token model and prevent call, registration,
standby, and health workflows from clearing one another's notices.

### Proposal 7: runtime xAPI capability discovery

#### Gap

The public schema describes objects by release and product list, but a running
macro cannot query the effective API surface for its exact device, software,
registration mode, role, and current state. Applications probe JavaScript nodes,
catch command/configuration failures, or maintain their own capability matrices.

#### Proposed schema

**Configuration**

None.

**Command**

`SystemUnit xAPI Capabilities Get` parameters:

- `Type:Literal Command|Configuration|Status|Event` optional
- `Path:String` optional path or prefix
- `IncludeValuespace:Literal False|True` default `False`
- `IncludeUnavailable:Literal False|True` default `False`

The result contains repeated `Object` children:
`Type`, `Path`, `Availability:Literal Available|StateUnavailable|Unsupported`,
`Reason`, `Role[n]`, and, when requested, parameters/children and valuespaces.

**Statuses**

- `SystemUnit xAPI Schema Version` — String
- `SystemUnit xAPI Schema Checksum` — String

**Event**

`SystemUnit xAPI Capabilities Changed` children:
`SchemaVersion:String`, `SchemaChecksum:String`, and `Reason:Literal
SoftwareUpdated|RegistrationChanged|ModeChanged`.

#### Required semantics

- Results are filtered to the exact product and software.
- `Unsupported` is distinct from temporarily state-dependent unavailability.
- Secret or internal objects are not exposed by asking for the capability list.
- The checksum changes only when the effective object contract changes.

#### Custom Companion workload removed

Paired Environment initialization can ask once which optional paths exist instead
of walking dynamic xapi objects and interpreting exceptions path by path. The
Companion Installer can verify exact required xAPIs rather than inferring support
from minimum RoomOS and product-family declarations. Tests can use one explicit
capability response instead of constructing partial xapi trees.

### Proposal 8: owned UI Extension packages

#### Gap

UI Extensions can be listed, exported, saved, updated, and removed, but RoomOS has
no package owner, revision, checksum, dry-run, or replace-owned operation.
Applications must parse XML/`ActivityData`, infer ownership from IDs, and carefully
avoid deleting unrelated panels or the single current WebWidget.

#### Proposed schema

**Configuration**

None.

**Commands**

| Path | Parameters/body |
| --- | --- |
| `UserInterface Extensions Package Validate` | `PackageId:String` required; `Revision:String` required; `RequestId:String` optional; multiline XML or JSON package |
| `UserInterface Extensions Package Apply` | `PackageId:String` required; `Revision:String` required; `ExpectedRevision:String` optional; `Mode:Literal Merge\|ReplaceOwned` default `ReplaceOwned`; `DryRun:Literal False\|True` default `False`; `RequestId:String` optional; multiline package |
| `UserInterface Extensions Package Remove` | `PackageId:String` required; `ExpectedRevision:String` optional; `RequestId:String` optional |
| `UserInterface Extensions Package Export` | `PackageId:String` required |

**Statuses**

- `UserInterface Extensions Package[n] ID` — String
- `UserInterface Extensions Package[n] Revision` — String
- `UserInterface Extensions Package[n] Checksum` — String
- `UserInterface Extensions Package[n] State` — Literal
  `Active|Degraded|Inactive`
- `UserInterface Extensions Package[n] Panel[n] ID` — String
- `UserInterface Extensions Package[n] WebWidget[n] ID` — String
- `UserInterface Extensions WebWidget[n] PanelId` — String
- `UserInterface Extensions WebWidget[n] Name` — String
- `UserInterface Extensions WebWidget[n] URL` — String
- `UserInterface Extensions WebWidget[n] RefreshInterval` — Integer
- `UserInterface Extensions WebWidget[n] OwnerPackageId` — String

**Event**

`UserInterface Extensions Package ApplyCompleted` children:
`PackageId:String`, `Revision:String`, `RequestId:String`,
`Status:Literal Applied|Unchanged|Rejected|RolledBack`, `Reason:String`.

Add `UserInterface Extensions WebWidget Changed` with children
`PanelId:String`, `Name:String`, `URL:String`, `RefreshInterval:Integer`,
`OwnerPackageId:String`, and `Change:Literal Saved|Updated|Removed`.

#### Required semantics

- `ReplaceOwned` can remove only objects recorded under the same `PackageId`.
- Validation reports unsupported locations, duplicate IDs, invalid XML, and the
  single-WebWidget conflict without mutation.
- Export returns structured WebWidget URL and refresh information rather than
  placing the URL in an opaque activity field.
- A failed apply leaves the prior package intact.

#### Custom Companion workload removed

This replaces full panel ownership inference, per-ID removal loops, WebWidget
`ActivityData` normalization, replace/remove/save sequencing, and much of the
teardown inventory logic. The solution can apply or remove `cc26` UI as one owned
revision without risking unrelated extensions.

### Proposal 9: diagnostic HTTPClient validation

#### Gap

`HttpClient Get/Post/...` reports command success or an error, but Custom
Companion has to turn a failed request into broad guidance covering Mode, allow
list, DNS, routing, TCP, certificate chain, SAN matching, credentials, and HTTP
status. There is no non-mutating connection diagnostic that distinguishes these
stages before sending a provisioning or registration action.

#### Proposed schema

**Configuration**

None. The command observes the existing administrator-owned HTTPClient
configuration and never changes it.

**Command**

`HttpClient Validate` parameters:

- `Url:String` required
- `Header:StringArray` optional, maximum 20 as in existing HTTPClient commands
- `AllowInsecureHTTPS:Literal False|True` default `False`
- repeatable `Check:Literal DNS|TCP|TLS|HTTP` optional, maximum 4
- `Timeout:Integer` optional, 1–30
- `RequestId:String` optional

The command performs no application mutation and returns:
`RequestId`, `ResolvedAddress`, `DNS:Literal Passed|Failed|Skipped`,
`TCP:Literal Passed|Failed|Skipped`,
`TLS:Literal Passed|Failed|Skipped`,
`CertificateTrusted:Literal True|False|Unknown`,
`HostnameMatched:Literal True|False|Unknown`,
`CertificateSubject`, `CertificateIssuer`, `CertificateNotAfter`,
`HTTPStatus`, and `Reason`.

**Status**

None. Credentials, peer certificates, and diagnostic outcomes should not become a
persistent public status tree.

**Event**

Optional `HttpClient ValidationCompleted` for asynchronous clients, with the same
result children plus `RequestId`. A synchronous command result is sufficient for
macros.

#### Required semantics

- `HTTP` defaults to a safe `HEAD` or explicitly documented read-only probe.
- Authorization headers are never returned or logged.
- TLS results respect both the device-wide configuration and per-command
  `AllowInsecureHTTPS`.
- The command distinguishes trust-chain failure from hostname mismatch.
- The allow-list decision is reported separately from DNS.

#### Custom Companion workload removed

Registration and installer preflight can show one precise remediation instead of
enumerating every possible network/trust cause. The diagnostic also avoids using
a state-changing `/putxml` request as the first proof of bidirectional readiness.

## Cross-cutting correlation rule

Every new mutating or long-running command above includes `RequestId`, and every
completion event echoes it. Cisco should apply the same optional parameter to
high-value existing commands in a backwards-compatible extension:

- `Macros Macro Save`
- `Macros Macro Activate`
- `Macros Runtime Restart`
- `UserInterface Extensions Panel Save`
- `Conference Participant Admit`
- `Standby Activate`, `Deactivate`, and `Halfwake`
- `Webex Join`
- `HttpClient Get`, `Post`, `Put`, `Patch`, and `Delete`

The corresponding typed events should echo `RequestId` together with
`Status` and `Reason`. The 26.7.1 schema currently has no `RequestId` parameter on
the listed macro/runtime commands, `Webex Join`, or Alert commands, and its
`CallFailed` event contains only `Code` and `Message`. Standard correlation would
remove many application-generated transaction maps and make accepted commands
distinguishable from observed outcomes.

## Suggested adoption and advocacy sequence

### Use now

1. Add `BookingId`, `Meeting`, `SessionType`, and `ProximityCall` to the Parent
   call-details read and `CallSync` payload.
2. Make `Bookings Get { Id: BookingId }` the first exact current-booking lookup
   for Meeting Password resolution.
3. Gate lobby admission with `Capabilities AdmitFromLobby` and use
   `IsModerator` as supporting state.
4. Subscribe to ParticipantAdded, ParticipantUpdated, ParticipantDeleted,
   NewList, and ListCleared; keep a bounded fallback poll until device evidence
   demonstrates event completeness.
5. Compare Parent macro inventory/content before changing the installed package,
   and use macro/runtime lifecycle events as milestones without replacing the
   application-ready result.
6. Read `HttpClient Allow Hostname List` during preflight and report definite
   exclusions without changing administrator policy.

These are runtime/installer changes and therefore require a separate scoped work
package, tests, versioning, documentation, commit/push, and `board-device`
validation under the repository workflow. This research note implements none of
them.

### Ask Cisco first

For small, independently useful schema changes:

1. Add optional `FeedbackId` to Alert Display/Clear and extend the existing Alert
   Cleared event with `FeedbackId` and `Reason`.
2. Echo `CorrelationId` through Webex call lifecycle events.
3. Expose `MeetingId`, canonical `JoinTarget`, and participant tag correlation.
4. Add macro/project checksum, state, and application health.
5. Add `HttpClient Validate`.

For larger platform investments:

1. Trusted RoomOS DeviceLink.
2. Transactional Macro Projects.
3. Native macro storage.
4. Reversible configuration policies.
5. Owned UI Extension packages.
6. Runtime xAPI capability discovery.

## Boundaries and cautions

- None of the proposed paths is implemented in RoomOS 26.7.1.
- The proposed names are a reviewable contract sketch, not a claim about Cisco's
  internal architecture or roadmap.
- Existing schema presence does not replace Board Pro and Parent Room Device
  acceptance testing.
- Native storage or peer links must reduce credential exposure, not merely move
  plaintext credentials into a new command.
- Atomic project and UI package operations must be owner-scoped. A convenient
  `Replace` that can delete unrelated macros or UI would be unsafe.
- Reversible policy must define conflict and restart semantics before adoption.
- Stable meeting and participant identifiers must have explicit privacy and
  authorization boundaries.
- Existing Custom Companion trust, registration, pairing, parent provisioning,
  Standalone restoration, call preservation, single-attempt local xAPI, installer
  compatibility, and device-deployment decisions remain unchanged by this
  analysis.
