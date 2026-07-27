# Custom Companion Admin Guide

This guide is for Device Administrators who plan, configure, validate, maintain, troubleshoot, or retire a Custom Companion deployment. It explains what the solution owns, how it changes RoomOS devices, how supported Standalone settings are preserved, and how to make later changes without losing saved state.

Use the related guides for role-specific procedures:

- [Installation Guide](installation-guide.md) — prepare devices, use the Companion Installer, choose an installation type, and complete the initial deployment.
- [Network Requirements](network-requirements.md) — prepare connectivity for macro core communication, optional Simple-WebWidget services, and the Companion Installer.
- [User Guide](user-guide.md) — operate Companion Device Select, Standalone and Paired modes, calls, PIN Mode, and Parent Room Registration from the touch interface.
- [Technical Reference](technical-reference.md) — inspect the implemented architecture, exact xAPI paths, durable state, message routes, retry boundaries, and known source-level limitations.

This guide is grounded in the current source. An installer success message or source-level verification does not replace acceptance testing on the actual device, RoomOS release, network, and room design. Record device-tested results separately.

## 1. Administration model

Custom Companion separates installation, runtime ownership, and in-room operation.

| Component or role | Owns | Does not own |
| --- | --- | --- |
| Companion Installer | Connects to one Companion Device, verifies its expected serial, writes the selected release and configuration, controls the installation type, and optionally inventories, registers, or deregisters Parent Room Devices after initialization. | It never connects to or directly changes a Parent Room Device. |
| Companion Device runtime | Stores registrations and Standalone preferences, renders Companion Device Select, changes the Companion Device between Standalone and Paired, provisions registered Parent Room Devices, and coordinates supported calls. | It does not turn PIN Mode into device authentication and does not automatically coordinate non-Webex calls. |
| Parent Room Device runtime | Recognizes registered Companion Devices, stores their callback configuration and last authoritative pairing state, renders Registered Companion Devices, reports call and standby state, admits validated Companion Device guests when allowed, and reconciles deregistration. | It does not decide the Companion Device pairing state, own the Companion Device configuration, or remove its shared macro package when one Companion Device deregisters. |
| Device Administrator | Controls device accounts, network and certificate policy, installation and upgrades, source configuration, maintenance windows, validation, logs, recovery, and secure access to macros and storage. | Administrator access is not restricted by PIN Mode. |
| In-Room User | Selects Standalone or a registered Parent Room Device and may use PIN-protected registration, deregistration, and PIN controls. | The user is not expected to repair macro, xAPI, account, certificate, or network failures. |

The Companion Installer reporting **Companion Device Installation Ready** means the Companion Device Main macro emitted its initialization-complete message. It does not mean that any Parent Room Device is registered, reachable, provisioned, or device-validated.

## 2. Requirements and deployment planning

The [Release Manifest](../manifest.json) is the authority for the selected release. The current manifest declares:

- Minimum RoomOS: `11.32.1.1`
- Known exact Companion Device product names: Board Pro 55, Board Pro 75, Board Pro 55 G2, Board Pro 75 G2, Board Pro 55 G3, Board Pro 75 G3, Desk Mini, Desk, Desk Pro, and Desk Pro G2
- Maximum registered Parent Room Devices per Companion Device: 6
- Maximum registered Companion Devices per Parent Room Device: 3
- One active Parent Room Device per Companion Device
- One Parent Room Device-authorized call at a time while Paired
- Automatic call coordination for Webex calls only
- External dependency: `Memory-Storage-Functions-V2`

The installer checks the selected Release Manifest for an exact normalized product match first. If none exists, it loosely accepts a product containing `Desk` or `Board Pro` when that release declares the family. Other products remain unsupported. A Device Administrator can explicitly acknowledge an exploration-only bypass for the current browser session; Configure and Review continue to identify that exception, and it does not replace platform acceptance testing or change the Release Manifest.

Use [Network Requirements](network-requirements.md) to prepare the endpoints introduced by macro core communication, optional Simple-WebWidget features, and the Companion Installer.

Before deployment, confirm all of the following:

