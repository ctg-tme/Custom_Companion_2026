# Custom Companion agent guidance

## Work intake

The user reports the current bugs, feature requests, and maintenance work directly in the chat. There is no persistent issue tracker and no rolling handoff requirement. Treat the user's full list as one work package, identify dependencies, and complete it in small, reviewable steps without adding unrelated work.

Before editing, summarize the intended scope, order, untouched areas, and material risks.

## Grounding

Before changing anything:

1. Read `README.md`, `docs/technical-reference.md`, `CONTEXT.md`, relevant files under `docs/adr/`, recent Git history, current status/diffs, ignored local context, and the source involved in the work package.
2. Review relevant RoomOS development context in `../Bobbys_Macro_AI_Agents` and `../LAB-1451/docs/Main-Lab/RoomOS`.
3. Treat current runtime source and observed device behavior as authoritative. Correct stale documentation when behavior or architecture changes.
4. Preserve pre-existing and unrelated changes. Keep POCs, experiments, generated storage, installer build output, and explicitly ignored files outside deployable source.

## Runtime and installer rules

- Preserve the unbundled numbered-macro architecture, naming, ownership, activation model, and canonical terms documented in `docs/technical-reference.md`, `CONTEXT.md`, and the ADRs.
- Use RoomOS QuickJS-compatible JavaScript and modern explicit xAPI syntax. Keep xAPI paths, commands, subscriptions, and initial reads obvious and documented.
- Preserve trust, credentials, storage, transport, standby, pairing, parent provisioning, Companion Installer, and call-platform decisions.
- Do not remove Deferred Surfaces or inert non-Webex references, and do not describe them as implemented.
- Local xAPI commands remain single-attempt; only explicitly documented network workflows retry.
- Add no unnecessary abstraction, runtime bundling, or external macro dependency.
- Any macro-set, filename, import, project-version, initialization-message, platform, minimum-RoomOS, or external-dependency change must keep `manifest.json`, `installer/release-contract.json`, the installer, and documentation consistent.

## Repository release control

- Git commit and push are standing authorized for completed, verified, scoped work. After verification, commit and push without waiting for a separate request.
- Unrelated and pre-existing changes must not be staged, committed, or pushed.
- Do not rewrite published history or force-push unless the user explicitly requests it.

## Versioning and closeout

Versioning happens after implementation and documentation are complete, immediately before final verification:

- Runtime work increments the final component of the four-part project version once per completed work package. Keep the Main header, Config header, `config.version`, and RoomReference header synchronized.
- Increment a helper/domain macro header only when that file's implementation changes.
- Installer work increments `installer/package.json` and `installer/package-lock.json` together once per completed work package.
- Work spanning runtime and installer deliverables updates both version sets.
- Analysis-only and documentation-only planning do not create a build version.
- A source version does not imply device validation; report those separately.

After versioning, run the checks relevant to the change:

- `cd installer && npm run verify:release`
- `cd installer && npm test && npm run build` for installer or release changes
- `node --check` on changed macros, or all numbered macros for cross-module work
- `git diff --check`
- focused `rg` searches for interfaces, macro names, xAPI usage, versions, and stale documentation
- final diff/status review that separates scoped work from pre-existing changes

Never invent tests or device results.

## Lab deployment closeout

The shared RoomOS Socket Workbench uses these exact lab aliases:

- `board-device`: Companion Device and the only default post-push deployment target.
- `parent-1-eq`: known Parent Room Device; never an automatic Workbench deployment target.
- `parent-2-prog2`: known Parent Room Device; never an automatic Workbench deployment target.

After a completed work package changes one or more deployable numbered runtime macros:

1. Finish implementation, documentation, versioning, and local verification; then commit and push the scoped changes before touching the lab device.
2. Invoke `$roomos-websocket`, reuse the shared Workbench, and resolve the exact `board-device` alias. This section is standing user authorization to preview and apply this exact post-push deployment to `board-device` only.
3. Confirm every macro source selected for deployment matches the pushed `HEAD`. Stop if a relevant macro has later uncommitted edits, the target is unavailable or ambiguous, or the planned device contents differ from the pushed source.
4. Read `Status.SystemUnit.State.NumberOfActiveCalls` on `board-device` through the Workbench before mutation. Do not deploy or restart the Macro Runtime during an active call; stop and report the condition.
5. Use `manifest.json` as the authoritative project macro set and `installer/release-contract.json` for stable names and initialization messages. Compare the committed resources with the Companion Device and install sources that differ or are absent. Keep only `Custom-Campanion_1_Main_2026` active; keep Config, imported modules, parent deployment sources, and external dependencies inactive.
6. Preserve `Custom-Campanion-Storage`, unrelated macros, and retained legacy macros. This standing workflow does not authorize a Clean Installation, storage purge, or direct mutation of either parent alias.
7. Preview every macro write, activation change, and required Macro Runtime restart before applying it through the Workbench. Subscribe to `Event.Macros.Log` before the final activation or restart, then verify the installed source and activation state with macro reads and compare the observed initialization result against the Release Contract messages.
8. Report command acceptance separately from observed runtime behavior and remove temporary subscriptions when validation ends. If validation cannot be completed, leave the committed-and-pushed source intact and report the device-side limitation precisely.

Installer-only, documentation-only, and analysis-only work does not trigger this deployment. A Companion Device runtime restart may still execute the solution's existing Companion Device-owned Parent Room provisioning against registered Parent Room Devices; do not replace or bypass that runtime boundary with direct Workbench deployment to `parent-1-eq` or `parent-2-prog2` without a new explicit request.

## Agent skills

### Issue tracker

No persistent issue tracker is used; the user supplies each work package directly. See `docs/agents/issue-tracker.md`.

### Triage labels

No triage-label workflow is used. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using root `CONTEXT.md`, `docs/technical-reference.md`, and `docs/adr/`. See `docs/agents/domain.md`.

### Task-specific skills

- Use `$grill-with-docs` for behavior, architecture, terminology, or decision changes.
- Use `$diagnose` for reproduced failures.
- Use `$tdd` when the user requests test-first development.
- Use `$improve-codebase-architecture` for architecture or AI-navigability reviews.
- Use `$zoom-out` when an unfamiliar module needs broader context.
- Use `$roomos-websocket` only for explicitly authorized device inspection or control; never place credentials in files, commands, logs, output, or documentation.
