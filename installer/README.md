# Custom Companion Installer

Static GitHub Pages installer for deploying a selected Custom Companion release to a Companion Device through browser JSXAPI. Its introduction fetches and renders the current repository README at runtime.

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

Run `npm run verify:release` for the focused Release Contract check. It verifies manifest coverage, stable source anchors, synchronized runtime versions, JavaScript syntax, relative macro imports, and the initialization messages used by installer log classification.

`prepare:assets` runs the same verifier, resolves the Main Fork version, copies the listed macros into an ignored `public/main/` snapshot, and publishes the root README plus the Custom Companion icon as ignored runtime content. The GitHub Pages artifact exposes that icon at the stable public URL used by the Companion Device access panel and WebWidget defaults. A missing, duplicate, stale, unlisted, mismatched, or unresolved deployable source fails both the installer test and build workflows. Stable source filenames and initialization messages shared with the installer live in `release-contract.json`. A release tag must contain its own root `manifest.json`; tagged resources are fetched from one resolved commit SHA at installation time.

Installer and callback credentials are held only in browser memory. The callback account must already exist on the same Companion Device. The installer does not create accounts or connect directly to Parent Room Devices. After successful initialization, Complete Setup keeps the Device Administrator session connected and offers an optional Add Parent modal. It can be used repeatedly, or Parent Room Device registration can be completed later from the Companion Device interface. The Companion Device runs its existing registration workflow and the installer waits for its transaction-correlated success or failure result; Finish explicitly disconnects the session.

The Review page presents the generated configuration with human-facing labels, including `Companion Device Information` and `Standalone`. The installed Config macro retains the stable compatibility identifiers required by the runtime.

Before Review, the Device Administrator must choose an installation type. **Install Custom Companion 2026 Macros** preserves `Custom-Campanion-Storage`. **Purge Custom-Campanion-Storage and Install Custom Companion 2026 Macros** performs a Clean Installation: immediately before applying changes, the installer refreshes the installed macro inventory with `Macros Macro Get`; after deactivating the existing project runtime, it removes that exact generated storage macro when present, then installs the selected release. If the inventory read fails, installation stops before any changes. The clean path permanently resets saved Companion Device-local Custom Companion state, including any Pending Deregistration cleanup records whose Parent Room Device acknowledgement has not arrived. Generated storage is not added to the Release Manifest.