1. The exact Companion Device and every intended Parent Room Device are identified by serial number.
2. The devices run a supported RoomOS release and expose every xAPI used by the solution on that product platform.
3. Macro Runtime is enabled on the devices.
4. The Device Administrator has an Admin account for the Companion Installer. RoomOS requires the Admin role for macro save and activation.
5. A separate local Companion Device Callback account already exists, or reuse of the installer account has been deliberately accepted. The installer validates authentication but does not create accounts or assign roles.
6. Each Parent Room Device has credentials with the permissions required by the registration and runtime workflow.
7. The browser can reach the Companion Device over secure WebSocket and trusts the device certificate.
8. The Companion Device can reach every Parent Room Device over HTTPS, and every Parent Room Device can reach the configured Companion Device callback host over HTTPS.
9. DNS names, routing, firewalls, and certificates are correct for both directions. A successful browser connection proves only the installer-to-Companion Device path.
10. `HttpClient Mode` is `On` on every participating device. The runtime and installer read but never change this Device Administrator-owned prerequisite.
11. Each sending device has an approved HTTPClient Trust Posture: production uses `AllowInsecureHTTPS=False` with trusted issuing CAs and requested-host/SAN matching; when trusted, host-matching endpoint certificates are not provisioned, use `True` only with acceptance that the permissive device-wide policy applies to every qualifying HTTPClient destination.
12. A maintenance window is available with no active calls on devices whose Macro Runtime may restart.

For a safer change window:

- Return the Companion Device to Standalone.
- Confirm it has no active calls.
- Allow any Pending Deregistration to finish when possible.
- Keep registered Parent Room Devices online if they must receive an updated macro package or callback configuration.
- Record the installed project version, macro inventory and activation state, registered device inventory, and current governed RoomOS configurations.
- Secure any exported macros or storage as credentials may be present.

## 3. Installation and expected macro inventory

Follow the [Installation Guide](installation-guide.md) for the complete hosted, local, or manual workflow. The two installation choices have different state consequences:

| Installation type | Effect |
| --- | --- |
| Install or Update — Keep Saved Data | Installs the selected source snapshot on a new endpoint or upgrades an existing installation while preserving the generated `Custom-Campanion-Storage` macro, registrations, Pending Deregistrations, active selection, PIN Mode state, and Standalone Preference Snapshots. |
| Fresh Installation — Erase Saved Data | Deactivates the existing project runtime, removes only `Custom-Campanion-Storage` when present, and installs the selected source snapshot. This permanently discards the saved Custom Companion state listed above. |

A Fresh Installation is not a factory reset, but it is destructive to solution state. If it is performed while the Companion Device is Paired, the RoomOS configurations already enforced for Paired mode remain persistent while the deleted Standalone Preference Snapshots are no longer available for restoration. Return to Standalone and verify restoration before considering a Fresh Installation.

The installer also identifies installed `Custom-Campanion_*_2026` files that are absent from the selected release as Legacy Project Macros. It can remove those explicitly listed files or retain them inactive. It never treats generated storage or unrelated macros as legacy project files.

### Companion Device macro state

The release is intentionally unbundled. On a healthy Companion Device:

- All 15 macros listed in the Release Manifest are installed under their numbered source names.
- `Memory-Storage-Functions-V2` is installed as an external dependency.
- Only `Custom-Campanion_1_Main_2026` is active.
- Config, imported domain modules, and Parent Room deployment sources remain inactive.
- `Custom-Campanion-Storage` is generated and managed by the memory library.

Do not activate the imported modules individually. Their initialization belongs to Main, and activating them creates duplicate timers, subscriptions, or entry behavior.

### Parent Room Device macro state

Registration causes the Companion Device to install or update these resources on the Parent Room Device:

- `Custom-Campanion_Room_2026`
- `Custom-Campanion_12_ParentCallCoordination_2026`
- `Custom-Campanion_3_Utils_2026`
- `Custom-Campanion_6_DeviceComms_2026`
- `Memory-Storage-Functions-V2`

Only `Custom-Campanion_Room_2026` is active. The Parent Room Device also creates its own `Custom-Campanion-Storage`.

Provisioning saves the package, activates the Parent Room entry macro, and restarts the Parent Room Device Macro Runtime. Companion Device initialization repeats package provisioning for every online registered Parent Room Device, so a Companion Device Macro Runtime restart can also restart the Macro Runtime on those Parent Room Devices. Plan this as a shared-device maintenance action.

The active Parent Room entry macro keeps **Registered Companion Devices** in the RoomOS Control Panel even when the registration list is empty. It applies the same Custom Companion icon used by Companion Device Select. Device rows are read-only status, not pairing controls.

