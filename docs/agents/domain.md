# Domain documentation

Custom Companion is a single-context repository. The runtime macros and Companion Installer share one product language and one architectural decision history.

## Read before exploring

- `README.md` for the product overview and documentation entry points.
- `docs/technical-reference.md` for implemented behavior, macro ownership, deployment, and installer operation.
- `CONTEXT.md` for canonical domain language and terms to avoid.
- Relevant ADRs under `docs/adr/` before changing architecture, trust, credentials, storage, transport, standby, pairing, installer, or call-platform decisions.
- `installer/README.md`, `manifest.json`, and `installer/release-contract.json` for installation and release work.
- `docs/installer-capabilities.md` before creating a Release Manifest or adding, changing, or removing an installer-to-runtime workflow.

Use `CONTEXT.md` terminology in code, tests, documentation, and user communication. If a required concept is missing or an existing ADR must be reconsidered, use `$grill-with-docs` rather than silently inventing a synonym or overriding the decision.
