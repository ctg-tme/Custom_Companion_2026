# Custom Companion 2026

Custom Companion turns a movable Cisco RoomOS device into a flexible companion for multiple rooms. An In-Room User can choose a registered Parent Room Device when they want the Companion Device to work with that room, or choose Standalone when they want to use it independently.

The primary use case is a Board Pro Series endpoint on a wheel kit: one device that can move where it is needed without being permanently assigned to one room.

## What it does

- Keeps a list of registered Parent Room Devices and makes it easy to switch between them.
- Gives the In-Room User a simple choice between a Parent Room Device and Standalone.
- Follows supported Webex calls from the selected Parent Room Device and joins as a Guest.
- Keeps the Companion Device muted, quiet, and protected from incoming calls while Paired.
- Preserves a call if communication with the selected Parent Room Device is temporarily interrupted.
- Restores the Companion Device's saved Standalone preferences when it is no longer Paired.
- Provides optional PIN protection for room selection, registration, and deregistration controls.

## Why it stands out

Custom Companion is designed around mobility, reversibility, and clear ownership:

- **One Companion Device, many rooms.** A Companion Device can remember up to six Parent Room Devices and use one at a time.
- **Shared rooms stay shareable.** One Parent Room Device can support registrations from up to three Companion Devices.
- **Standalone still feels like Standalone.** The solution captures supported preferences before applying its Paired behavior and restores those exact values later.
- **Temporary network trouble does not automatically end a call.** Call Preservation keeps an active call available while the solution tries to reconnect to the selected Parent Room Device.
- **Installation is guided and guarded.** The browser-based Companion Installer verifies the target Companion Device and offers an explicit choice between preserving or resetting saved Custom Companion state.
- **Parent Room changes remain Companion Device-owned.** The installer targets only the Companion Device; the Companion Device verifies and provisions registered Parent Room Devices.

## A typical experience

1. A Device Administrator installs Custom Companion on the movable Companion Device.
2. Parent Room Devices are registered during setup or later from the Companion Device.
3. An In-Room User moves the Companion Device to a room and selects that room from Companion Device Select.
4. The Companion Device applies its Paired behavior and coordinates with the selected Parent Room Device.
5. The user selects Standalone when the Companion Device should operate independently again.

Webex call coordination is implemented. Other call platforms remain on the Parent Room Device and are not automatically joined by the Companion Device.

## Documentation

- [Installation Guide](docs/installation-guide.md) — recommended Companion Installer workflow, manual macro installation, requirements, and validation.
- [User Guide](docs/user-guide.md) — planned everyday operation guide and current content outline.
- [Admin Guide](docs/admin-guide.md) — planned deployment, configuration, maintenance, and troubleshooting guide outline.
- [Technical Reference](docs/technical-reference.md) — complete runtime architecture, installer behavior, state, communication, and xAPI details.
- [Documentation Index](docs/README.md) — all project documentation organized by audience.

Developers and maintainers should also use the canonical terminology in [CONTEXT.md](CONTEXT.md) and the accepted decisions under [docs/adr/](docs/adr/).

## Current requirements and limits

- Minimum RoomOS version: `11.32.1.1`
- Up to 6 registered Parent Room Devices per Companion Device
- Up to 3 registered Companion Devices per Parent Room Device
- One active Parent Room Device per Companion Device
- One Parent Room Device-authorized call at a time while Paired

The [Release Manifest](manifest.json) is the authority for supported product platforms, installable macros, and external dependencies.