## 4. Editable deployment configuration

The administrator-facing source configuration is in `Custom-Campanion_2_Config_2026`. The Companion Installer presents its editable leaves and writes the selected values into the installed Config macro.

| Config path | Purpose | Administration guidance |
| --- | --- | --- |
| `CompanionDeviceInformation.host` | Companion Device callback host distributed to Parent Room Devices. | It is blank in source and must be an address reachable from every Parent Room Device. The Companion Installer injects the connected Companion Device host automatically. Update it if network addressing changes. |
| `CompanionDeviceInformation.username` and `.password` | Existing local Companion Device Callback Credentials. | Username defaults to `custom-companion`; password is blank. Both credentials and the host are required. Create or update the account first. Initialization stops if a required callback field is blank. Protect the Config macro because these values are stored in source. |
| `pinMode.defaults.enabled` and `.pin` | Bootstrap state used only when no durable PIN Mode record exists. | The PIN must contain 4–8 digits. These values do not replace a healthy current PIN after initialization. |
| `UserInterface.WebWidget.urlOverride` | Replaces the built-in Simple-WebWidget base URL. | Leave empty for the release default. Validate any custom page on every supported display. |
| `UserInterface.WebWidget.CompanionWidget.enabled` | Enables solution management of the Companion WebWidget. | Disable only if the deployment does not need the widget or its runtime status field. |
| `restoreStandaloneExisting` | Restores the WebWidget captured before Paired mode while Standalone. | `false` replaces any existing WebWidget without retaining it. Before enabling `true`, configure the intended existing WebWidget so its URL, ID, name, and refresh interval are saved during the first Standalone capture. The snapshot is durable internal state, not continuously rediscovered. |
| `weather`, `time`, `Standalone`, and `Paired` fields | Configure widget weather, clock, user guidance, and mode-specific WebWidget images. | Weather and time default disabled with blank location/time-zone values. Use valid coordinates, temperature unit, IANA time zone, text, and reachable HTTPS image URLs when enabling them. During installation, Weather and Time may copy one-time values from the Installer Computer, both mode-specific `iconUrl` fields show a browser preview, and each `userGuidance` value uses a full-width multiline text box. The URLs are prefilled with the release image and may be edited independently. Runtime owns heading, theme, `info1`, `info3`, and `hideSettings`; `userGuidance` maps to the widget's `info2` display slot. |

The exported `projectVersion`, HTTPClient Trust Posture, current PIN, registered Parent Room Devices, active selection, Pending Deregistrations, and saved Standalone preferences are not Deployment Configuration. The Companion Installer shows the selected source's Project Version separately, subscribes read-only to `HttpClient AllowInsecureHTTPS` after connection, and reports the current posture without changing it. Manage durable state through the supported UI and runtime workflows, not by editing Config.

### Edit Config after installation

The preferred time to edit deployment configuration is during Install or Update — Keep Saved Data. If an on-device edit is required:

1. Return the Companion Device to Standalone and confirm there are no active calls.
2. Open the device Macro Editor and keep `Custom-Campanion_2_Config_2026` inactive.
3. Change only the intended values. Preserve the object structure, inline definitions, macro filename, imports, compatibility field names, and release-owned `projectVersion`.
4. If callback host or credentials are changing, make the account and network changes first.
5. Save Config.
6. Restart the Macro Runtime so Main reloads the imported values.
7. Wait for `Custom Companion initialized on Companion Device`.
8. Confirm all online registered Parent Room Devices receive the package and accept the refreshed configuration. Repeat the controlled restart when an offline Parent Room Device is available if it missed the initialization-time sync.
9. Re-run the relevant acceptance checks before returning the device to service.

Changing `pinMode.defaults` does not change the current PIN Mode record. Use the Config page inside Companion Device Select for a healthy system. If both saved PIN Mode state and configured defaults are invalid, initialization substitutes recovery PIN `0000`, reports an Unhealthy State, and requires a Device Administrator to inspect the error and restart after recovery.

## 5. Device configuration impact

RoomOS xConfigurations persist across reboots and Macro Runtime restarts. The solution therefore captures supported Standalone values before it enforces Paired behavior and saves those exact values in generated storage.

### Companion Device impact

