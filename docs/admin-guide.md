# Custom Companion Admin Guide

> **Status:** Content outline. The final procedures, screenshots, and acceptance steps still need to be written and validated against the Companion Installer and supported RoomOS devices.

This guide is for Device Administrators responsible for planning, installing, configuring, validating, maintaining, or recovering a Custom Companion deployment.

## Planned contents

### 1. Solution overview

- Companion Device and Parent Room Device roles
- Standalone and Paired operating modes
- What the Companion Installer owns
- What the Companion Device runtime owns
- Supported and Deferred Surfaces

### 2. Requirements and planning

- Supported product platforms and minimum RoomOS version
- Network reachability and certificate trust
- HTTPClient and Macro Runtime requirements
- Installer Credentials
- Companion Device Callback Credentials
- Parent Room Device account requirements
- Capacity and registration limits

### 3. Prepare the devices

- Confirm the intended Companion Device
- Record expected device serial numbers
- Prepare local accounts without exposing credentials
- Review existing macros and generated Custom Companion storage
- Choose an appropriate maintenance window

### 4. Use the Companion Installer

- Select a release or Main Fork (Beta)
- Connect through browser JSXAPI
- Complete Companion Device Identity Confirmation
- Configure the Companion Device
- Choose Standard Installation or Clean Installation
- Review the planned changes
- Interpret installation logs and terminal outcomes

### 5. Complete setup

- Confirm Companion Device Installation Ready
- Register zero or more Parent Room Devices through Add Parent
- Leave Parent Room Registration for the in-room interface
- Understand the Companion Device-owned registration boundary
- Finish and disconnect the installer session

### 6. Configure Custom Companion

- Configure the Companion Device identity and user interface
- Configure the Companion WebWidget
- Set initial PIN Mode defaults
- Preserve stable compatibility identifiers
- Understand configuration distributed to Parent Room Devices

### 7. Validate the deployment

- Verify installed macro names and activation state
- Verify initialization messages
- Validate Companion Device Select
- Validate Standalone-to-Paired and Paired-to-Standalone transitions
- Validate Webex call coordination
- Validate microphone, volume, DND, UI, proximity, sharing, and standby behavior
- Record device-tested results separately from source verification

### 8. Manage Parent Room Registrations

- Register and replace a Parent Room Device
- Verify the expected Parent Room Device serial
- Understand Companion Device and Parent Room Device capacity
- Deregister safely
- Diagnose and reconcile Pending Deregistration

### 9. Maintain and upgrade

- Preserve generated storage during a Standard Installation
- Understand the permanent effects of a Clean Installation
- Review and purge Legacy Project Macros
- Protect Standalone Preference Snapshots
- Plan upgrades around active calls

### 10. Monitor and troubleshoot

- Read runtime log severity and stable diagnostic codes
- Diagnose Parent Connectivity without treating it as an Unhealthy State
- Respond to the Unhealthy State
- Investigate call, registration, standby, and transport failures
- Know when Macro Runtime restart is required

### 11. Security and data handling

- Credential ownership and storage boundaries
- Serial-number confirmation and non-disclosure
- Browser-session credential handling
- PIN Mode limitations
- Generated memory and Pending Deregistration credentials

### 12. Recovery and known limitations

- Recover from interrupted installation
- Recover PIN Mode through administrator-owned paths
- Understand restart and Standalone Preference Snapshot limitations
- Understand Webex-only automatic call coordination
- Plan device acceptance for optional or newly introduced RoomOS controls

### 13. Reference material

- Release Manifest
- Release Contract
- Macro inventory and activation model
- Architecture decision records
- Technical Reference

For the implemented architecture and exact xAPI behavior, see the [Technical Reference](technical-reference.md).
