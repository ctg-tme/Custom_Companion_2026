# ADR 0004: Require a Companion Device Serial Match Before Installation

- Status: Accepted
- Date: 2026-07-20

Before making any installation change, the Companion Installer requires the Device Administrator to enter the expected Companion Device serial number and reads the connected device's serial through JSXAPI. Installation proceeds only when the normalized values match. The installer reports match or mismatch but never displays or logs the observed serial, reducing the chance of deploying to the wrong reachable device without turning the installer into a device-discovery surface.