| Surface | While Paired | When returning to Standalone | Preservation class |
| --- | --- | --- | --- |
| `HttpClient Mode` | Must already be `On`; initialization stops before transport or controller startup otherwise. | Never changed. | Device Administrator-owned device-wide prerequisite. |
| `HttpClient AllowInsecureHTTPS` | Observed and reported as the device's HTTPClient Trust Posture. | Never changed. | Device Administrator-owned device-wide security policy. |
| Custom panels | `cc26_access` launches protected `cc26_hidden`; its custom icon is downloaded from the release-owned URL in the UI module; `cc26_error` replaces the normal panels during Unhealthy State. | Access and hidden panels remain. Legacy panel `cc26` is removed. The panel icon is not deployment configuration. An icon-download failure leaves the built-in fallback icon and does not create an Unhealthy State. | Solution-owned UI, regenerated by runtime. |
| Companion WebWidget | A differently identified current WebWidget is removed before `cc26WebWidget` is saved with Paired content and runtime status. | The solution widget remains by default. When `restoreStandaloneExisting` is enabled, `cc26WebWidget` is removed and the once-captured prior definition is restored. | Solution-owned unless explicit restoration is configured. |
| Known call, share, whiteboard, and BYOD UI features | Set to the Paired policy values described below. | Exact captured supported values are restored. | Standalone Preference Snapshot. |
| Mute Warning, proximity mode, AirPlay, and Miracast | Disabled or set Off as applicable. | Exact captured supported values are restored. | Standalone Preference Snapshot. |
| Non-camera input connector `PresentationSelection` | Set to `Manual` for each connector that has its own saved value. | Exact per-connector value is restored. | Standalone Preference Snapshot keyed by connector ID. |
| Proximity Services availability | Services are deactivated when a valid saved state exists. | Services are activated only when the captured availability was exactly `Available`. | Standalone Preference Snapshot plus command behavior. |
| Standby Control, Halfwake Mode, and Office Hours | Set to `Off`, `Manual`, and `False`; operational standby follows the selected Parent Room Device unless bypassed. | Exact saved values are restored. | Standalone Preference Snapshot. |
| Microphone mute | An unmute is corrected with a single Mute command. | Microphones remain muted; the user is reminded to unmute. | Required Paired command policy; previous mute state is not restored. |
| Volume | An observed level other than 1 is corrected to level 1. | If no call is active, volume is set to current `Audio DefaultVolume`. During a call, the user chooses whether to restore it. | Required Paired command policy; the prior live volume level is not snapshotted. |
| Do Not Disturb | A five-minute lease is renewed every two minutes to reject incoming calls. | The lease is deactivated. A DND state that existed before Paired mode is not restored. | Solution-owned lease, not a Standalone snapshot. |

The Paired UI feature policy keeps these controls available:

- `UserInterface Features Call VideoMute = Auto`
- `UserInterface Features Call ParticipantList = Auto`
- `UserInterface Features Whiteboard Start = Auto`

It hides these known controls:

- `AINotes`
- `AudioMute`
- `CameraControls`
- `End`
- `HdmiPassthrough`
- `JoinGoogleMeet`
- `JoinMicrosoftTeamsCVI`
- `JoinMicrosoftTeamsDirectGuestJoin`
- `JoinWebex`
- `JoinZoom`
- `Keypad`
- `LayoutControls`
- `MidCallControls`
- `MusicMode`
- `SelfviewControls`
- `SimultaneousInterpretation`
- `Start`
- `Webcam`
- `UserInterface Features Share Start`

It also sets `BYOD QRCodePairing = Disabled`. Call End temporarily returns to `Auto` during Call Preservation or an active-call Unhealthy State.

The solution intentionally leaves other device surfaces alone, including Whiteboard Share in Call, Live Annotation, join/leave and meeting-chat notifications, ultrasound maximum volume, people presence, occupancy, and motion-wake configurations. These are not implemented Paired policy surfaces and must not be described as managed.

### Parent Room Device impact

