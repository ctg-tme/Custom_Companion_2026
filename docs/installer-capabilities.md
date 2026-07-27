# Companion Installer Compatibility and Capabilities

Status: Implemented for the local Main Fork (Beta) candidate; hosting requires the verified commit to be pushed.

This document defines how one current Companion Installer can safely install older and newer Custom Companion releases without coupling every runtime release to one exact installer package version.

## Decision summary

The selected release remains the authority for its Config macro. The installer reads and edits the Config source from the same pinned release snapshot as the rest of the numbered macros, so an additive Config option appears only when that selected release contains it. A normal Config addition does not require an Installer Capability.

The Release Manifest also declares:

- an **Installer Contract Version** for the release's baseline installation semantics;
- a **Tested Installer Version** as compatibility evidence, not an exact version lock; and
- versioned **Installer Capabilities** for optional workflows in which the browser sends a runtime action or waits for a runtime result.

Manifest fragment, with unrelated fields omitted:

```json
{
  "SchemaVersion": 1,
  "CompanionInstaller": {
    "ContractVersion": 1,
    "TestedVersion": "0.1.25",
    "Capabilities": [
      "installer.parent-deregistration.v1",
      "installer.parent-inventory.v1",
      "installer.parent-registration.v1"
    ]
  }
}
```

The installer package version and four-part runtime project version remain independent. `TestedVersion` records the package used for verification; it is not a minimum, maximum, or exact dependency during source selection. The build-time Release Contract verifier requires the current manifest value to match the packaged installer so a beta or release cannot be produced with stale verification provenance.

## Installer preservation policy

Each published release tag preserves the installer source, `package.json`, and package lock that produced its Tested Installer Version. That source is the reproducible compatibility record; the normal installation path remains the current hosted installer, which should support every retained Installer Contract Version it declares.

Do not publish and route to a different web installer for every runtime release. Preserve an immutable built installer artifact only when a new Contract Version cannot be safely supported beside an older contract in the current application. In that exceptional case, archive the artifact with the release and document the versioned entry point rather than silently redirecting based on runtime version.

## Release inventory

