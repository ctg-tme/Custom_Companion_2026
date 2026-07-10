# Custom Companion 2026

Custom Companion 2026 is a Cisco RoomOS macro solution for Board Pro Series endpoints with wheel kits. The solution is intended to let a movable Board Pro be reassigned from room to room and coordinate with a selected parent room device.

## High-Level Scope

- Maintain a board-local list of parent room devices using `Memory-Storage-Functions-V2`.
- Provide a PIN-protected custom UI for adding, validating, confirming, listing, and removing parent devices.
- Initialize and use RoomOS HTTPClient for device-to-device communication.
- Use Message API and putxml-based routing to sanitize and handle custom communication between the movable board and parent room devices.
- Hide base board UI surfaces except whiteboard, files, and solution-owned custom UI elements.
- When a parent room joins a call, instruct the movable board to join the same meeting or call context.
- Keep the board camera muted by default, microphones muted, and volume effectively inaudible while preventing accidental user changes where needed.

## Notes

`Custom-Campanion-Storage.js` is generated database state managed by the memory storage library and should not be edited or committed as source.