| Surface | Impact |
| --- | --- |
| Macro package | Shared Parent Room runtime and dependencies are saved; only `Custom-Campanion_Room_2026` is active. Provisioning restarts the Parent Room Device Macro Runtime. |
| HTTPClient | Mode must already be `On`; Parent Room initialization stops otherwise. The runtime observes but never changes device-wide `AllowInsecureHTTPS`. Every request supplies request-level `AllowInsecureHTTPS=True`, while the Parent Room Device's device-wide posture remains the effective certificate-validation gate for all Companion Device destinations. |
| Generated storage | `registeredBoards` stores recognized Companion Device records and callback credentials. `boardConfigs` stores the last accepted Companion Device configuration by serial; a legacy `httpClient` field can remain after an upgrade but is ignored. `companionPairingStates` stores the last Companion-authoritative Paired/Not paired value; Offline remains transient. |
| User interface | `Registered Companion Devices` is saved in `ControlPanel` with an information row, one named status row per registration, or an explicit no-registrations row. Ten-second alerts announce authoritative Paired/Not paired changes and exhausted startup validation. |
| Connected peripherals | The Companion Device is connected and heartbeated as a RoomOS peripheral. Confirmed deregistration purges only that Companion Device peripheral entry. |
| Calls | The runtime reads call state, reports it to registered Companion Devices, looks up a current booking only when a Meeting Password is requested, and may admit an exact validated Companion Device guest. |
| Standby | The runtime reads and subscribes to Parent Room Device standby state and reports it to registered Companion Devices. It does not replace the Parent Room Device standby configuration. |

Routine Parent Room Deregistration does not uninstall or deactivate the shared Parent Room macro package because other Companion Devices may depend on it.

## 6. How configuration preservation works

The generated `Custom-Campanion-Storage` macro is application data, not a deployable source file. On the Companion Device it contains:

- `parentDevices`
- `pendingDeregistrations`
- `activeParentSerial`
- `pinMode`
- `standaloneUiFeatureConfig`
- `standalonePairedEnvironmentConfig`
- `standaloneStandbyConfig`

The capture lifecycle is:

1. A runtime that starts in Standalone captures current supported values.
2. A verified Parent Room Device selection performs a full capture while still Standalone.
3. Supported configuration changes observed while Standalone update the matching snapshot.
4. A runtime that starts in Paired loads existing snapshots, skips capture, and reapplies Paired policy.
5. Changes attempted while Paired are not learned as Standalone preferences; the policy is reapplied.
6. Returning to Standalone fills only missing supported entries and restores saved values.

### Safely edit a governed RoomOS configuration

1. Confirm the Companion Device is healthy and running Standalone.
2. Make the configuration change through the device WebUI, Control Hub, or another approved xAPI tool.
3. Keep Main active so its Standalone subscription can save the new value.
4. Allow the write to complete, then perform a controlled Standalone-to-Paired-to-Standalone acceptance test.
5. Confirm that Paired policy is applied and the new Standalone value is restored.

Do not establish a new preference while Paired. The current Paired value is policy state, not a Standalone preference, and the runtime will normally correct the change.

Do not hand-edit `Custom-Campanion-Storage`. It can contain credentials, transaction state, snapshot schemas, and registrations that must remain internally consistent. Install or Update — Keep Saved Data is the supported way to preserve it across upgrades. Fresh Installation — Erase Saved Data is the explicit way to remove it, but it resets all Custom Companion state rather than one field.

Unsupported or unavailable xAPI paths are logged and skipped. A newly discovered non-camera connector is not changed while Paired until its own `PresentationSelection` has been observed in Standalone.

## 7. Parent Room Registration administration

Parent Room Registration may be started in either of two supported ways:

- Use **Add Parent** from the Companion Installer Complete Setup page as described in the [Installation Guide](installation-guide.md).
- Use the Companion Device interface as described in the [User Guide](user-guide.md).

Both routes keep provisioning owned by the Companion Device and perform the same live Parent Room Device serial verification, capacity checks, macro installation, peripheral connection, readiness acknowledgement, configuration acceptance, and durable commit. The current Companion Installer shows those six stages as the runtime reports them; initial HTTPS verification failures preserve the submitted Parent host and identify the failed stage and stable transport code.

Complete Setup first lists the connected Companion Device's saved Parent Room Registrations and Pending Deregistrations without returning stored Parent Room credentials. Immediately after Fresh Installation, the installer shows a known-empty state instead of requesting the storage it just erased; a later explicit Refresh or successful Add Parent still reads current runtime state. **Remove** requires confirmation and starts Installer Parent Room Deregistration through the same Companion Device-owned flow described below. The browser never edits generated storage or contacts a Parent Room Device directly.