The inventory was reviewed on 2026-07-27 from [GitHub Releases](https://github.com/ctg-tme/Custom_Companion_2026/releases), the published tag, the current GitHub Pages snapshot, and repository history.

There are no published stable releases. The only published release is Preview [`v0.1.2.51`](https://github.com/ctg-tme/Custom_Companion_2026/releases/tag/v0.1.2.51). Main Fork (Beta) is a mutable channel rather than an archived release series, so older beta commits are historical evidence and are not selectable beta artifacts. Uncommitted working-tree changes are not a release or beta snapshot and are excluded.

The table collapses documentation-only Main snapshots when their runtime and installer compatibility are identical.

| Source | Runtime version | Installer package at snapshot | Status | Release-provided Installer Capabilities |
| --- | --- | --- | --- | --- |
| Stable releases | — | — | None published | — |
| `v0.1.2.51` | `0.1.2.51` | `0.1.14` | Published Preview | `installer.parent-registration.v1` |
| Main through `dd31309` | `0.1.2.51` | `0.1.14` | Historical beta state | `installer.parent-registration.v1` |
| Main at `5086449` | `0.1.2.52` | `0.1.14` | Historical beta state | `installer.parent-registration.v1` |
| Main at `2e45662` | `0.1.2.53` | `0.1.15` | Historical beta state | Registration, Inventory, and Deregistration `v1` |
| Main at `7354878` | `0.1.2.54` | `0.1.15` | Historical beta state | Registration, Inventory, and Deregistration `v1` |
| Main from `78ed359` through `3d35c89` | `0.1.2.54` | `0.1.16` | Historical beta state | Registration, Inventory, and Deregistration `v1` |
| Main at `e8852a1` | `0.1.2.55` | `0.1.17` | Historical beta state | Registration, Inventory, and Deregistration `v1` |
| Main from `eafe180` through `0bfbfa5` | `0.1.2.55` | `0.1.18` | Historical beta state | Registration, Inventory, and Deregistration `v1` |
| Main at `847b805` | `0.1.2.56` | `0.1.19` | Historical beta state | Registration, Inventory, and Deregistration `v1` |
| Main at `b083f09` | `0.1.2.56` | `0.1.20` | Historical beta state | Registration, Inventory, and Deregistration `v1` |
| Main at `f4e5007` | `0.1.2.57` | `0.1.20` | Historical beta state | Registration, Inventory, and Deregistration `v1` |
| Main after this work package | `0.1.2.62` | `0.1.25` | Current Main Fork source | Registration, Inventory, and Deregistration `v1` plus additive operation progress |

Preview `v0.1.2.51` predates the `CompanionInstaller` manifest object. The installer applies one explicit legacy profile only when that tag resolves to commit `be539c292d79197e8303d42b68902c6985cde699`: Contract Version 1, Tested Installer Version `0.1.14`, and `installer.parent-registration.v1`. It does not infer support from the runtime version. Any other manifest without `CompanionInstaller` metadata is invalid.

## Capability catalog

These are the current release-provided capabilities discovered by auditing the complete installer source and its tests.

| Capability | Promise made by the selected runtime | Installer behavior when absent |
| --- | --- | --- |
| `installer.parent-registration.v1` | Accepts `InstallerParentRegistrationRequest` and emits the transaction-correlated registration success or failure result. | Hide Add Parent and never send the registration request. |
| `installer.parent-inventory.v1` | Accepts `InstallerParentInventoryRequest` and emits the transaction-correlated sanitized inventory success or failure result. | Do not request inventory, show Refresh, or imply that saved Parent Room state was inspected. |
| `installer.parent-deregistration.v1` | Accepts `InstallerParentDeregistrationRequest` and emits the transaction-correlated success, pending, or failure result. | Hide Remove and never send the deregistration request. Inventory may remain read-only when its capability exists. |

Capabilities describe runtime support, not whether a Device Administrator chooses to use a workflow. The installer must check the selected release capability before rendering its control and again before sending its action.

The current Main Fork runtime also emits additive transaction-correlated Registration and Deregistration progress messages. They do not change either v1 capability's required action or terminal-result meaning: the installer uses them when present and retains generic waiting behavior for older v1 runtimes. Progress never substitutes for a terminal success, pending, or failure result, so no new capability version is required.

`installer.parent-deregistration.v1` depends on `installer.parent-inventory.v1` because Remove targets a registration selected from Inventory. Manifest validation and release verification reject Deregistration without Inventory; Inventory without Deregistration remains a valid read-only view.

## Complete installer audit

Most installer behaviors do not belong in the manifest capability list.

| Installer area | Compatibility class | Reason |
| --- | --- | --- |
| Release discovery, ordering, Preview/Beta labels, beta acknowledgement, and commit-pinned resource loading | Installer-native plus Contract Version 1 | These select and preserve a source snapshot; they do not call an optional runtime workflow. |
| Manifest validation, product-family and minimum RoomOS checks, external resource loading, and stable Main/Config anchors | Contract Version 1 | These are baseline installation semantics. Product comparison is exact-first, then allows a loose `Desk` or `Board Pro` match when the selected release declares that family. |
| Recursive Config parsing, source-comment definitions, generated Config review, selected Project Version presentation, locked Companion Device host, and required callback paths | Contract Version 1, with fields sourced from Config | The selected Config source already determines which ordinary options exist. Definitions are optional for older releases, and the Project Version is source metadata rather than Deployment Configuration. |
| Browser location, browser time zone, and HTTP/HTTPS icon preview | Installer-native and Config-presence-derived | These conveniences are shown only when the selected Config contains the relevant group or field. |
| Callback credential authentication and Companion Device Identity Confirmation | Contract Version 1 | These are baseline safety gates rather than optional runtime features. |
| Read-only `HttpClient Mode` prerequisite and live HTTPClient Trust Posture reporting | Installer-native preflight and connected-session subscription within Contract Version 1 | Mode blocks before mutation; the `AllowInsecureHTTPS` subscription changes no selected-runtime action or result. The source-driven Config parser continues to expose the legacy field only for older releases that contain it. |
| Installed macro inventory, Install or Update, Fresh Installation, generated storage handling, Legacy Project Macro classification, and optional legacy purge | Contract Version 1 | These define the mutation and preservation model of installation. |
| Macro deactivation, save, activation, Macro Runtime restart, log subscription, initialization classification, waiting, and retry controls | Contract Version 1 | These are the baseline forward-only install and verification protocol. |
| Installer Parent Room Registration | `installer.parent-registration.v1` | It sends an optional runtime action and waits for runtime-owned terminal results. |
| Installer Parent Room Inventory | `installer.parent-inventory.v1` | It sends an optional runtime action and waits for runtime-owned terminal results. |
| Installer Parent Room Deregistration | `installer.parent-deregistration.v1` | It sends an optional runtime action and waits for runtime-owned terminal results. |
| README rendering and sanitization, Mermaid rendering, local review mode, certificate recovery link, unsupported-product exploration acknowledgement, labels, styling, navigation, and redaction | Installer-native | These do not depend on the selected runtime contract. |

This classification deliberately avoids a capability flag for every UI feature. A long list of browser-only flags would duplicate installer implementation and would not improve release compatibility.

Exact-first comparison with a loose `Desk` or `Board Pro` fallback is a backwards-compatible interpretation of existing `ProductPlatform` entries and therefore applies across retained releases without changing their manifests. The exploration acknowledgement is a browser-only exception around that preflight: it sends no release-defined runtime action, waits for no release-defined result, and remains visibly unsupported through Review. Neither behavior requires a new Installer Capability or Installer Contract Version.

The HTTPClient prerequisite does not receive an Installer Capability. It is mandatory baseline preflight rather than an optional workflow, sends no runtime-defined action, waits for no runtime-defined result, and can be enforced without changing Release Manifest structure, activation order, generated storage, or initialization verification. Installer Contract Version 1 remains applicable.

## Compatibility behavior

Source selection resolves compatibility before any device mutation:

1. Validate the Release Manifest and resolve its pinned resources.
2. Resolve the exact `CompanionInstaller` metadata, or the explicit `v0.1.2.51` legacy profile.
3. Reject an unsupported Installer Contract Version before installation.
4. Display the Tested Installer Version as verification provenance. Do not require an exact package match.
5. Treat a missing known Installer Capability as unsupported: hide its UI and never send its runtime action.
6. Ignore unknown capability identifiers so an older installer can still perform the parts it understands.
7. Recheck the capability at the action boundary so stale UI state cannot send an unsupported request.

Capabilities are additive within one Installer Contract Version. Once a release publishes a capability identifier, later releases on the same contract must preserve that protocol. A backwards-incompatible action, payload, result, or semantic change receives a new `.v2` capability; it never changes the meaning of `.v1`.

Changing baseline installation semantics—manifest shape, stable source anchors, Config parsing invariants, generated storage ownership, destructive install behavior, activation order, or initialization verification—requires evaluating a new Installer Contract Version instead of adding an optional capability. A current installer may support more than one Contract Version, but must reject versions it does not understand.

## Rules for proposing capabilities

For every runtime or installer work package, explicitly ask whether the selected release must cooperate with a new installer behavior.

Propose a new Installer Capability when all of these are true:

1. The behavior is optional relative to baseline installation.
2. The browser sends a release-defined runtime action, consumes a release-defined result, or otherwise requires selected-runtime cooperation.
3. Absence can be handled safely by hiding or disabling that behavior without blocking baseline installation.
4. Support cannot be established more directly from the selected Config or another existing manifest field.

Do not propose a capability for:

- an additive Config field or group already discovered from the selected Config source;
- browser-only presentation, copy, validation, navigation, or convenience behavior;
- tests, refactors, logging, or styling;
- behavior already guaranteed by the current Installer Contract Version; or
- a breaking baseline change that should instead create a new Contract Version.

Use these versioning rules:

- Keep the same capability identifier for a backwards-compatible implementation improvement.
- Create `.v2` when an existing action, payload, terminal result, trust boundary, or user-visible semantic is no longer backwards compatible.
- Keep `.v1` operational while the same Contract Version promises it.
- Never rename or silently remove a published capability.
- Never infer a capability from the runtime Project Version, installer package version, file presence, or a message timeout.

## Release checklist

The initial implementation updated the manifest validator and types, source selection state, Complete Setup rendering and action guards, release verifier, installer tests, current root manifest, and installer documentation together. Its exact `v0.1.2.51` legacy profile and regression tests prove that the installer does not request Inventory or expose Deregistration for that Preview.

Every new or changed Release Manifest must:

- include `CompanionInstaller.ContractVersion`, `TestedVersion`, and the complete sorted `Capabilities` list;
- declare only capabilities that the selected runtime actually implements;
- satisfy capability dependencies recorded in `installer/release-contract.json`;
- keep `installer/release-contract.json` identifiers synchronized with each declaration;
- make the Release Contract verifier prove every declared action and terminal result exists in deployable source;
- add tests for both present and absent capability behavior;
- update this catalog and release matrix when a new capability is introduced; and
- record source verification separately from device validation.

For Preview `v0.1.2.51`, Complete Setup exposes Add Parent but does not request Inventory or expose Deregistration. For the current Main Fork manifest, all three declared workflows remain available. Missing capabilities fail closed at both presentation and action boundaries.
