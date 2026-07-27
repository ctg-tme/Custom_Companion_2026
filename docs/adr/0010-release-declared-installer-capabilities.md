# ADR 0010: Declare Installer Compatibility in the Release Manifest

- Status: Accepted
- Date: 2026-07-27

## Context

The Companion Installer loads the Config macro from the selected pinned release, so ordinary Config options are naturally release-specific. Optional Complete Setup workflows are different: the latest browser can send runtime actions that an older selected release does not implement. An exact installer-version lock would avoid that mismatch but would unnecessarily couple every runtime release to one installer build.

## Decision

Keep Config source-driven and add a `CompanionInstaller` compatibility object to future Release Manifests. `ContractVersion` identifies the baseline installation protocol, `TestedVersion` records the installer package used for verification without enforcing an exact match, and `Capabilities` declares versioned optional browser-to-runtime workflows. The current catalog is `installer.parent-registration.v1`, `installer.parent-inventory.v1`, and `installer.parent-deregistration.v1`.

The installer hides an absent capability and must not send its action. Unknown capability identifiers are ignored. Published capability meanings are immutable and additive within one Contract Version; incompatible behavior receives a new capability version, while a breaking baseline installation change requires a new Contract Version.

Preview `v0.1.2.51` is immutable and predates this metadata. The implemented installer will carry one exact legacy profile for that tag rather than guessing support from runtime or package versions. All future manifests must declare compatibility explicitly.

## Consequences

- One current installer can safely support multiple runtime releases without maintaining an exact package-version matrix.
- New Config fields continue to appear only for releases that contain them and do not create capability bookkeeping.
- Optional runtime workflows fail closed before a message is sent instead of timing out after installation.
- Release verification must prove that declared capabilities and their Release Contract identifiers exist in the selected runtime.
- Existing installers that do not yet understand this metadata still require published capability protocols to remain backwards compatible.
- Companion Installer `0.1.18`, its verifier and tests, and the current Main Fork manifest activate this contract together.