Important administration rules:

- Registration does not select the Parent Room Device or change the Companion Device from Standalone to Paired.
- The observed serial is never disclosed when it does not match the expected serial.
- Re-registering the same serial requires explicit replacement acknowledgement and does not consume another slot. For the installer route, that acknowledgement suppresses older Pending Deregistration cleanup from initial identity verification through the handshake; a failed attempt releases suppression so cleanup can resume.
- Credentials are transient until the Parent Room Device accepts the configuration and the Companion Device storage write succeeds.
- A failed registration does not create a selectable Parent Room Device.
- Registration is blocked only while the Companion Device is both Paired and in an active call.
- Parent Room credentials are stored on the Companion Device so it can communicate autonomously.
- Companion Device callback credentials are stored on the Parent Room Device so it can respond autonomously.

### Deregistration and Pending Deregistration

Deregistration first writes a tombstone and removes the Parent Room Device from the selectable list. The Parent Room Device must then confirm that it purged the Companion Device peripheral and removed that Companion Device from its registration, configuration, and pairing-state records.

Only `DeregistrationAccepted` for the current transaction proves completion. A timeout, authentication failure, offline Parent Room Device, or lost response produces Pending Deregistration.

When cleanup is pending:

1. Do not delete generated storage or the tombstone.
2. Use the Companion Installer's direct device WebUI links to confirm `HttpClient Mode=On` and the approved certificate-validation posture on both devices, then restore network reachability and the saved Parent Room credentials.
3. Keep the Parent Room Device Macro Runtime available.
4. Restart the Companion Device Macro Runtime during a safe window to trigger another initialization-time attempt, or allow a valid message from that Parent Room Device to trigger reconciliation.
5. Confirm the later success notice and matching logs before treating capacity as reclaimed.

A Fresh Installation deletes tombstones and abandons any remote cleanup that was not acknowledged.

## 8. Routine maintenance and upgrades

Use this sequence for an upgrade or configuration maintenance window:

1. Review release notes, the Release Manifest, and any changed minimum RoomOS or platform requirements.
2. Return the Companion Device to Standalone and confirm zero active calls.
3. Resolve Pending Deregistrations when practical.
4. Confirm intended Parent Room Devices are online if they must receive updated sources or callback configuration.
5. Record current project versions, macro activation state, Config values, registrations, and governed Standalone values.
6. Use the [Installation Guide](installation-guide.md) and choose Install or Update — Keep Saved Data unless a deliberate full state reset is required.
7. Review every generated Config value before installation. Install or Update preserves storage but still installs the selected Config source.
8. Allow Companion Device initialization and online Parent Room Device provisioning to finish.
9. Verify macro inventory, activation state, initialization messages, registrations, and device behavior.
10. Record source verification and device validation as separate results.

Never update only a subset of numbered runtime macros. A release is one synchronized, unbundled source set. Keep Main, Config, RoomReference, the Release Manifest, imports, and version anchors together.

The installer is forward-only and does not restore overwritten macros after failure. It subscribes to macro logs before activation, saves and activates Main, explicitly issues `Macros Runtime Restart`, and then waits for:

- Initialization complete produces Companion Device Installation Ready.
- Initialization stopped or a JavaScript runtime error produces failure.
- Other error-level messages followed by completion produce Completed with Warnings.
- If no terminal result arrives within two minutes, the installer remains connected and offers Keep Waiting, Restart Macro Runtime, or Disconnect.

## 9. Monitoring and troubleshooting

Use the device WebUI Macro Editor logs on both the Companion Device and relevant Parent Room Device. Runtime logs use:

- `debug` for periodic monitoring and no-op decisions
- `info` for bounded lifecycle and workflow milestones
- `warn` for recoverable conditions that change or block expected behavior
- `error` for initialization stops, Unhealthy State entry, and failures requiring remediation

Stable diagnostic codes begin with `CC26-` for administrator-facing runtime failures. Capture the code, component, context, remediation, original error, project version, device role, RoomOS version, and time of occurrence. Do not copy credentials, PINs, generated storage, or Meeting Passwords into tickets or general logs.

