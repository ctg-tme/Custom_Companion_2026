# Custom Companion 2026

This context defines the canonical language for people interacting with or maintaining the Custom Companion solution.

## Language

**StandAlone**:
The operating mode in which the companion board is not assigned to a parent room device and functions independently.
_Avoid_: Unpaired mode, disconnected mode

**Paired**:
The operating mode in which the companion board is assigned to one active parent room device.
_Avoid_: Connected mode, linked mode

**Device Administrator**:
A person with administrative access to the RoomOS device WebUI and Macro Editor who can diagnose and rectify solution health failures.
_Avoid_: In-Room User, room operator

**In-Room User**:
A person using the room touch interface who may operate the companion board but is not expected to perform device administration or technical remediation.
_Avoid_: Device Administrator, system administrator

**Unhealthy State**:
A solution-wide condition in which a required local prerequisite is unavailable and companion selection cannot operate reliably. Initialization prerequisite failures and failures of required paired microphone or volume enforcement enter this state. An individual parent device being unavailable and an unsupported optional UI feature-policy path are not an Unhealthy State.
_Avoid_: Parent offline, room unavailable

**Call Preservation State**:
A temporary Paired condition in which the companion board preserves an active call while communication with its parent room device is unavailable. Communication is considered restored only after the selected parent returns a valid identity response whose serial number matches the selected parent serial; normal heartbeat and call-state synchronization then resume through their existing paths.
_Avoid_: StandAlone, disconnected call

## User Communication

The companion WebWidget `info3` field displays active messages in this order: parent connectivity and Call Preservation, call synchronization, then standby. This is display precedence only; lower-priority behaviors continue while their messages are hidden and become visible again when the higher-priority condition clears.

During Call Preservation, `info3` remains visible with `{room} is temporarily unavailable. Your call will continue.` until the selected parent is resynchronized or the call ends. The 60-second expiry applies only to the final StandAlone connection-failure message.

## Transport

RoomOS HTTPClient requests use an internal three-second timeout. The timeout is an implementation policy in DeviceComms, not deployment configuration, so developers can tune it without expanding the administrator-facing configuration surface.

Repeatable periodic parent identity, call-status, and heartbeat requests are coalesced by parent and operation while an equivalent request is queued or in flight. All other state-changing requests are admitted FIFO and are never coalesced.

The shared HTTP queue has an internal global capacity of 50 pending requests. When full, the new request fails immediately with a stable administrator-facing transport code; an already queued request is never evicted. Queue capacity is an internal DeviceComms policy rather than deployment configuration.

The shared transport does not retry requests. Retry ownership remains explicit in the calling workflow: parent reachability uses its defined retry policy, periodic heartbeats retry on their next cycle, and state-changing `/putxml` commands are not replayed after an ambiguous failure.

HTTPClient requests explicitly ask RoomOS for `PlainText` response bodies so response validation can inspect XML. The QuickJS parser accepts the RoomOS response subset—declarations, comments, elements, self-closing elements, attributes, repeated siblings, text, standard and numeric entities, and CDATA—and rejects malformed XML, document-type declarations, and custom entities.

## Local xAPI Commands

Local xAPI commands are attempted once and are never retried. A local command failure indicates an API path, command, capability, or platform problem that must be diagnosed; repeated attempts must not obscure that fault. Retry policies apply only to network communication where explicitly defined.

A failed required paired microphone-mute or volume-level enforcement command immediately enters the Unhealthy State. The console identifies the failed enforcement path with a stable diagnostic code, the normal `cc26` panel is replaced by `cc26_error`, and parent selection remains blocked until the Macro Runtime restarts. Optional UI feature-policy paths are logged and skipped when unavailable.

If required media enforcement fails during an active call, the companion board remains assigned to its current parent until that call ends. The native End Call control and `cc26_error` action button are shown; volume, microphone mute, parent assignment, and the active call are otherwise left unchanged. When the call ends, the board releases to StandAlone and attempts the now-safe default-volume restoration once, but remains Unhealthy and blocks parent selection until restart.

## Paired UI Feature Policy

The editable Paired UI feature policy uses explicit RoomOS xAPI paths. It captures each supported value before entering Paired mode and restores that value when returning to StandAlone. An unavailable optional path is logged and skipped.

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

`UserInterface.Features.Call.End` temporarily changes to `Auto` during Call Preservation or an active-call Unhealthy State, returns to `Hidden` after Paired communication recovers, and restores its captured value in StandAlone. RoomOS exposes no individual Raise Hand visibility configuration; hardware acceptance testing must confirm that Raise Hand remains available with `MidCallControls = Hidden` before any custom control is considered. Firmware acceptance testing must also check for newly introduced call controls because unknown paths cannot be governed automatically.

## Verification

Until the planned RoomOS macro test utility is available, this project does not add a standalone automated test harness. Changes are checked with JavaScript syntax validation, diff validation, focused source searches, and documented device acceptance testing. The future utility should cover XML parsing, HTTP response validation and queue policy, parent retry and state transitions, Paired UI policy decisions, media enforcement and restoration, Unhealthy transitions, user-message precedence, native control visibility, and call integrity without changing the deployable eight-macro architecture.
