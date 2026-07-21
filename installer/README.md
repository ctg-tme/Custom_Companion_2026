# Custom Companion Installer

Static GitHub Pages installer for deploying a selected Custom Companion release to a companion Board through browser JSXAPI. Its introduction fetches and renders the current repository README at runtime.

## Local preview

```sh
npm install
npm run dev
```

The development server listens at `http://127.0.0.1:5176`. It uses real secure WebSocket connections; there is no device simulator. Localhost also exposes review-only navigation with representative data and device-changing actions disabled. If an actual sign-in attempt fails, the Connect page reveals the Board HTTPS link so its self-signed certificate can be trusted before retrying.

## Build and test

```sh
npm test
npm run build
```

Run `npm run verify:release` for the focused Release Contract check. It verifies manifest coverage, stable source anchors, synchronized runtime versions, JavaScript syntax, relative macro imports, and the initialization messages used by installer log classification.

`prepare:assets` runs the same verifier, resolves the Main Fork version, copies the listed macros into an ignored `public/main/` snapshot, and publishes the root README as ignored runtime content. A missing, duplicate, stale, unlisted, mismatched, or unresolved deployable source fails both the installer test and build workflows. Stable source filenames and initialization messages shared with the installer live in `release-contract.json`. A release tag must contain its own root `manifest.json`; tagged resources are fetched from one resolved commit SHA at installation time.

Installer and callback credentials are held only in browser memory. The callback account must already exist on the same Board. The installer does not create accounts, configure parents, or persist credentials. After successful initialization, it disconnects and directs the user to finish parent configuration on the Companion Device.