| Symptom | Meaning | Administrator response |
| --- | --- | --- |
| `cc26_error` replaces Companion Device Select | The solution entered an Unhealthy State because a required local prerequisite, saved PIN state, or required Paired media/DND command failed. | Read the first stable error diagnostic, correct the macro/xAPI/capability issue, wait for any active call to end, then restart Macro Runtime. |
| `CC26-INIT-HTTPCLIENT-MODE` or the device-to-device communication disabled Infoblock appears | Local `HttpClient Mode` could not be read or is not `On`. Initialization stopped before registration, provisioning, heartbeat, standby, call coordination, or Parent selection began. | A Device Administrator must set `xConfiguration HttpClient Mode: On` on that device and restart the Macro Runtime. Do not expect an automatic retry. |
| A Parent Room Device is offline or unavailable | Parent Connectivity failed. This alone is not an Unhealthy State. An `Offline` entry remains actionable so an In-Room User can request a fresh check. | Check host resolution, routing, HTTPS, credentials, certificate policy, live serial identity, Parent Room macros, and logs on both devices. |
| `Companion Device Registration Error` appears on a Parent Room Device | The Parent Room Device accepted or denied configuration but could not send its response to the Companion Device. | Verify callback host, callback credentials, permissions, HTTPS reachability, and certificate policy from Parent Room Device to Companion Device. |
| A Companion Device row shows `Offline` on its Parent Room Device | Three serialized startup validation attempts did not receive an authoritative response within their two-second response windows. The last saved Paired/Not paired state remains preserved. | Check callback reachability and credentials. A later Companion Device status message corrects the row automatically. |
| Registration reports capacity denial | The Companion Device has 6 Parent Room Devices or the Parent Room Device already recognizes 3 Companion Devices. | Deregister an unused relationship and wait for confirmed cleanup. Re-syncing an existing serial does not consume a new slot. |
| Parent Room Deregistration Pending | Local retirement succeeded but remote cleanup was not acknowledged. | Preserve storage, restore connectivity or credentials, and let reconciliation complete. |
| A non-Webex call does not join | Automatic coordination is intentionally Webex-only. | Start a Webex call on the Parent Room Device or use the Companion Device in Standalone. |
| Meeting Password must be entered manually | No single matching current booking supplied a usable password. | Enter it on the Companion Device. Do not store it in Config or logs. |
| Paired UI or sharing controls reappear | The governed configuration changed while Paired or a required path failed. | Inspect logs and platform support. The runtime should reapply supported policy; newly introduced RoomOS controls require acceptance review. |
| Standalone settings do not restore as expected | A snapshot may be missing, deleted, captured at the wrong transition boundary, or affected by a known restart gap. | Do not Clean Install. Compare the secured pre-change baseline, current storage presence, mode history, and logs before manually correcting values in healthy Standalone. |
| Installer reports Initialization Not Confirmed | No terminal Companion Device log was received within two minutes. | Keep waiting and inspect streaming logs; restart Macro Runtime only during a safe window. |

Parent Room Device unavailability during an active Companion Device call enters Call Preservation. The Companion Device keeps its Parent Room assignment and call, exposes End Call, and retries serial-verified connectivity. Do not force Standalone or restart either Macro Runtime during the preserved call unless ending the call is an accepted consequence.

## 10. Security and data handling

Treat macro and storage access as privileged:

- Installer Credentials remain in browser memory for the authenticated session and are cleared when the installer disconnects.
- Companion Device Callback Credentials are written into Config and distributed to registered Parent Room Devices.
- Parent Room Device credentials are stored in Companion Device generated storage for autonomous communication.
- Parent Room Device generated storage contains recognized Companion Device records, callback credentials, and accepted configuration.
- Pending Deregistration tombstones retain Parent Room connection data until cleanup is acknowledged.
- The current PIN is never logged or sent to a Parent Room Device, but PIN Mode is only an in-room access gate. It does not protect WebUI, Macro Editor, API, or generated-storage access.
- Meeting Passwords are transient and must never become Config, durable storage, or log content.
- Runtime logs avoid passwords and payloads, but may contain host names, serials, diagnostic context, and bounded response excerpts.

Use distinct installer and callback accounts where operationally practical so audit activity is attributable. Apply least privilege only after verifying that the account can perform every required runtime callback operation. Rotate credentials in a controlled Standalone maintenance window, update Config or the affected Parent Room Registration, restart safely, and verify both communication directions.

