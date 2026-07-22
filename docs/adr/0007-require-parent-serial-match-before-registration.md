# ADR 0007: Require a Parent Serial Match Before Registration

- Status: Accepted
- Date: 2026-07-22

Before making any change to a Parent room device, `Pair New Room` requires the In-Room User to enter the expected Parent serial number and reads the authenticated device's live serial with the existing identity request. Registration proceeds only when normalized serials match. The confirmation presents host, serial, and username but never the password; a mismatch stops before Parent macro installation and does not disclose the observed serial. This adds one deliberate input step to reduce the chance that valid credentials and an incorrect reachable host register the wrong room.
