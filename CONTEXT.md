# Custom Companion 2026

This context defines the canonical language for people interacting with or maintaining the Custom Companion solution.

## Language

**Companion Device**:
The movable RoomOS device that runs the Custom Companion entry macro and can operate independently or coordinate with one selected Parent Room Device.
_Avoid_: Companion board, board

**Parent Room Device**:
The fixed RoomOS device registered with a Companion Device and eligible to become its active Parent Room Device.
_Avoid_: Parent codec, parent device

**Standalone**:
The operating mode in which the Companion Device is not assigned to a Parent Room Device and functions independently.
_Avoid_: Unpaired mode, disconnected mode

**Paired**:
The operating mode in which the Companion Device is assigned to one active Parent Room Device.
_Avoid_: Connected mode, linked mode

**Companion Device Select**:
The in-room interface for choosing Standalone or a registered Parent Room Device and for opening the configuration controls for PIN Mode, Parent Room Registration, and Parent Room Deregistration.
_Avoid_: Select Device, room picker, board select

**Parent Room Registration**:
The durable relationship established after a Companion Device verifies the expected Parent Room Device identity and both devices recognize one another, making that Parent Room Device available for later selection. Registration does not select the Parent Room Device or change the Companion Device's operating mode, and it is unavailable only while the Companion Device is both Paired and participating in an active call.
_Avoid_: Pairing, active pairing, room setup

**Parent Room Deregistration**:
The confirmed removal of one Companion Device's durable relationship from both the Companion Device and Parent Room Device. It does not affect registrations held by other Companion Devices.
_Avoid_: Delete room macros, uninstall parent, unpair all Companion Devices

**Pending Deregistration**:
The state of a Parent Room Registration that the Companion Device has retired locally but the Parent Room Device has not confirmed removing. It is not a successful Parent Room Deregistration, and the Parent Room Device cannot be selected or become active.
_Avoid_: Registered room, deleted room, Paired room

**Device Administrator**:
A person with administrative access to the RoomOS device WebUI and Macro Editor who can diagnose and rectify solution health failures.
_Avoid_: In-Room User, room operator

**Companion Installer**:
A browser-based deployment tool used by a Device Administrator to configure and install the solution onto a Companion Device. A Parent Room Device is never its installation target, and Parent Room Device configuration belongs to the Companion Device UI.
_Avoid_: Parent installer, room installer

**Installer Credentials**:
The administrator account used only by the Companion Installer to connect to and deploy onto a Companion Device.
_Avoid_: Companion Device Callback Credentials, runtime credentials

**Companion Device Callback Credentials**:
An existing local Companion Device account distributed to registered Parent Room Devices so they can send runtime messages back to the Companion Device. It may be the same account as Installer Credentials, but keeping it distinct makes device audit activity attributable to its purpose.
_Avoid_: Installer credentials, administrator credentials

**Companion Device Identity Confirmation**:
The pre-installation proof that the connected Companion Device's serial number matches the serial number supplied by the Device Administrator. The observed serial is never disclosed by the Companion Installer.
_Avoid_: Device discovery, serial lookup

**Companion Device Installation Ready**:
The Companion Installer outcome reached when the installed Companion Device entry macro emits its initialization-complete message. It confirms that the Companion Device runtime initialized, not that any Parent Room Device is configured or ready.
_Avoid_: ParentReady, files uploaded

**Release Manifest**:
The installation contract published with a Custom Companion release. It identifies the release's required macro resources, minimum supported RoomOS version, and external dependencies that must be satisfied before installation.
_Avoid_: package manifest, file listing

**Release Contract**:
The build-time agreement that keeps the Release Manifest, eligible macro set, stable installer anchors, synchronized runtime project version, relative macro imports, JavaScript syntax, and Companion Device initialization messages consistent before an installation snapshot can be packaged.
_Avoid_: Manifest only, installer assumptions

**Clean Installation**:
The explicit Companion Installer choice that removes `Custom-Campanion-Storage` before installing the selected Custom Companion release. It discards the Companion Device's saved Parent Room Devices, active Parent Room Device selection, PIN Mode state, and captured Standalone UI and standby settings. Generated storage remains outside the Release Manifest and is never removed by a Standard Installation.
_Avoid_: Legacy purge, factory reset, normal upgrade

**Legacy Project Macro**:
An installed `Custom-Campanion_*_2026` macro that is absent from the selected Release Manifest. The Companion Installer lists these files explicitly, deactivates retained files, and checks its purge option by default; generated storage and unrelated macros are never Legacy Project Macros.
_Avoid_: Unknown macro, storage macro

**In-Room User**:
A person using the room touch interface who may operate the Companion Device but is not expected to perform device administration or technical remediation.
_Avoid_: Device Administrator, system administrator