HTTPClient Trust Posture is a Device Administrator-owned RoomOS policy, not Config. Use `HttpClient Mode=On` everywhere. For production, use `HttpClient AllowInsecureHTTPS=False`, install the remote issuing CA on each sending device, and use hosts present in the remote certificate SAN. For an explicitly permissive lab, `True` permits untrusted or self-signed certificates for every qualifying destination reached by that sending device. Custom Companion sets neither value and supports no mixed per-Companion exception.

The Companion Installer browser's WSS certificate trust is separate. Accepting the Companion Device certificate in a browser establishes only browser-to-device trust; it does not install a RoomOS CA, validate Parent-to-Companion callbacks, or alter the administrator-owned HTTPClient posture.

## 11. Recovery boundaries and known limitations

Use the least destructive recovery that addresses the fault:

1. Correct the account, network, certificate, xAPI, or source problem.
2. Restart Macro Runtime only after checking active calls and the impact on registered Parent Room Devices.
3. Use Install or Update — Keep Saved Data to restore a complete synchronized source set while preserving state.
4. Use Fresh Installation — Erase Saved Data only when intentionally abandoning all registrations, PIN state, Pending Deregistrations, active selection, and Standalone Preference Snapshots.

Additional limits administrators must account for:

- A steady-state Paired restart protects existing Paired Environment snapshots.
- During the current Paired-to-Standalone transition, `activeParentSerial = Standalone` is persisted before all restoration finishes. A Macro Runtime stop in that interval can allow the next Standalone initialization to capture Paired or partly restored values.
- Missing standby snapshot entries can currently be learned during a recovered Paired initialization. Existing entries are not overwritten.
- Microphones remain muted after returning to Standalone.
- Live volume restores to current `Audio DefaultVolume`, not to the exact pre-Paired live level.
- A DND state that existed before Paired mode is not restored.
- RoomOS has no individual Raise Hand visibility configuration. Validate that Raise Hand remains usable with `MidCallControls = Hidden`.
- New RoomOS call controls are not governed automatically. Review the policy after firmware upgrades.
- Optional unsupported xAPI paths are skipped; required microphone, volume, and DND failures enter Unhealthy State.
- Local xAPI commands are single-attempt. The transport does not retry; only explicitly defined network workflows repeat.
- The Companion Installer is forward-only and has no automatic rollback or full uninstall workflow.

If the deployment must be retired, first return the Companion Device to Standalone, confirm restored configurations, complete every Parent Room Deregistration, record and securely retain required evidence, and plan manual macro removal against the Release Manifest. Do not remove shared Parent Room macros while another Companion Device remains registered, and do not delete unrelated macros or storage.

## 12. Device acceptance checklist

Record each result with device serial, product platform, RoomOS version, project version, date, and tester.

- Companion Device has the complete Release Manifest macro set and only Main is active.
- Companion Device emits the expected initialization-complete message without unresolved warnings.
- Config contains the intended callback, HTTPClient, PIN default, WebWidget values, and source-owned field definitions.
- Existing Standalone governed configurations have been recorded and captured.
- Companion Device Select renders and PIN Mode behaves as intended.
- Each Parent Room Registration completes with the expected serial and correct capacity.
- Each Parent Room Device has the expected shared package with only its entry macro active.
- Parent Room callback communication succeeds.
- Registered Companion Devices remains in the Parent Room Control Panel, uses the Custom Companion icon, and shows the expected information, device, and empty-state rows.
- Paired, Not paired, Offline, startup priority/concatenation, and later Offline correction behave as documented without duplicate alerts for unchanged state.
- Paired mode applies UI, sharing, proximity, connector, standby, microphone, volume, and DND behavior.
- Returning to Standalone restores every governed snapshot value and applies the documented microphone, volume, and DND exceptions.
- A supported Webex call started on the Parent Room Device joins on the Companion Device as Guest.
- Meeting Password success and manual-entry fallback behave as expected for the site.
- Unsupported call platforms show guidance and do not auto-join.
- Parent Room Device loss without a call returns the Companion Device to Standalone.
- Parent Room Device loss during a call enters and exits Call Preservation without inventing a successful recovery.
- Parent Room Deregistration removes only the intended relationship and confirms cleanup.
- A controlled Macro Runtime restart recovers the intended mode and state.
- Raise Hand and any new firmware-specific call controls have been checked on the target release.

For the exact source contracts behind these checks, use the [Technical Reference](technical-reference.md).
