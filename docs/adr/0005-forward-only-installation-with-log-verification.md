# ADR 0005: Use Forward-Only Installation with Log Verification

- Status: Accepted
- Date: 2026-07-20

The Companion Installer does not roll back overwritten macros after a failure. It subscribes to `Event.Macros.Log` before activation and treats the Board Main `Custom Campanion initialized` message as Board Installation Ready, `Custom Campanion board initialization stopped` or a JavaScript runtime error as failure, and other error-level messages followed by completion as Completed with Warnings. If no terminal message arrives within two minutes, it reports Initialization Not Confirmed, stays connected, continues streaming logs, and offers Keep Waiting, Restart Macro Runtime, or Disconnect. After a successful result is acknowledged or dismissed, the installer disconnects JSXAPI, clears session credentials, and returns to the initial workflow so the Device Administrator can install another board.