**Unhealthy State**:
A solution-wide condition in which a required local prerequisite is unavailable and companion selection cannot operate reliably. Initialization prerequisite failures, invalid saved PIN Mode state, and failures of required Paired microphone, volume, or incoming-call isolation enforcement enter this state. An individual Parent Room Device being unavailable and an unsupported optional UI feature-policy path are not an Unhealthy State.
_Avoid_: Parent offline, room unavailable

**Call Preservation State**:
A temporary Paired condition in which the Companion Device preserves an active call while communication with its Parent Room Device is unavailable. Communication is considered restored only after the selected Parent Room Device returns a valid identity response whose serial number matches the selected Parent Room Device serial; normal heartbeat and call-state synchronization then resume through their existing paths.
_Avoid_: Standalone, disconnected call

**Paired Call Limit**:
The invariant that a Companion Device participates in at most one active-Parent Room Device-authorized call while Paired. Calling remains available through the Parent Room Device while Paired; a direct Companion Device call without current Parent Room Device authorization is disconnected and explained as requiring the call to start from the Parent Room Device. Parent Room runtime initialization, Parent Room Device selection, Companion Device initialization, and periodic checks replay authoritative Parent Room Device call state so late Paired transitions and runtime restarts converge. A failed periodic network check does not end a known authorized call; Call Preservation State still owns Parent Room Device-unavailable behavior. Standalone retains native RoomOS call behavior.
_Avoid_: Global call limit, Standalone call restriction

**Meeting Password**:
The transient password used to join a protected Webex meeting as Guest. When RoomOS requests Guest authentication, a Paired Companion Device may ask only its active Parent Room Device to resolve this value from exactly one current booking that matches the active Parent Room Device call. A Meeting Password is never solution configuration, PIN Mode state, stored memory, or log context; an unavailable or ambiguous result requires manual entry on the Companion Device.
_Avoid_: PIN Mode PIN, Host PIN, callback password, stored meeting credential

**Paired Do Not Disturb Lease**:
The solution-owned condition maintained while Paired that prevents incoming calls to the Companion Device. It is always released when the Companion Device enters Standalone and does not restrict Parent Room Device-requested outbound calls.
_Avoid_: Infinite DND loop, permanent Do Not Disturb, restored DND state

**Parent Connectivity**:
The live relationship through which a Companion Device verifies the identity and availability of its selected Parent Room Device and maintains communication with it.
_Avoid_: Pairing state, parent status check

**Deferred Surface**:
An intentionally visible or configured part of the product whose behavior has not been implemented yet. It remains organized with its intended product area but must not be presented as an available capability.
_Avoid_: Dead code, completed feature

**PIN Mode**:
An optional in-room access gate for opening Companion Device Select and authorizing Parent Room Registration or Parent Room Deregistration. When enabled, an In-Room User must enter the current PIN to open the panel and re-enter it for each registration or deregistration; it is not device authentication and does not restrict a Device Administrator using the device WebUI, Macro Editor, or API.
_Avoid_: Device authentication, administrator login, screen lock

**Default PIN**:
The bootstrap PIN used only when PIN Mode has not previously been initialized. It is not a recovery PIN or an ongoing override for the current PIN.
_Avoid_: Current PIN, recovery PIN, master PIN

**Recovery PIN**:
The built-in PIN used only to restore an administrator-recoverable PIN Mode when both the saved state and Default PIN are invalid. It never bypasses a healthy current PIN, and the solution remains Unhealthy until a Device Administrator completes recovery.
_Avoid_: Current PIN, Default PIN, master PIN

## User Communication

The companion WebWidget `info3` field is solution-owned runtime status space and is not editable deployment configuration. It displays active messages in this order: Unhealthy State, parent connectivity and Call Preservation, call synchronization, then standby. This is display precedence only; lower-priority behaviors continue while their messages are hidden and become visible again when the higher-priority condition clears.

During the Unhealthy State, `info3` persistently tells the In-Room User that Companion Device controls are unavailable and to contact a Device Administrator. Failure to update an unavailable Web Widget is logged but does not create another hard error.

During Call Preservation, `info3` remains visible with `{device} is temporarily unavailable. Your call will continue.` until the selected Parent Room Device is resynchronized or the call ends. The 60-second expiry applies only to the final Standalone connection-failure message.

When an active Parent Room Device call is not a joinable Webex meeting, call synchronization does not dial it and `info3` reads `[Platform] isn't supported. Start a Webex call from the Parent Room Device.`, with `[Platform]` replaced by the detected platform or `non-Webex`.

When a protected Webex meeting requires Guest authentication and no matching Meeting Password is available from the active Parent Room Device's current booking, `info3` and a duration-0 RoomOS alert read `Enter the meeting password manually on this Companion Device.` The notice clears when authentication completes, the Parent Room Device call ends, or the Companion Device leaves Paired mode.

