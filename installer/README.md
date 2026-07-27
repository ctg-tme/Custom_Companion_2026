# Custom Companion Installer

Static GitHub Pages installer for deploying a selected Custom Companion release to a Companion Device through browser JSXAPI. Its introduction fetches and renders the current repository README at runtime.

The selected release supplies its own Config macro, so ordinary Config fields are release-specific. Optional browser-to-runtime workflows use the active [Companion Installer Compatibility and Capabilities](../docs/installer-capabilities.md) contract. The current manifest declares Registration, Inventory, and Deregistration. Published Preview `v0.1.2.51` receives an exact Registration-only legacy profile, so the installer does not request Inventory or expose Deregistration for that runtime.

The Release page presents whole-solution prerequisites before source preparation. After the selected source snapshot is validated, it remains on Release and adds the manifest-derived minimum RoomOS version, software and product platforms, and external macro dependencies. The Device Administrator then continues to Connect with those requirements visible first.

## Local preview

```sh
npm install
npm run dev
```

The development server listens at `http://127.0.0.1:5176`. It uses real secure WebSocket connections; there is no device simulator. Localhost also exposes review-only navigation with representative data and device-changing actions disabled. If an actual sign-in attempt fails, the Connect page reveals the Companion Device HTTPS link so its self-signed certificate can be trusted before retrying.

## Build and test

```sh
npm test
npm run build
```

Run `npm run verify:release` for the focused Release Contract check. It verifies manifest coverage, stable source anchors, synchronized runtime versions including the exported `projectVersion`, JavaScript syntax, relative macro imports, initialization messages, Installer Contract Version, Tested Installer Version, capability dependencies, and the declared capability-to-runtime identifier mappings.

`prepare:assets` runs the same verifier, resolves the Main Fork version, copies the listed macros into an ignored `public/main/` snapshot, and publishes the root README plus the Custom Companion icon as ignored runtime content. The GitHub Pages artifact uses that same icon as the site favicon and exposes it at the stable public URL used by the Companion Device access panel and WebWidget defaults. A missing, duplicate, stale, unlisted, mismatched, or unresolved deployable source fails both the installer test and build workflows. Stable source filenames and initialization messages shared with the installer live in `release-contract.json`. A release tag must contain its own root `manifest.json`; tagged resources are fetched from one resolved commit SHA at installation time.

Installer and callback credentials are held only in browser memory. The callback account must already exist on the same Companion Device. The installer does not create accounts or connect directly to Parent Room Devices. One verified JSXAPI device session is allowed at a time: while connected, the Connect fields and source selector are locked. Disconnect requires confirmation, closes that session, clears credentials and device-derived state, and retains the selected release snapshot.

The Connect page tells the Device Administrator to set `HttpClient Mode=On` before sign-in and to set `AllowInsecureHTTPS=True` when trusted, host-matching endpoint certificates are not provisioned. Signed-in Companion Device preflight reads both configurations without changing them. Mode must be `On`; otherwise installation stops before any mutation with `Set xConfiguration HttpClient Mode to On, then reconnect.` After preflight, the installer subscribes to `HttpClient AllowInsecureHTTPS`, refreshes its current value after the feedback registration is active, and updates the administrator-owned, device-wide **HTTPClient Trust Posture** throughout the connected session. The subscription ends on Disconnect or reset. Strict validation includes callback-host/SAN and Parent issuing-CA guidance. This path is independent of the browser WSS certificate trust needed to establish the JSXAPI session, and the installer offers no action that changes RoomOS HTTPClient configuration.

Product comparison normalizes Cisco formatting and display-size variants, then checks the selected manifest exactly. If no exact match exists, a product containing `Desk` or `Board Pro` passes when the selected release declares a product in that family. Other products remain blocked until the Device Administrator explicitly acknowledges an unsupported-device exploration warning. That bypass is session-scoped, remains visible in Configure and Review, and does not claim runtime or xAPI support.

Before installation begins, completed progress steps are clickable. Moving backward preserves entered values; moving forward still runs the normal validation. Navigation locks when Install begins. The application uses document scrolling with a sticky action bar so browser viewport changes do not clip the workflow. The installer package version is visible in the rail and footer; the selected Custom Companion Project Version is shown as installation-source metadata rather than an editable Config field.

Configure can copy latitude and longitude from the Installer Computer after browser location permission is granted, copy the Installer Computer's IANA time zone, and preview each valid HTTP or HTTPS `iconUrl`. These are one-time edits to the in-memory Config; the installer does not add location tracking or another RoomOS dependency.

After successful initialization, Complete Setup keeps the Device Administrator session connected. It shows sanitized Parent Room Registrations and Pending Deregistrations, offers optional Add Parent, and can ask the Companion Device to deregister an existing Parent after browser confirmation. Registration and deregistration both remain Companion Device-owned runtime workflows; the browser waits for transaction-correlated terminal results, never reads stored Parent Room credentials, and never connects directly to a Parent Room Device. Because Fresh Installation has just erased the authoritative generated storage, its initial Complete Setup view is known to contain no registrations and does not send a redundant inventory request. Finish explicitly disconnects the session.

Configure displays each current release Config definition from the trailing comment beside its source value. String fields named `userGuidance` use full-width multiline controls so the complete Standalone and Paired guidance remains visible while editing. Older selected releases without source definitions remain installable. The Review page presents the generated configuration with human-facing labels, including `Companion Device Information` and `Standalone`. The installer recognizes the older `CompanionBoardInformation` node only for compatibility with older selected releases; current generated Config uses `CompanionDeviceInformation`.

Before Review, the Device Administrator must choose an installation type. **Install or Update — Keep Saved Data** is appropriate for a new endpoint or an upgrade and preserves `Custom-Campanion-Storage`. **Fresh Installation — Erase Saved Data** refreshes the installed macro inventory with `Macros Macro Get`; after deactivating the existing project runtime, it removes that exact generated storage macro when present, then installs the selected release. If the inventory read fails, installation stops before any changes. The Fresh Installation path permanently resets saved Companion Device-local Custom Companion state, including any Pending Deregistration cleanup records whose Parent Room Device acknowledgement has not arrived. Generated storage is not added to the Release Manifest.

After saving and activating the selected source, the installer explicitly issues `Macros Runtime Restart` while the macro-log subscription is active, then waits for the Release Contract initialization result.
