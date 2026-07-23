# ADR 0002: Use Browser JSXAPI and a Pinned Source Snapshot

- Status: Accepted
- Date: 2026-07-20

## Context

The Companion Installer must be hosted as a static GitHub Pages site, connect directly to a Companion Device, and remain usable as the runtime macro set evolves. Browser `fetch` calls to the RoomOS `/putxml` API are blocked by the device web server's CORS policy, while adding a local proxy would turn a static installer into a multi-component deployment.

## Decision

Use the browser build of JSXAPI to connect directly to the Companion Device over secure WebSocket. The Device Administrator must first trust the Companion Device's certificate in the browser. The installer never connects to a Parent Room Device; the installed Companion Device runtime remains responsible for Parent Room provisioning.

Resolve all source resources from one commit SHA before installation so an evolving branch cannot produce a mixed-version deployment. List every published source version in this order: stable releases from newest to oldest, prereleases labeled Preview, then `main` labeled Main Fork (Beta) with its source version. Draft releases are excluded. Default to the newest stable release; if none exists, default to the newest Preview; if no published release exists, default to Main Fork (Beta).

Generate a Main Fork (Beta) installation manifest during the GitHub Pages build and publish that snapshot's installable macros as same-origin static assets. At runtime, attempt to discover and fetch every published GitHub Release directly from the repository. If the private or unreachable repository prevents release discovery, show Releases Unreachable in the selector and allow Main Fork (Beta) only after a visible warning. Anyone who can access the Pages site may download its Main Fork macro sources; the installer does not request or expose a GitHub access token.

The tagged root `manifest.json` is authoritative for every release. It lists the release files, minimum RoomOS version, supported software and product platforms, and external dependencies by raw URL. A release with a missing or invalid manifest or any unavailable listed resource fails preflight without changing the Companion Device. Main Fork (Beta) uses the root manifest from the Pages build.

Before packaging Main Fork, one Release Contract verifier checks that the manifest `Files` set exactly matches every eligible root `Custom-Campanion_*_2026.js` source, the stable Main, Config, and RoomReference anchors remain present, the runtime project version is synchronized across their required source locations, every project macro passes JavaScript syntax validation, relative imports resolve to project or external manifest resources, and Main still emits the initialization messages consumed by the installer. Missing, duplicate, stale, unlisted, mismatched, or unresolved source stops the build. The stable filenames and initialization messages shared by the installer and verifier live in `installer/release-contract.json`.

Treat `Custom-Campanion_1_Main_2026` and `Custom-Campanion_2_Config_2026` as stable installer anchors. Discover the remaining project macros from root files matching `Custom-Campanion_*_2026.js`. Only the Main anchor is activated on the Companion Device; Config, discovered dependencies, Parent Room deployment sources, and MemoryStorage remain inactive modules.

After configuration and before Review, require the Device Administrator to choose a Standard Installation or Clean Installation. Standard Installation preserves the generated `Custom-Campanion-Storage` macro. Immediately before applying a Clean Installation, refresh the installed macro inventory with `Macros Macro Get` and stop without changing the Companion Device if that read fails. Then deactivate the existing project runtime, remove only that exact generated storage macro when it is present, and install the selected release. The Review step repeats that the operation permanently discards saved Parent Room Devices, Pending Deregistration cleanup records, the active Parent Room selection, PIN Mode state, and captured Standalone UI and standby settings. Generated storage remains outside the Release Manifest and is not a Legacy Project Macro.

Fetch `Memory-Storage-Functions-V2` from its public `ctg-tme/Memory-Storage-Functions-V2` repository instead of copying it into this repository or pinning it here. Its maintainer owns both repositories and guarantees backward-compatible changes, so it is an explicit exception to the single-repository snapshot rule.

## Consequences

- Companion Device credentials remain in the browser session and are passed directly to JSXAPI rather than through an installer service.
- Certificate trust and local network reachability are explicit installation prerequisites.
- Resource discovery may evolve independently, but every installation must retain a single resolved source snapshot.
- Local installer tests, production builds, and the GitHub Pages workflow all run the same Release Contract verification before packaging.
- Adding or removing an eligible runtime macro is reflected by rebuilding the Pages artifact rather than changing installer code.
- MemoryStorage can advance independently of the Custom Companion snapshot; compatibility is governed by its upstream backward-compatibility contract.
- When an installed project macro is absent from the selected snapshot, the installer identifies it as legacy, lists it explicitly, and offers a checked-by-default **Purge legacy files** option. The Device Administrator can opt out; retained legacy files are deactivated. Generated storage and unrelated macros are never included in the purge scope.
- A Standard Installation cannot delete generated storage. A Clean Installation makes that one destructive storage action explicit before Review and does not broaden the installer to unrelated macros or Parent Room Devices.
