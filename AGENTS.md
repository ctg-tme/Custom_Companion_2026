# Custom Companion agent guidance

## Work intake

The user reports the current bugs, feature requests, and maintenance work directly in the chat. There is no persistent issue tracker and no rolling handoff requirement. Treat the user's full list as one work package, identify dependencies, and complete it in small, reviewable steps without adding unrelated work.

Before editing, summarize the intended scope, order, untouched areas, and material risks.

## Grounding

Before changing anything:

1. Read `README.md`, `CONTEXT.md`, relevant files under `docs/adr/`, recent Git history, current status/diffs, ignored local context, and the source involved in the work package.
2. Review relevant RoomOS development context in `../Bobbys_Macro_AI_Agents` and `../LAB-1451/docs/Main-Lab/RoomOS`.
3. Treat current runtime source and observed device behavior as authoritative. Correct stale documentation when behavior or architecture changes.
4. Preserve pre-existing and unrelated changes. Keep POCs, experiments, generated storage, installer build output, and explicitly ignored files outside deployable source.

## Runtime and installer rules

- Preserve the unbundled numbered-macro architecture, naming, ownership, activation model, and canonical terms documented in `README.md`, `CONTEXT.md`, and the ADRs.
- Use RoomOS QuickJS-compatible JavaScript and modern explicit xAPI syntax. Keep xAPI paths, commands, subscriptions, and initial reads obvious and documented.
- Preserve trust, credentials, storage, transport, standby, pairing, parent provisioning, Companion Installer, and call-platform decisions.
- Do not remove Deferred Surfaces or inert non-Webex references, and do not describe them as implemented.
- Local xAPI commands remain single-attempt; only explicitly documented network workflows retry.
- Add no unnecessary abstraction, runtime bundling, or external macro dependency.
- Any macro-set, filename, import, project-version, initialization-message, platform, minimum-RoomOS, or external-dependency change must keep `manifest.json`, `installer/release-contract.json`, the installer, and documentation consistent.

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

Never invent tests or device results. Git commit and push are standing authorized for completed scoped work, but unrelated and pre-existing changes must not be staged.

## Agent skills

### Issue tracker

No persistent issue tracker is used; the user supplies each work package directly. See `docs/agents/issue-tracker.md`.

### Triage labels

No triage-label workflow is used. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Task-specific skills

- Use `$grill-with-docs` for behavior, architecture, terminology, or decision changes.
- Use `$diagnose` for reproduced failures.
- Use `$tdd` when the user requests test-first development.
- Use `$improve-codebase-architecture` for architecture or AI-navigability reviews.
- Use `$zoom-out` when an unfamiliar module needs broader context.
- Use `$roomos-websocket` only for explicitly authorized device inspection or control; never place credentials in files, commands, logs, output, or documentation.