## Transport

RoomOS HTTPClient requests use an internal three-second timeout. The timeout is an implementation policy in DeviceComms, not deployment configuration, so developers can tune it without expanding the administrator-facing configuration surface.

Repeatable periodic parent identity, call-status, and heartbeat requests are coalesced by parent and operation while an equivalent request is queued or in flight. All other state-changing requests are admitted FIFO and are never coalesced.

The shared HTTP queue has an internal global capacity of 50 pending requests. When full, the new request fails immediately with a stable administrator-facing transport code; an already queued request is never evicted. Queue capacity is an internal DeviceComms policy rather than deployment configuration.

The shared transport does not retry requests. Retry ownership remains explicit in the calling workflow: parent reachability uses its defined retry policy, periodic heartbeats retry on their next cycle, and state-changing `/putxml` commands are not replayed after an ambiguous failure.

HTTPClient requests explicitly ask RoomOS for `PlainText` response bodies so response validation can inspect XML. The QuickJS parser accepts the RoomOS response subset—declarations, comments, elements, self-closing elements, attributes, repeated siblings, text, standard and numeric entities, and CDATA—and rejects malformed XML, document-type declarations, and custom entities.

## Local xAPI Commands

Local xAPI commands are attempted once and are never retried. A local command failure indicates an API path, command, capability, or platform problem that must be diagnosed; repeated attempts must not obscure that fault. Retry policies apply only to network communication where explicitly defined.

A failed required Paired microphone-mute or volume-level enforcement command immediately enters the Unhealthy State. The console identifies the failed enforcement path with a stable diagnostic code, the normal `cc26_access` and `cc26_hidden` panels are replaced by `cc26_error`, and Parent Room Device selection remains blocked until the Macro Runtime restarts. Optional UI feature-policy paths are logged and skipped when unavailable.

If required media enforcement fails during an active call, the Companion Device remains assigned to its current Parent Room Device until that call ends. The native End Call control and `cc26_error` action button are shown; volume, microphone mute, Parent Room Device assignment, and the active call are otherwise left unchanged. When the call ends, the Companion Device transitions to Standalone and attempts the now-safe default-volume restoration once, but remains Unhealthy and blocks Parent Room Device selection until restart.

## Paired UI Feature Policy

The editable Paired UI feature policy uses explicit RoomOS xAPI paths. It captures each supported value before entering Paired mode and restores that value when returning to Standalone. An unavailable optional path is logged and skipped.

These controls remain available while Paired:

- `UserInterface.Features.Call.VideoMute = Auto`
- `UserInterface.Features.Call.ParticipantList = Auto`
- `UserInterface.Features.Whiteboard.Start = Auto`

These known controls are hidden while Paired:

- `UserInterface.Features.Call.AINotes`
- `UserInterface.Features.Call.AudioMute`
- `UserInterface.Features.Call.CameraControls`
- `UserInterface.Features.Call.End`
- `UserInterface.Features.Call.HdmiPassthrough`
- `UserInterface.Features.Call.JoinGoogleMeet`
- `UserInterface.Features.Call.JoinMicrosoftTeamsCVI`
- `UserInterface.Features.Call.JoinMicrosoftTeamsDirectGuestJoin`
- `UserInterface.Features.Call.JoinWebex`
- `UserInterface.Features.Call.JoinZoom`
- `UserInterface.Features.Call.Keypad`
- `UserInterface.Features.Call.LayoutControls`
- `UserInterface.Features.Call.MidCallControls`
- `UserInterface.Features.Call.MusicMode`
- `UserInterface.Features.Call.SelfviewControls`
- `UserInterface.Features.Call.SimultaneousInterpretation`
- `UserInterface.Features.Call.Start`
- `UserInterface.Features.Call.Webcam`
- `UserInterface.Features.Share.Start`

`UserInterface.Features.Call.End` temporarily changes to `Auto` during Call Preservation or an active-call Unhealthy State, returns to `Hidden` after Paired communication recovers, and restores its captured value in Standalone. RoomOS exposes no individual Raise Hand visibility configuration; hardware acceptance testing must confirm that Raise Hand remains available with `MidCallControls = Hidden` before any custom control is considered. Firmware acceptance testing must also check for newly introduced call controls because unknown paths cannot be governed automatically.

## Verification

Until the planned RoomOS macro test utility is available, this project does not add a separate automated test harness. Changes are checked with JavaScript syntax validation, diff validation, focused source searches, and documented device acceptance testing. The future utility should cover XML parsing, HTTP response validation and queue policy, Parent Room Device retry and state transitions, Paired UI policy decisions, media enforcement and restoration, Unhealthy transitions, user-message precedence, native control visibility, and call integrity through the deployable source-macro interfaces.
