# RoomOS UX and Function Opportunities

Research date: 2026-07-23  
Application baseline: `55ff3f7141a22e3bf6eb60fd13e7cdbd38a2dcac` (`0.1.2.41`)  
Research status: analysis only; no runtime or installer changes

## Question

Which native RoomOS capabilities or ideas from Cisco's
[`GVE_DevNet_Webex_Board_Companion_Mode_Alternative_Macro`](https://github.com/gve-sw/GVE_DevNet_Webex_Board_Companion_Mode_Alternative_Macro)
could strengthen the experience of the current Custom Companion solution without
turning the Parent Room Device and Companion Device into separately operated
systems or bloating the minimum viable offering?

## Executive conclusion

The current solution already exceeds the comparison macro in the difficult parts:
durable Parent Room Registration, serial-verified selection, automatic and
authoritative Webex call convergence, lobby admission, protected-meeting handling,
Call Preservation, Paired media enforcement, standby coordination, and safe
Standalone restoration.

The best unaccounted opportunities are not more user controls. They close places
where native RoomOS can still expose the Paired Companion as an independent
endpoint or can make its second screen more purposeful.

| Priority | Opportunity | Why it fits | MVO recommendation |
| --- | --- | --- | --- |
| 1 | Suppress the native mute warning while Paired | RoomOS defaults the warning to Enabled, but the Companion microphone is intentionally always muted; the warning would tell users to fix a condition the solution requires. | Strongest small MVO candidate |
| 2 | Suppress Proximity services while Paired | Nearby Webex clients should not see or control the wrong half of one logical room system. | Strong candidate |
| 3 | Define the Paired content-ingress policy | Hiding Share removes UI only; AirPlay, Miracast, Webex/Proximity, or auto-share inputs can still act independently. | Strong candidate after one policy decision |
| 4 | Make received presentations content-first | Automatically maximizing received content gives the Companion a clear second-screen function without adding UI. | Strong device POC |
| 5 | Hide local self-view while Paired | Removes redundant local chrome without stopping the Companion camera or presentation channel. | Small device POC |
| 6 | Use more authoritative call classification | Reduces incorrect synchronization caused by URI and booking-derived platform heuristics. | Reliability backlog |
| 7 | Let explicit Companion wake intent wake the Parent | Feels like one unit, but the relevant event semantics are not described by the schema. | Lab experiment, not MVO baseline |

The first four are the most compelling. Mute-warning suppression removes a
misleading native prompt created by the existing media policy. Proximity
suppression and content-ingress policy close functional gaps in the existing
Paired restrictions. Content-first presentation behavior makes the Companion's
second-screen role clearer without adding an in-room choice.

## Research method

### Official RoomOS schema

The current `roomos.cisco.com` application loads its schema catalog and schema JSON
from Cisco's public
[`cisco-ce/roomos.cisco.com`](https://github.com/cisco-ce/roomos.cisco.com)
repository. At the time of research, the catalog's newest published entry was
**RoomOS 26.7.1 June 2026**. Its schema contains 3,083 objects:

- 634 Commands
- 1,448 Configurations
- 184 Events
- 817 Statuses

Exact `type + path` pairs were compared with the public **11.32.1 September 2025**
schema because the solution Release Manifest declares RoomOS `11.32.1.1` as its
minimum. Unless stated otherwise, every recommended xAPI path below is present in
both schemas.

Primary schema evidence:

- [Schema catalog pinned to the researched Cisco commit](https://github.com/cisco-ce/roomos.cisco.com/blob/86904ec2394865044f5be807a001b67b81069596/schemas/schemas.json)
- [RoomOS 26.7.1 schema pinned to the researched Cisco commit](https://github.com/cisco-ce/roomos.cisco.com/blob/86904ec2394865044f5be807a001b67b81069596/schemas/26.7.1%20June%202026.json)
- [RoomOS 11.32.1 comparison schema](https://github.com/cisco-ce/roomos.cisco.com/blob/86904ec2394865044f5be807a001b67b81069596/schemas/11.32.1%20September%202025.json)
- [Current RoomOS xAPI browser](https://roomos.cisco.com/xapi)
- [Cisco xAPI introduction and feedback guidance](https://roomos.cisco.com/doc/TechDocs/Introduction)

### Current application

The analysis used the current runtime and documented architecture as authoritative:

- The Paired UI policy hides call, sharing, layout, self-view, and other independent
  controls while preserving Video Mute, Participants, and Whiteboard
  ([source](../../Custom-Campanion_10_PairedEnvironment_2026.js)).
- The Companion joins only the Parent-authorized Webex target as Guest
  ([source](../../Custom-Campanion_11_BoardCallSync_2026.js)).
- The Parent owns call classification, participant admission, and current-booking
  password resolution
  ([source](../../Custom-Campanion_12_ParentCallCoordination_2026.js)).
- Parent standby state currently flows to the Companion through a delayed,
  bypassable decision and then immediate synchronization
  ([source](../../Custom-Campanion_13_StandbyCoordination_2026.js)).
- The canonical one-unit, call-limit, media, user-message, and standby decisions are
  in [CONTEXT.md](../../CONTEXT.md) and [README.md](../../README.md).

### Comparison project

The comparison used the source at commit
[`2faabf7e155a24d563e80e4a9686ec51976a602e`](https://github.com/gve-sw/GVE_DevNet_Webex_Board_Companion_Mode_Alternative_Macro/commit/2faabf7e155a24d563e80e4a9686ec51976a602e).
That project is a Cisco sample macro, not a production architecture reference.

Its distinctive in-call behavior is concentrated in
[`CompanionModeEmulator.js`](https://github.com/gve-sw/GVE_DevNet_Webex_Board_Companion_Mode_Alternative_Macro/blob/2faabf7e155a24d563e80e4a9686ec51976a602e/CompanionModeEmulator.js#L76-L105):
mute the microphone, optionally stop main video, choose a layout, hide self-view,
position the presentation PiP, and maximize the presentation.

Its other UX consists primarily of manual companion on/off and join panels plus a
custom DTMF keypad relayed between devices
([Companion macro](https://github.com/gve-sw/GVE_DevNet_Webex_Board_Companion_Mode_Alternative_Macro/blob/2faabf7e155a24d563e80e4a9686ec51976a602e/CompanionModeEmulator.js#L35-L63),
[trigger macro](https://github.com/gve-sw/GVE_DevNet_Webex_Board_Companion_Mode_Alternative_Macro/blob/2faabf7e155a24d563e80e4a9686ec51976a602e/TriggerCompanionJoin.js#L124-L189)).
Those controls solve limitations of that macro's manual, multi-protocol design and
are not missing from this solution's automatic Webex-only model.

## What is already accounted for

| Comparison behavior or native concern | Current solution status |
| --- | --- |
| Parent call starts and Companion joins | Implemented with authoritative replay at initialization, selection, acceptance, local call loss, and periodic checks. |
| Parent disconnects and Companion leaves | Implemented, including call-limit and unrelated-call cleanup. |
| Companion microphone isolation | Stronger than the sample: initial read plus continuous enforcement, with an Unhealthy State on required-path failure. The native `UserInterface.MuteWarning` remains Enabled by default and is not yet governed. |
| Companion speaker isolation | Stronger than the sample: volume level 1 is continuously enforced and Standalone restoration is handled safely. |
| Incoming-call isolation | Implemented with a renewable Paired Do Not Disturb Lease. |
| Protected Webex meetings | Implemented with Guest authentication, exact active-booking password resolution, and manual fallback. |
| Lobby admission | Implemented when the Parent is host or cohost, with participant and call-identity validation. |
| Parent unavailable during a call | Implemented as Call Preservation rather than dropping the active call. |
| Whiteboard entry point | Implemented: `UserInterface.Features.Whiteboard.Start = Auto` while Paired. |
| Independent call/share controls | Hidden through an explicit captured-and-restored Paired UI policy. |
| Standby alignment | Implemented from Parent to Companion, including initial read, 30-second decision, bypass, and live updates. |
| Manual join and companion-mode toggle | Intentionally unnecessary: they would expose the two endpoints as separate systems and weaken convergence. |
| Custom DTMF keypad relay | Not relevant to the current Webex-only MVO; primarily supports bridge/post-dial flows in the comparison macro. |

## Opportunity 1: suppress the misleading native mute warning

### User value

The Companion microphone is deliberately and continuously muted while Paired.
RoomOS separately defaults `UserInterface.MuteWarning` to `Enabled`, which can
warn a user who starts speaking that the microphone is muted. On the Companion,
that is not an actionable condition: the solution requires the microphone to
remain muted. Suppressing this warning removes a misleading instruction without
adding any new control or changing the media policy.

The comparison macro works around the same situation with its own alert that says
the script muted the user
([source](https://github.com/gve-sw/GVE_DevNet_Webex_Board_Companion_Mode_Alternative_Macro/blob/2faabf7e155a24d563e80e4a9686ec51976a602e/CompanionModeEmulator.js#L69-L75)).
The current solution should not add another alert; it should prevent RoomOS from
presenting the irrelevant warning.

### Native API

- Capture/read/subscribe:
  `xapi.Config.UserInterface.MuteWarning.get()/on(...)`
- Paired:
  `xapi.Config.UserInterface.MuteWarning.set('Disabled')`
- Standalone:
  restore the captured value

[Cisco's MuteWarning reference](https://roomos.cisco.com/xapi/Configuration.UserInterface.MuteWarning/)
defines `Enabled` as showing a warning when a user starts talking while the
microphone is muted. The path and default are present in both the solution's
minimum 11.32.1 schema and the current 26.7.1 schema.

### Fit and caveats

- This belongs in the existing Paired Environment capture/apply/restore boundary.
- It is a high-confidence MVO enhancement because it resolves a direct
  contradiction between native UX and required Paired behavior.
- Treat it as an optional local UI path: one attempt, log and skip if unavailable,
  and do not enter the Unhealthy State. Required microphone mute enforcement
  remains unchanged.
- Restore the site's prior setting in Standalone rather than unconditionally
  enabling it.

## Opportunity 2: suppress the Companion as a second nearby endpoint

### User value

When the Companion is Paired, nearby users should discover and control the room,
not choose between two apparently independent Webex endpoints. The current policy
hides controls on the Companion and rejects unauthorized calls, but it does not
change native Proximity availability. A user can therefore choose the wrong
endpoint before the solution corrects the resulting behavior.

### Native API

- `xapi.Command.Proximity.Services.Deactivate()`
- `xapi.Command.Proximity.Services.Activate()`
- `xapi.Status.Proximity.Services.Availability.get()/on(...)`
  - `Available`
  - `Deactivated`
  - `Disabled`

Cisco describes Deactivate as disabling all Proximity services until the matching
Activate command is used. The commands are reversible and are present in the
solution's minimum schema:

- [Proximity Services Deactivate](https://roomos.cisco.com/xapi/Command.Proximity.Services.Deactivate/)
- [Proximity Services Activate](https://roomos.cisco.com/xapi/Command.Proximity.Services.Activate/)
- [Proximity Services Availability](https://roomos.cisco.com/xapi/Status.Proximity.Services.Availability/)

If disappearing from nearby client discovery is also required, the related
configuration is registration-specific:

- Webex cloud: capture/restore `xapi.Config.Webex.Proximity.Mode`; use `Off` while
  Paired.
- On-premises: capture/restore `xapi.Config.Proximity.Mode`; use `Off` while
  Paired.

[Webex Proximity Mode](https://roomos.cisco.com/xapi/Configuration.Webex.Proximity.Mode/)
has no effect on on-premises devices; [Proximity Mode](https://roomos.cisco.com/xapi/Configuration.Proximity.Mode/)
is the on-premises path.

### Fit and caveats

- This belongs in the existing Paired Environment capture/apply/restore boundary.
- Restore only a service that was available before Paired. Do not blindly activate
  a site-disabled service.
- Both commands are state-dependent and unavailable in Microsoft Teams installed
  or in-call states. That does not conflict with the Webex-only Paired call slice,
  but the path remains optional and should be feature-detected.
- Do not suppress ultrasound by changing `Audio.Ultrasound.MaxVolume`,
  `RoomAnalytics.PeoplePresenceDetector`, or motion-wake settings. Those settings
  affect occupancy and wake behavior beyond client discovery.

## Opportunity 3: make the hidden Share policy functionally complete

### User value

The current Paired policy sets
`UserInterface.Features.Share.Start = Hidden`. Cisco explicitly documents that this
removes buttons and UI elements only; it does **not** disable the underlying
sharing paths. A user can still share through a Webex client/Proximity, AirPlay,
Miracast, or an input configured for automatic far-end sharing. That lets the
Companion behave independently even though its Share button is gone.

[Cisco's Share Start reference](https://roomos.cisco.com/xapi/Configuration.UserInterface.Features.Share.Start/)
states this limitation directly.

### Native API

Relevant capture/apply/restore paths include:

- `xapi.Config.Video.Input.AirPlay.Mode`
- `xapi.Config.Video.Input.AirPlay.PresentationSelection`
  - `AutoShare`
  - `OnConnect`
- `xapi.Config.Video.Input.Miracast.Mode`
  - `Off`
  - `Manual`
  - `On`
- `xapi.Config.Video.Input.Miracast.PresentationSelection`
  - `AutoShare`
  - `OnConnect`
- applicable `xapi.Config.Video.Input.Connector[n].PresentationSelection`
  - `AutoShare`
  - `Desktop`
  - `Manual`
  - `OnConnect`
- `xapi.Status.Conference.Presentation.Mode`
  - `Off`
  - `Receiving`
  - `Sending`

Official references:

- [AirPlay Mode](https://roomos.cisco.com/xapi/Configuration.Video.Input.AirPlay.Mode/)
- [AirPlay PresentationSelection](https://roomos.cisco.com/xapi/Configuration.Video.Input.AirPlay.PresentationSelection/)
- [Miracast Mode](https://roomos.cisco.com/xapi/Configuration.Video.Input.Miracast.Mode/)
- [Miracast PresentationSelection](https://roomos.cisco.com/xapi/Configuration.Video.Input.Miracast.PresentationSelection/)
- [Conference Presentation Mode](https://roomos.cisco.com/xapi/Status.Conference.Presentation.Mode/)

### Product decision

Two policies are coherent:

1. **Strict one-unit policy:** while Paired, disable Proximity services, AirPlay,
   and Miracast, and prevent physical inputs from auto-sharing. Whiteboard remains
   separately available.
2. **Local-display policy:** allow content on the Companion screen but prevent
   automatic far-end transmission. Use `OnConnect` for AirPlay/Miracast and
   `Manual` for applicable physical connectors.

The strict policy is the cleanest extension of the current hidden Share and
Parent-started-call rules. The local-display policy preserves more utility but can
still produce a Companion-side prompt and should be judged on hardware.

Do not enumerate generic connector indices without product capability checks.
Board/Desk models expose different connectors and allowed values.

## Acceptance check: whiteboard and annotation

### User value

Whiteboard is deliberately kept visible while Paired, but `Whiteboard.Start` and
the ability to share an existing whiteboard into the call are separate RoomOS
settings. A device with a pre-existing
`UserInterface.Whiteboard.ShareInCall = Hidden` policy can show the Whiteboard app
while withholding its Share-in-call action.

### Native API

Add this optional path to the same captured-and-restored Paired UI policy:

- initial read/subscription:
  `xapi.Config.UserInterface.Whiteboard.ShareInCall.get()/on(...)`
- Paired value:
  `xapi.Config.UserInterface.Whiteboard.ShareInCall.set('Auto')`
- Standalone:
  restore the captured value

[Cisco's Whiteboard ShareInCall reference](https://roomos.cisco.com/xapi/Configuration.UserInterface.Whiteboard.ShareInCall/)
defines `Auto` as showing the Share button in the Call and Whiteboard apps and
`Hidden` as removing it.

`Whiteboard.ShareInCall` already defaults to `Auto`, and Board Pro
`UserInterface.LiveAnnotation.Enabled` defaults to `True` in the reviewed schema.
These should therefore be explicit hardware acceptance checks and documented
prerequisites, not automatic MVO configuration overrides. Only add
capture/apply/restore logic if lab validation or a supported site-policy scenario
shows that the intended whiteboard workflow is unavailable.

## Opportunity 4: make received content the Companion's visual priority

### User value

The comparison macro's strongest transferable idea is not its manual join UI; it
is that the secondary surface automatically becomes presentation-focused. The
current solution hides layout controls but does not assign the Companion a
specific view when content arrives.

### Native API

- Initial read/subscription:
  `xapi.Status.Conference.Presentation.Mode.get()/on(...)`
- When Paired and `Receiving`:
  `xapi.Command.Video.PresentationView.Set({ View: 'Maximized' })`
- When the received presentation becomes `Off`:
  `xapi.Command.Video.PresentationView.Set({ View: 'Default' })`
- Do not act on `Sending` without a separate whiteboard/local-share decision.

Cisco defines the presentation status as `Off`, `Receiving`, or `Sending`, and the
view command as `Default`, `Maximized`, or `Minimized`:

- [Conference Presentation Mode](https://roomos.cisco.com/xapi/Status.Conference.Presentation.Mode/)
- [Video PresentationView Set](https://roomos.cisco.com/xapi/Command.Video.PresentationView.Set/)

The comparison project applies `PresentationView=Maximized` at call success
([source](https://github.com/gve-sw/GVE_DevNet_Webex_Board_Companion_Mode_Alternative_Macro/blob/2faabf7e155a24d563e80e4a9686ec51976a602e/CompanionModeEmulator.js#L76-L93)).
The status-driven version above is better suited to the current architecture
because it handles presentations that start after the call and runtime restarts.

`Video.PresentationView.Set` is state-dependent and unavailable in Microsoft Teams
installed/in-call states. Treat failure as an optional presentation-policy warning,
not a required media enforcement failure.

## Opportunity 5: remove redundant local self-view

### User value

The Companion can remain a controllable second camera, but showing its own
self-view locally consumes content space and makes the two-part room feel more
like two independent endpoints. Hiding self-view does not stop outbound video.

### Native API

- Capture:
  `xapi.Status.Video.Selfview.Mode.get()` and optionally
  `FullscreenMode`/`PIPPosition`
- Paired:
  `xapi.Command.Video.Selfview.Set({ Mode: 'Off' })`
- Standalone:
  restore the captured state

Official references:

- [Video Selfview Set](https://roomos.cisco.com/xapi/Command.Video.Selfview.Set/)
- [Video Selfview Mode](https://roomos.cisco.com/xapi/Status.Video.Selfview.Mode/)

Do not substitute
`xapi.Command.Video.Input.MainVideo.Mute()` unless the product requirement is to
stop the Companion camera. Cisco states that MainVideo Mute stops outbound video
and only incidentally turns off self-view:

- [Video Input MainVideo Mute](https://roomos.cisco.com/xapi/Command.Video.Input.MainVideo.Mute/)

The comparison macro defaults to stopping Companion video and then hides
self-view. That is a stronger product choice than the current solution, which
deliberately leaves Video Mute available. Self-view suppression transfers the
visual benefit without silently changing camera participation.

## Optional Paired notification hygiene

Two additional native policies could reduce duplicated on-screen noise on the
secondary surface:

- `xapi.Config.Conference.JoinLeaveNotifications`, which defaults to `Auto`, could
  be set to `Never` while Paired.
- `xapi.Config.Webex.Meetings.MeetingChatNotifications.Mode`, which defaults to
  `Preview`, could be set to `Focused` or `Disabled` while Paired.

Official references:

- [Conference JoinLeaveNotifications](https://roomos.cisco.com/xapi/Configuration.Conference.JoinLeaveNotifications/)
- [Webex MeetingChatNotifications Mode](https://roomos.cisco.com/xapi/Configuration.Webex.Meetings.MeetingChatNotifications.Mode/)

Both paths are present in the 11.32.1 and 26.7.1 schemas. They are not MVO
requirements: join/leave signals and chat previews can be useful on the Companion,
and hiding them is a product preference rather than a correction to required
behavior. If adopted, capture and restore the prior values and feature-detect the
paths. A reasonable conservative experiment is `Focused` for chat before
considering `Disabled`.

## Opportunity 6: strengthen Parent call classification

### User value

Better classification is invisible when it works, but it prevents false-positive
Companion joins and incorrect unsupported-platform guidance. The Parent currently
uses `Status.Call`, `MeetingPlatform`, `MeetingInviteLink`, protocol, and BYOD
signals. The current schema exposes more direct session evidence:

- `xapi.Status.Conference.Call[n].Meeting`
  - `True` explicitly means the device is in a Webex meeting.
- `xapi.Status.Conference.Call[n].SessionType`
  - `Call`
  - `Share` means an out-of-call Webex-app wireless share.
  - `InstantMeeting`
- `xapi.Status.Conference.Call[n].ProximityCall`
  - identifies a call paired from Proximity or a Webex app.

Official references:

- [Conference Call Meeting](https://roomos.cisco.com/xapi/Status.Conference.Call.Meeting/)
- [Conference Call SessionType](https://roomos.cisco.com/xapi/Status.Conference.Call.SessionType/)
- [Conference Call ProximityCall](https://roomos.cisco.com/xapi/Status.Conference.Call.ProximityCall/)
- [Conference Call MeetingPlatform](https://roomos.cisco.com/xapi/Status.Conference.Call.MeetingPlatform/)

Use the direct Boolean/session signals ahead of URI heuristics. Continue using
`MeetingPlatform`, but note Cisco defines it as the platform supplied through
`Bookings.Put`; it is not guaranteed to classify every ad-hoc call authoritatively.

This is a reliability enhancement, not an MVO-facing feature. It belongs in Parent
Call Coordination and its authoritative `CallSync` payload.

## Opportunity 7: prototype explicit-wake propagation

### User value

Automatic standby should remain Parent-owned. Human intent is different: if a user
explicitly wakes or aborts standby on the Paired Companion, waking the Parent would
make the room feel like one system and could avoid a standby bypass prompt.

Potential flow:

1. Subscribe on the Companion to
   `xapi.Event.SystemUnit.UserAbortedStandby`.
2. Only while Paired, send an authenticated, active-Parent-scoped `WakeRequest`.
3. The Parent runs one `xapi.Command.Standby.Deactivate()`.
4. Existing Parent `Status.Standby.State` feedback and `StandbySync` converge the
   Companion to `Off`.

References:

- [SystemUnit UserAbortedStandby](https://roomos.cisco.com/xapi/Event.SystemUnit.UserAbortedStandby/)
- [Standby Deactivate](https://roomos.cisco.com/xapi/Command.Standby.Deactivate/)
- [Standby State](https://roomos.cisco.com/xapi/Status.Standby.State/)

This is not ready for backlog acceptance from schema evidence alone. Cisco's schema
defines no event payload or detailed semantics for `UserAbortedStandby`. A device
POC must identify which physical interactions emit it and prove that
macro-originated standby commands do not create feedback loops.

Do not make people presence or ordinary Standby state bidirectional. Preserve the
Parent authority boundary and propagate only validated human intent.

## APIs reviewed but not recommended for the MVO

### Occupancy and proximity analytics

`RoomAnalytics.PeoplePresence`, `PeopleCount.Current`, `RoomInUse`, and
`Engagement.CloseProximity` are interesting but poor automatic selection or wake
inputs:

- PeoplePresence can take up to two minutes to clear and is privacy-impacting.
- CloseProximity depends on the camera running and is privacy-impacting.
- Cross-feeding RoomInUse between the devices could distort workspace analytics.

They should not drive Parent selection, Paired mode, or bidirectional standby
without a separate Control Hub analytics and privacy design.

### Layout mirroring

RoomOS exposes `Video.Layout.CurrentLayouts.ActiveLayout`,
`AvailableLayouts[n].LayoutName`, and `Video.Layout.SetLayout`. Mirroring the
Parent layout would duplicate the same content instead of exploiting the second
screen. Available layouts also change with meeting state and can be host-controlled.
Content-first presentation is the smaller, clearer behavior.

### Synchronized stage

RoomOS 26.7.1 includes
`Conference.MultiStream.ConsumeSynchronizedStage` and related stage-control
statuses, but the configuration is absent from the 11.32.1 comparison schema and
synchronizes to the meeting host, not specifically to the Parent. It is a later
26.x experiment, not a baseline.

### Automatic Companion camera shutdown

The comparison macro defaults to
`Video.Input.MainVideo.Mute()` on call success. That prevents duplicate room video,
but it changes the current product choice to keep Video Mute available and allow
the user to expand the room with the Companion camera. If camera coordination is
revisited, define its authority and Standalone restoration first; do not inherit
the sample's default implicitly.

### Manual join, manual companion toggle, and custom keypad relay

These are prominent in the comparison project because it supports manual and
bridge-oriented flows. They conflict with this solution's automatic, Parent-
authoritative, Webex-only model and would add user decisions without improving its
core experience.

## Suggested decision and validation sequence

1. Add paired capture/disable/restore behavior for
   `UserInterface.MuteWarning`, then validate that speech near an intentionally
   muted Companion produces no native mute prompt.
2. Decide whether a Paired Companion should disappear from nearby Webex client
   discovery or only have its Proximity services deactivated.
3. Decide the Paired content-ingress rule:
   strict disable, or local display without automatic far-end share.
4. Treat `Whiteboard.ShareInCall = Auto` and Board Pro Live Annotation as
   acceptance checks; add configuration governance only if the hardware or
   supported site-policy matrix demonstrates a gap.
5. Run a `board-device` POC for:
   - received presentation starts after call join;
   - presentation already active at macro restart;
   - transition from `Receiving` to `Off`;
   - Companion-originated whiteboard (`Sending`);
   - self-view capture, Paired suppression, and Standalone restoration.
6. Extend Parent call classification with `Meeting`, `SessionType`, and
   `ProximityCall`, then regression-test scheduled, ad-hoc, Webex-app paired, local
   share, BYOD, and unsupported-platform cases.
7. Decide separately whether join/leave and chat notifications should remain
   visible on the secondary surface; do not make this an MVO gate.
8. Treat explicit-wake propagation as a separate hardware experiment.

For every accepted slice:

- reuse the current capture/apply/restore pattern;
- feature-detect optional paths;
- keep local xAPI commands single-attempt;
- report command acceptance separately from observed device behavior;
- avoid broad `/Status` feedback subscriptions;
- keep source, Release Manifest, Release Contract, installer, and documentation
  consistent if the deployable macro surface changes.
