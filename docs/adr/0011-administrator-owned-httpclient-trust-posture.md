# ADR 0011: Use an Administrator-Owned HTTPClient Trust Posture

- Status: Accepted
- Date: 2026-07-27

## Context

Custom Companion sends RoomOS HTTPClient requests in both directions between one Companion Device and one or more Parent Room Devices. Earlier source treated `httpClient.allowInsecureHTTPS` as Companion Device Deployment Configuration, changed device-wide RoomOS HTTPClient settings during runtime initialization, and handed a per-Companion policy through `ParentReadyRequest`, `ConfigSync`, `DeregisterRequest`, stored `boardConfigs`, and controller calls.

That model implied destination-specific certificate behavior that RoomOS does not actually own at the solution level. `xConfiguration HttpClient AllowInsecureHTTPS` is a device-wide security gate on the sending codec. A request can explicitly ask to allow an insecure certificate, but the request cannot bypass a device-wide `False` setting. Conversely, enabling the device-wide setting affects every qualifying HTTPClient destination reached by that device, not only one Custom Companion registration.

Runtime ownership also made a security-sensitive administrator configuration an installation side effect. A Macro Runtime restart could silently reapply it, several registered Companion Devices could express conflicting policies to one shared Parent Room Device, and configuration handoff obscured which device was responsible for trust.

Browser certificate trust for the Companion Installer is a different boundary. Trusting the Companion Device HTTPS certificate in the browser enables its `wss://` JSXAPI session; it does not install a CA on RoomOS or establish Companion-to-Parent or Parent-to-Companion HTTPClient trust.

## Decision

Define **HTTPClient Trust Posture** as the Device Administrator-owned, device-wide RoomOS policy used by every Custom Companion HTTP request sent by one device.

Both the Companion Device and Parent Room entry macros must read local `xapi.Config.HttpClient.Mode.get()` before initializing transport, storage-backed workflows, message handlers, registration, provisioning, heartbeat, standby, or call coordination. Mode must be `On`. An unavailable or disabled Mode is a hard initialization failure and requires a Device Administrator to set `xConfiguration HttpClient Mode: On` and restart the Macro Runtime. The runtime does not set Mode, retry initialization, or restart itself.

The runtime also observes `HttpClient AllowInsecureHTTPS` for diagnostics and reports the resulting posture, but never changes it. Every Custom Companion HTTPClient GET and POST explicitly supplies request-level `AllowInsecureHTTPS: 'True'`. This fixed request option supports both administrator-owned postures because the RoomOS device-wide configuration remains the effective gate:

- Production: `HttpClient Mode=On` and `HttpClient AllowInsecureHTTPS=False`. Each sending device must trust the remote issuing CA, and every requested FQDN or IP address must be present in the remote certificate SAN.
- Lab: `HttpClient Mode=On` and `HttpClient AllowInsecureHTTPS=True`. Untrusted or self-signed remote certificates are permitted for all qualifying HTTPClient destinations on that sending device.

Remove `httpClient.allowInsecureHTTPS` from the current Config and stop emitting or consuming it through `ParentReadyRequest`, `ConfigSync`, `DeregisterRequest`, Parent selection, registration, call coordination, standby, or other controller interfaces. Existing `boardConfigs[*].httpClient` data may remain after an update but is ignored. Older selected releases retain their source-defined field because the Companion Installer parses the selected release's own Config macro.

During signed-in Companion Device preflight, the installer reads Mode and AllowInsecureHTTPS without setting either. Mode other than `On` blocks before any device mutation with the exact action `Set xConfiguration HttpClient Mode to On, then reconnect.` Configure and Review report the observed posture and, for strict validation, explain callback-host/SAN and issuing-CA requirements. The browser WSS certificate recovery path remains separate and no installer control changes HTTPClient configuration.

## Consequences

- Security policy has one explicit owner: the Device Administrator of the sending device.
- Runtime restarts cannot silently weaken or strengthen device-wide certificate validation.
- Shared Parent Room Devices scale predictably because all registered Companion Device destinations use the Parent Room Device's one observed posture.
- Mixed per-Companion certificate exceptions are not supported. An exception must be made deliberately at the sending-device boundary and affects every qualifying HTTPClient destination on that device.
- Production deployment requires CA distribution and bidirectional requested-host/SAN planning before activation or registration.
- Lab deployment is simpler, but its permissive posture has broader device-wide impact than Custom Companion alone.
- A Mode failure stops before any network-dependent controller or timer starts. On the Companion Device it enters the existing Unhealthy State, suppresses normal panels, installs `cc26_error`, and gives Infoblock 3 a cause-specific persistent administrator message.
- The Parent Room runtime performs the same local prerequisite gate and emits a stable administrator diagnostic, but it does not control the Companion Device WebWidget.
- This change removes an ordinary Config field and adds installer-native preflight/reporting. It does not add an optional browser-to-runtime action or result and therefore adds no Installer Capability. The baseline Release Manifest structure and installation protocol remain compatible with Installer Contract Version 1.

## Rejected alternatives

- Keep a per-Companion policy in `boardConfigs`: rejected because it suggests destination-specific authority that conflicts with the sending device's device-wide RoomOS gate.
- Let the runtime set Mode or AllowInsecureHTTPS: rejected because security-sensitive administrator policy must not be a macro side effect or restart-time write.
- Use request-level `False` for production and `True` for lab: rejected because that would reintroduce hidden per-call policy plumbing; fixed request-level `True` lets the administrator-owned device-wide gate decide whether certificate bypass is actually permitted.
- Treat installer browser certificate trust as sufficient: rejected because browser WSS trust and RoomOS HTTPClient CA/SAN validation are different trust stores and network directions.
