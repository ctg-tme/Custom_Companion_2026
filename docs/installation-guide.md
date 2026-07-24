# Custom Companion 2026 Installation Guide

## Recommended: use the Companion Installer Web Application

Use the [Companion Installer Web Application](https://ctg-tme.github.io/Custom_Companion_2026/) whenever it is available to your organization. It is the recommended installation path because it:

- selects one versioned source snapshot and checks every required resource before changing a device;
- verifies the expected Companion Device serial number, supported product platform, and minimum RoomOS version;
- validates the Installer Credentials and Companion Device Callback Credentials;
- makes Standard Installation and Clean Installation consequences explicit;
- installs all required macros with the correct activation model;
- watches the macro log for a confirmed initialization result; and
- can start zero or more Parent Room Registrations without connecting directly to a Parent Room Device.

GitHub Pages and repository access policies control availability of the hosted application. If the hosted application is unavailable, run the installer locally as described under [Run the Companion Installer locally](#run-the-companion-installer-locally), or use the [manual installation procedure](#manual-installation).

## Requirements

Check the Release Manifest, [`manifest.json`](../manifest.json), before every deployment. It is authoritative for the selected release's files, minimum RoomOS version, supported product platforms, and external dependencies.

### Hardware and RoomOS

| Item | Requirement |
| --- | --- |
| Companion Device | A manifest-supported Cisco RoomOS endpoint: Board Pro, Board Pro G2, Board Pro G3, Desk Pro, Desk, Desk Mini, or Desk Pro G2. A Board Pro Series endpoint on a wheel kit is the recommended deployment and primary mobility use case. The installer identifies Desk Series platforms as available for testing or special use cases, but not recommended. |
| Parent Room Device | A fixed Cisco RoomOS endpoint that can run macros and the xAPI used by Custom Companion. Parent Room Devices are provisioned by the Companion Device during Parent Room Registration; they are not direct Companion Installer targets. Validate each Parent Room Device's required xAPI surfaces and behavior before production use. |
| RoomOS | `11.32.1.1` or later on the Companion Device. Use the same minimum as the deployment baseline for Parent Room Devices because the installer does not perform a Parent Room Device firmware compatibility check. |
| Capacity | One Companion Device can register up to six Parent Room Devices. One Parent Room Device can register up to three Companion Devices. |

### Accounts, network, and browser

- Use a current browser on an administrator workstation that can reach the Companion Device over HTTPS and secure WebSocket. The hosted installer also needs access to its GitHub Pages site, GitHub release metadata, and release resources.
- Trust the Companion Device's HTTPS certificate in the same browser before connecting. The installer opens `wss://<companion-host>` and cannot bypass browser certificate validation.
- Permit HTTPS connectivity, normally TCP 443, from the administrator workstation to the Companion Device and in both directions between the Companion Device and every Parent Room Device.
- Ensure the host names or IP addresses entered during configuration and Parent Room Registration are reachable from the RoomOS devices that will use them.
- Enable the RoomOS Macro Runtime on each participating device. The Custom Companion runtime enables and configures RoomOS HTTPClient during initialization, so the device account and configuration policy must permit those xAPI changes.
- Record the expected serial number for the Companion Device and for each Parent Room Device before installation.
- Prepare an administrator account on the Companion Device for Installer Credentials. RoomOS restricts macro save and activation to an administrator role.
- Prepare an existing local account on the Companion Device for Companion Device Callback Credentials. A dedicated account such as `custom-companion` is recommended for clearer audit activity. The installer verifies authentication but does not create the account or test its permissions. Registered Parent Room Devices store these credentials so they can send runtime messages back to the Companion Device.
- Prepare a RoomOS account on each Parent Room Device that can read device identity, accept `/putxml` commands, install and run the shared Parent Room macros, and manage the Companion Device peripheral record. The Companion Device stores these credentials for autonomous communication and reconciliation.
- If the managed Companion WebWidget is enabled, allow the Companion Device to reach the configured WebWidget and icon URLs. The default widget uses `https://ctg-tme.github.io/Simple-WebWidget/`.

Protect all device credentials and any backup of generated storage. Do not place them in source control, documentation, screenshots, or support logs.

### Installation workstation software

- The hosted Companion Installer requires no Node.js installation or local build tools.
- Running the installer locally requires Node.js 22 and npm.
- Manual installation requires only a browser, a text editor, access to the RoomOS device WebUI and Macro Editor, and the selected release resources.

## Prepare for installation

1. Schedule a maintenance window with no active calls on the Companion Device or Parent Room Devices involved in registration.
2. If this is an upgrade, return the Companion Device to Standalone before changing macros. This allows the runtime to restore its captured Standalone preferences before maintenance.
3. Export or otherwise securely back up the existing Custom Companion macros and `Custom-Campanion-Storage` before an upgrade or reset. Generated storage can contain device credentials; handle the backup as sensitive data and never commit it.
4. Choose one published stable release whenever possible. Use Preview or Main Fork (Beta) only when you accept pre-release risk.
5. Do not mix files from different tags, branches, or commits. The numbered macros, Config macro, RoomReference source, and external dependency must be installed as one source set.

## Install with the Companion Installer

1. Open the [Companion Installer Web Application](https://ctg-tme.github.io/Custom_Companion_2026/).
2. Review the project introduction, then choose the newest appropriate stable release. Acknowledge the warning if you intentionally select Main Fork (Beta).
3. Enter the Companion Device host address, expected serial number, and Installer Credentials.
4. If sign-in fails because of certificate trust, open the Companion Device HTTPS page from the installer, accept the browser warning according to your organization's policy, and try again.
5. Confirm that the installer reports a matching serial number, supported product platform, and supported RoomOS version.
6. Configure the Companion Device runtime:
   - enter the existing Companion Device Callback Credentials;
   - keep a distinct callback account unless your deployment deliberately reuses the installer account;
   - review PIN Mode defaults, HTTPClient certificate behavior, and Companion WebWidget settings; and
   - remember that PIN Mode defaults apply only when saved PIN Mode state does not already exist.
7. Choose the installation type:
   - **Standard Installation** installs or upgrades the selected source while preserving `Custom-Campanion-Storage`.
   - **Clean Installation** removes `Custom-Campanion-Storage` immediately before installation. This permanently discards saved Parent Room Devices, Pending Deregistration cleanup records, the active Parent Room Device selection, PIN Mode state, and captured Standalone Paired Environment and standby preferences.
8. Review the selected source, target, configuration, file count, installation type, and any Legacy Project Macros. The installer is forward-only and does not restore overwritten files after a failure.
9. Start the installation and keep the browser connected while it streams macro logs. A successful installation reaches **Companion Device Installation Ready** after the Main macro logs:

   ```text
   Custom Companion initialized on Companion Device
   ```

   If the Main macro logs the following message, installation stopped and the accompanying diagnostic must be corrected:

   ```text
   Custom Companion initialization stopped on Companion Device
   ```

10. On Complete Setup, either:
    - use **Add Parent** zero or more times to start Installer Parent Room Registration; or
    - leave Parent Room Registration for the Companion Device interface.
11. Select **Finish** to disconnect the authenticated installer session.
12. Complete the checks under [Validate the installation](#validate-the-installation).

An accepted Add Parent request is not itself proof of registration. Wait for the transaction-correlated success result shown by the installer.

## Run the Companion Installer locally

From the repository:

```sh
cd installer
npm install
npm run dev
```

Open `http://127.0.0.1:5176` in the same browser that trusts the Companion Device certificate. The local installer still uses real secure WebSocket connections and has no device simulator. Follow the same procedure and safety requirements as the hosted application.

## Manual installation

The manual procedure reproduces the release contents and activation model, but it does not provide the installer's serial, compatibility, source-snapshot, credential, legacy-file, or initialization guards. Verify each item yourself before changing the Companion Device.

### 1. Obtain one complete source set

Download these 15 files from one release tag or one exact commit:

```text
Custom-Campanion_1_Main_2026.js
Custom-Campanion_2_Config_2026.js
Custom-Campanion_3_Utils_2026.js
Custom-Campanion_4_UI_2026.js
Custom-Campanion_5_State_2026.js
Custom-Campanion_6_DeviceComms_2026.js
Custom-Campanion_7_RoomReference_2026.js
Custom-Campanion_8_Services_2026.js
Custom-Campanion_9_ParentConnectivity_2026.js
Custom-Campanion_10_PairedEnvironment_2026.js
Custom-Campanion_11_BoardCallSync_2026.js
Custom-Campanion_12_ParentCallCoordination_2026.js
Custom-Campanion_13_StandbyCoordination_2026.js
Custom-Campanion_14_PinMode_2026.js
Custom-Campanion_15_ParentRegistration_2026.js
```

Also download the external dependency named by that release's manifest:

```text
Memory-Storage-Functions-V2.js
```

The current dependency source is [Memory-Storage-Functions-V2](https://raw.githubusercontent.com/ctg-tme/Memory-Storage-Functions-V2/main/Memory-Storage-Functions-V2.js). Do not rename the macro or change any relative import names.

### 2. Configure the Companion Device

Edit only the deployment values in `Custom-Campanion_2_Config_2026.js`. Do not change `config.version`.

| Configuration | Manual value |
| --- | --- |
| `CompanionBoardInformation.host` | Companion Device host name or IP address reachable from every Parent Room Device, without `https://` or a path. |
| `CompanionBoardInformation.username` | Existing Companion Device Callback Credentials username. |
| `CompanionBoardInformation.password` | Existing Companion Device Callback Credentials password. |
| `pinMode.defaults.enabled` | `true` or `false`. This initializes PIN Mode only when no saved PIN Mode record exists. |
| `pinMode.defaults.pin` | A quoted 4-8 digit PIN. Do not treat it as an administrator or recovery credential. |
| `httpClient.allowInsecureHTTPS` | Keep `true` for the usual RoomOS self-signed certificate deployment. Set `false` only when device certificates and trust are already managed for every device-to-device connection. |
| `UserInterface.WebWidget` | Review the enabled state, optional URL override, restoration policy, weather location and unit, time zone, mode text, and icon URLs. |

Use valid JavaScript string escaping for every value. Never paste a configuration file containing real credentials into a ticket, chat, or source commit.

### 3. Prepare the Macro Editor

1. Sign in to the Companion Device WebUI with an administrator account.
2. Open **Settings > Macro Editor** and enable macros if the Macro Editor is disabled.
3. Confirm the device serial, product platform, RoomOS version, and zero active calls.
4. For an upgrade, deactivate `Custom-Campanion_1_Main_2026` before overwriting any project file.
5. Choose the state-handling path:
   - For the equivalent of a Standard Installation, leave `Custom-Campanion-Storage` in place and inactive.
   - For the equivalent of a Clean Installation, first ensure the Companion Device is Standalone, securely back up the storage macro, deactivate the project runtime, and remove only `Custom-Campanion-Storage`. This deletion is permanent and can abandon Pending Deregistration cleanup.
6. Compare installed `Custom-Campanion_*_2026` macros with the selected Release Manifest. Deactivate any Legacy Project Macro absent from the selected manifest. Remove it only after confirming it is obsolete. Do not remove unrelated macros or generated storage during a Standard Installation.

### 4. Import the macros

1. Import `Memory-Storage-Functions-V2.js`.
2. Import the numbered project macros, saving or overwriting each file under its filename without the `.js` suffix. Import `Custom-Campanion_1_Main_2026.js` last.
3. Verify that all imports use these exact macro names. A changed name breaks relative imports or Parent Room provisioning.
4. Keep every imported macro inactive except `Custom-Campanion_1_Main_2026`.
5. In particular, keep these source and dependency macros inactive on the Companion Device:
   - `Memory-Storage-Functions-V2`
   - `Custom-Campanion_2_Config_2026` through `Custom-Campanion_15_ParentRegistration_2026`
   - `Custom-Campanion_7_RoomReference_2026`, which is the source later installed on Parent Room Devices as `Custom-Campanion_Room_2026`
6. Open the Macro Console, then activate `Custom-Campanion_1_Main_2026`.
7. Wait for `Custom Companion initialized on Companion Device`. If initialization stops, leave the helper macros inactive, inspect the full diagnostic, correct the named prerequisite, and restart the Macro Runtime only after the fault is understood.

Do not manually install the Parent Room package. During Parent Room Registration, the Companion Device copies the required source to the Parent Room Device, renames the entry macro to `Custom-Campanion_Room_2026`, activates only that Parent Room entry, and restarts the Parent Room Macro Runtime.

### 5. Register Parent Room Devices

After the Companion Device initializes:

1. On the Companion Device, open **Companion Device Select**.
2. Open **Config**, then select **Start Registration** under **Register Parent Room Device**.
3. If PIN Mode is enabled, enter the current PIN. On a fresh installation this is the configured Default PIN; preserved storage retains its existing PIN Mode state.
4. Enter:
   - a Parent Room Device host name, IPv4 address, or bracketed IPv6 address without a URL scheme or path;
   - the expected Parent Room Device serial number;
   - the Parent Room Device account username; and
   - the password twice.
5. Review the displayed host, serial, and username, then confirm registration.
6. Wait for **Parent Room Device Registered**. Registration makes the Parent Room Device selectable but does not automatically select it or leave Standalone.
7. Repeat for additional Parent Room Devices.

Parent Room Registration must verify the live serial before changing the Parent Room Device. A serial mismatch, authentication problem, unavailable xAPI, Parent Room capacity limit, or missing bidirectional network path stops registration.

## Validate the installation

Perform and record these checks separately from source installation:

- `Custom-Campanion_1_Main_2026` is the only active numbered macro on the Companion Device.
- All 15 numbered macros and `Memory-Storage-Functions-V2` are present under their exact names.
- The Macro Console contains the Companion Device initialization success message and no unresolved JavaScript or hard initialization error.
- `Custom-Campanion-Storage` is generated and remains inactive after the first successful initialization.
- **Companion Device Select** appears on the Companion Device.
- The configured PIN Mode behavior works as intended.
- Each registered Parent Room Device completes registration and becomes visible in Companion Device Select.
- Each registered Parent Room Device contains the shared Parent Room package with only `Custom-Campanion_Room_2026` active.
- Parent Room selection, return to Standalone, preference restoration, standby behavior, and Webex call coordination pass your device acceptance plan.
- Newly introduced or optional RoomOS controls are acceptance-tested on every hardware and firmware combination used in production.

Command acceptance, file presence, and macro activation do not by themselves prove runtime behavior. Record observed device validation separately.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Installer cannot connect | Open the Companion Device HTTPS page in the same browser and trust its certificate; confirm the host, administrator credentials, local network path, and secure WebSocket access. |
| Installer rejects compatibility | Confirm the expected serial, exact product platform, and RoomOS version against the selected release manifest. |
| Main reports an import or JavaScript error | Confirm all 15 numbered macros and `Memory-Storage-Functions-V2` came from the intended source set, retain exact names, and are saved before Main is activated. |
| Initialization stops at HTTPClient or memory | Confirm the Macro Runtime and HTTPClient configuration can be changed, the dependency exists under its exact name, and the administrator diagnostic identifies no permissions or storage failure. |
| Companion Device Select is replaced by Companion Device Unavailable | Read the hard-error diagnostic, correct the prerequisite or required xAPI path, then restart the Macro Runtime. |
| Parent Room Registration fails | Confirm host syntax, expected serial, Parent Room Device credentials and permissions, HTTPS reachability in both directions, available registration capacity, and the transaction's macro logs. |
| WebWidget is absent or incomplete | Confirm it is enabled, its URL and icon resources are reachable from the Companion Device, and the configured weather and time values are valid. |
| Upgrade loses saved rooms or PIN state | Confirm whether `Custom-Campanion-Storage` was removed. Only a Standard Installation preserves it; a deleted storage macro cannot be reconstructed by the installer. |

For exact runtime behavior and xAPI contracts, see the [Technical Reference](technical-reference.md). For operational ownership and planned acceptance coverage, see the [Admin Guide](admin-guide.md).
