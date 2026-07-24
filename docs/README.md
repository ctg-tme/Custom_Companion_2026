# Custom Companion Documentation

Use this index to choose the document that matches your role and task.

| Document | Audience | Purpose | Status |
| --- | --- | --- | --- |
| [Project README](../README.md) | Everyone | A short explanation of Custom Companion, what makes it useful, and its main limits. | Current |
| [Installation Guide](installation-guide.md) | Device Administrators | Recommended Companion Installer workflow, manual installation, hardware and software requirements, validation, and troubleshooting. | Current |
| [User Guide](user-guide.md) | In-Room Users | Everyday use of Companion Device Select, Standalone, Paired operation, calls, status messages, PIN protection, and Parent Room Registration. | Current |
| [Admin Guide](admin-guide.md) | Device Administrators | Device impact, configuration preservation and editing, Parent Room Registration, validation, maintenance, security, recovery, and troubleshooting. | Current |
| [Technical Reference](technical-reference.md) | Developers and maintainers | Detailed runtime architecture, state ownership, communication, xAPI contracts, installer behavior, and implementation limits. | Current |
| [Canonical terminology](../CONTEXT.md) | Authors and maintainers | The authoritative language used across the product, UI, logs, and documentation. | Current |
| [Architecture decisions](adr/) | Developers and maintainers | The reasons behind accepted runtime, installer, identity, registration, and cleanup decisions. | Current |
| [Installer development](../installer/README.md) | Installer contributors | Local preview, testing, builds, release verification, and installer-specific behavior. | Current |

## Document responsibilities

- The root README is the approachable project landing page.
- The Installation Guide is the current procedure for guided and manual deployment.
- The User Guide explains what an In-Room User sees and does.
- The Admin Guide explains device impact, safe change management, and operational ownership.
- The Technical Reference records how the implemented solution works.
- ADRs record why durable architecture and product decisions were made.
- `CONTEXT.md` defines the canonical terms shared by every document.

Source-grounded guidance does not replace validation on the deployed product platform and RoomOS release. Record device-tested results separately from source and installer verification.
