# Custom Companion 2026 Installation Guide

## Recommended: use the Companion Installer Web Application

Use the [Companion Installer Web Application](https://ctg-tme.github.io/Custom_Companion_2026/) whenever it is available to your organization. It is the recommended installation path because it:

- selects one versioned source snapshot and checks every required resource before changing a device;
- verifies the expected Companion Device serial number, supported product platform, and minimum RoomOS version;
- validates the Installer Credentials and Companion Device Callback Credentials;
- makes **Install or Update — Keep Saved Data** and **Fresh Installation — Erase Saved Data** consequences explicit;
- installs all required macros with the correct activation model;
- watches the macro log for a confirmed initialization result; and
- can inspect existing Parent Room Registrations and Pending Deregistrations, then start registration or deregistration without connecting directly to a Parent Room Device.

GitHub Pages and repository access policies control availability of the hosted application. If the hosted application is unavailable, run the installer locally as described under [Run the Companion Installer locally](#run-the-companion-installer-locally), or use the [manual installation procedure](#manual-installation).

## Requirements

Check the Release Manifest, [`manifest.json`](../manifest.json), before every deployment. It is authoritative for the selected release's files, minimum RoomOS version, supported product platforms, and external dependencies.

### Hardware and RoomOS

| Item | Requirement |
| --- | --- |
| Companion Device | A manifest-supported Cisco RoomOS endpoint. Known exact product names are Board Pro 55, Board Pro 75, Board Pro 55 G2, Board Pro 75 G2, Board Pro 55 G3, Board Pro 75 G3, Desk Mini, Desk, Desk Pro, and Desk Pro G2. After exact normalized comparison, the installer loosely accepts a name containing `Board Pro` or `Desk` when the selected release declares that family. A Board Pro Series endpoint on a wheel kit is the recommended deployment and primary mobility use case. The installer identifies Desk Series platforms as available for testing or special use cases, but not recommended. A Device Administrator may explicitly bypass the product check to explore another device, but that device remains unsupported and requires independent xAPI and behavior validation. |
| Parent Room Device | A fixed Cisco RoomOS endpoint that can run macros and the xAPI used by Custom Companion. Parent Room Devices are provisioned by the Companion Device during Parent Room Registration; they are not direct Companion Installer targets. Validate each Parent Room Device's required xAPI surfaces and behavior before production use. |
| RoomOS | `11.32.1.1` or later on the Companion Device. Use the same minimum as the deployment baseline for Parent Room Devices because the installer does not perform a Parent Room Device firmware compatibility check. |
| Capacity | One Companion Device can register up to six Parent Room Devices. One Parent Room Device can register up to three Companion Devices. |

### Accounts, network, and browser

Use [Network Requirements](network-requirements.md) for the complete endpoint table, including the downstream services introduced by the optional Simple-WebWidget.

- Use a current browser on an administrator workstation that can reach the Companion Device over HTTPS and secure WebSocket. The hosted installer also needs access to its GitHub Pages site, GitHub release metadata, and release resources.
- Trust the Companion Device's HTTPS certificate in the same browser before connecting. The installer opens `wss://<companion-host>` and cannot bypass browser certificate validation.
- Permit HTTPS connectivity, normally TCP 443, from the administrator workstation to the Companion Device and in both directions between the Companion Device and every Parent Room Device.
- Ensure the host names or IP addresses entered during configuration and Parent Room Registration are reachable from the RoomOS devices that will use them.
- Enable the RoomOS Macro Runtime on each participating device.
- Before installation or Parent Room Registration, a Device Administrator must set `xConfiguration HttpClient Mode: On` on every participating Companion Device and Parent Room Device. Custom Companion reads this prerequisite and never changes it.
- Choose one administrator-owned HTTPClient Trust Posture per sending device:
  - Production: `xConfiguration HttpClient AllowInsecureHTTPS: False`. Install the remote device's issuing CA in RoomOS and use a requested FQDN or IP address present in the remote certificate SAN in both directions.
  - Lab: `xConfiguration HttpClient AllowInsecureHTTPS: True`. This permits untrusted or self-signed certificates for every qualifying HTTPClient destination on that sending device, not only Custom Companion peers.
- Treat browser WSS trust and RoomOS HTTPClient trust as separate paths. Accepting the Companion Device certificate in the installer browser does not install a CA on either RoomOS device or prove device-to-device certificate validation.
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
6. Read and record `HttpClient Mode` and `HttpClient AllowInsecureHTTPS` on every participating device. Correct the production or lab posture before importing or activating macros.

## Install with the Companion Installer

1. Open the [Companion Installer Web Application](https://ctg-tme.github.io/Custom_Companion_2026/).
2. Review the project introduction, then choose the newest appropriate stable release. Acknowledge the warning if you intentionally select Main Fork (Beta).
3. Enter the Companion Device host address, expected serial number, and Installer Credentials.
4. If sign-in fails because of certificate trust, open the Companion Device HTTPS page from the installer, accept the browser warning according to your organization's policy, and try again.
5. Confirm that the installer reports a matching serial number, supported product family, and supported RoomOS version.
   - The installer checks normalized product names exactly first. If no exact match exists, a product name containing `Desk` or `Board Pro` passes when the selected Release Manifest declares that family.
   - For any other product, the installer remains blocked until the Device Administrator explicitly acknowledges the unsupported-device exploration warning. The acknowledgement lasts only for that browser session, remains visible through Review, and does not establish support.
   - During this signed-in preflight, the installer reads `HttpClient Mode` and `HttpClient AllowInsecureHTTPS` without changing them. If Mode is not `On`, installation stops before any mutation with `Set xConfiguration HttpClient Mode to On, then reconnect.`
   - Review the reported **HTTPClient Trust Posture**. Under strict validation, confirm that the installer host becomes a callback host that matches the Companion Device certificate SAN and that every Parent Room Device trusts its issuing CA.
   - The verified connection is locked to one Companion Device. To change devices, select **Disconnect**, confirm the safeguard dialog, and reconnect. The selected release remains prepared, while credentials and device-derived state are cleared.
6. Configure the Companion Device runtime:
   - enter the existing Companion Device Callback Credentials;
   - keep a distinct callback account unless your deployment deliberately reuses the installer account;
   - review PIN Mode defaults and Companion WebWidget settings; HTTPClient trust is administrator-owned RoomOS configuration rather than Deployment Configuration;
   - select **Use Computer Location** to copy the Installer Computer's latitude and longitude after granting browser location permission, or enter the coordinates manually;
   - select **Use Computer Time Zone** to copy the Installer Computer's current IANA time zone, or enter it manually;
   - verify each Standalone and Paired `iconUrl` in the image preview; and
   - remember that PIN Mode defaults apply only when saved PIN Mode state does not already exist.
7. Choose the installation type:
   - **Install or Update — Keep Saved Data** is for a new endpoint or an upgrade and preserves `Custom-Campanion-Storage`.
   - **Fresh Installation — Erase Saved Data** removes `Custom-Campanion-Storage` immediately before installation. This permanently discards saved Parent Room Devices, Pending Deregistration cleanup records, the active Parent Room Device selection, PIN Mode state, and captured Standalone Paired Environment and standby preferences.
8. Review the selected source, target, configuration, file count, installation type, and any Legacy Project Macros. The installer is forward-only and does not restore overwritten files after a failure.
   - Before installation starts, select any completed progress step to return to it. Values are retained, and forward navigation repeats validation. Progress navigation locks when Install begins.
9. Start the installation and keep the browser connected while it streams macro logs. The installer saves and activates Main, explicitly restarts the Macro Runtime, and reaches **Companion Device Installation Ready** after the Main macro logs:

   ```text
   Custom Companion initialized on Companion Device
   ```

   If the Main macro logs the following message, installation stopped and the accompanying diagnostic must be corrected:

   ```text
   Custom Companion initialization stopped on Companion Device
   ```

10. On Complete Setup:
    - review **Parent Room Registrations** and **Pending Deregistrations** already stored on the Companion Device;
    - after Fresh Installation, confirm the known-empty message; generated storage was erased, so the installer does not issue an unnecessary initial inventory request;
    - use **Add Parent** zero or more times to start Installer Parent Room Registration;
    - use **Remove** and confirm the safeguard dialog to start Installer Parent Room Deregistration; or
    - leave Parent Room administration for the Companion Device interface.
11. Select **Finish** to disconnect the authenticated installer session.
12. Complete the checks under [Validate the installation](#validate-the-installation).

An accepted Add Parent or Remove request is not itself proof of completion. Wait for the transaction-correlated result shown by the installer. An unreachable removed Parent Room Device disappears from registrations and remains visible under Pending Deregistrations while the Companion Device retries remote cleanup.

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

Edit only the Deployment Configuration values in `Custom-Campanion_2_Config_2026.js`. Do not change the exported `projectVersion`.

| Configuration | Manual value |
| --- | --- |
| `CompanionDeviceInformation.host` | Companion Device host name or IP address reachable from every Parent Room Device, without `https://` or a path. The source value is blank and must be supplied. |
| `CompanionDeviceInformation.username` | Existing Companion Device Callback Credentials username. The source default is `custom-companion`. |
| `CompanionDeviceInformation.password` | Existing Companion Device Callback Credentials password. The source value is blank and must be supplied. |
| `pinMode.defaults.enabled` | `true` or `false`. This initializes PIN Mode only when no saved PIN Mode record exists. |
| `pinMode.defaults.pin` | A quoted 4-8 digit PIN. Do not treat it as an administrator or recovery credential. |
| `UserInterface.WebWidget` | Review the enabled state, optional URL override, restoration policy, weather location and unit, time zone, mode-specific `userGuidance`, and icon URLs. Weather and time default disabled with blank location/time-zone values. |

Each literal Config value has a trailing source definition that the Companion Installer displays as field help. Preserve these comments and use valid JavaScript string escaping for every value. Never paste a configuration file containing real credentials into a ticket, chat, or source commit.

### 3. Prepare the Macro Editor

1. Sign in to the Companion Device WebUI with an administrator account.
2. Open **Settings > Macro Editor** and enable macros if the Macro Editor is disabled.
3. Confirm the device serial, product platform, RoomOS version, zero active calls, `HttpClient Mode=On`, and the intended device-wide `HttpClient AllowInsecureHTTPS` posture. The runtime will not change either HTTPClient configuration.
4. For an upgrade, deactivate `Custom-Campanion_1_Main_2026` before overwriting any project file.
5. Choose the state-handling path:
   - For the equivalent of Install or Update — Keep Saved Data, leave `Custom-Campanion-Storage` in place and inactive.
   - For the equivalent of Fresh Installation — Erase Saved Data, first ensure the Companion Device is Standalone, securely back up the storage macro, deactivate the project runtime, and remove only `Custom-Campanion-Storage`. This deletion is permanent and can abandon Pending Deregistration cleanup.
6. Compare installed `Custom-Campanion_*_2026` macros with the selected Release Manifest. Deactivate any Legacy Project Macro absent from the selected manifest. Remove it only after confirming it is obsolete. Do not remove unrelated macros or generated storage during Install or Update — Keep Saved Data.

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
7. Wait for `Custom Companion initialized on Companion Device`. Main first requires local `HttpClient Mode=On`, then verifies that `CompanionDeviceInformation.host`, `.username`, and `.password` are configured before enabling the solution. Disabled or unreadable Mode stops with `CC26-INIT-HTTPCLIENT-MODE`; a missing callback field stops with `CC26-INIT-CALLBACK-CREDENTIALS`. If initialization stops, leave the helper macros inactive, inspect the full diagnostic, correct the named prerequisite, and restart the Macro Runtime only after the fault is understood.

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
- Both the Companion Device and each Parent Room Device report the intended administrator-owned HTTPClient Trust Posture; the runtime has not changed `HttpClient Mode` or `HttpClient AllowInsecureHTTPS`.
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
| Installer blocks on HTTPClient Mode | Set `xConfiguration HttpClient Mode` to `On`, then reconnect. The installer reads but never changes this device-wide configuration. |
| Installer rejects compatibility | Confirm the expected serial and RoomOS version against the selected Release Manifest. The installer checks normalized product names exactly, then allows a loose `Desk` or `Board Pro` match when the selected release declares that family. For another product, use the explicit exploration acknowledgement only after accepting that the release is unsupported and may encounter missing xAPI or different behavior. |
| Main reports an import or JavaScript error | Confirm all 15 numbered macros and `Memory-Storage-Functions-V2` came from the intended source set, retain exact names, and are saved before Main is activated. |
| Initialization stops at Companion Device Callback Credentials | Set all three `CompanionDeviceInformation` fields to the callback host, username, and password. For manual installation, verify the account, certificate trust, and bidirectional HTTPS path separately before restarting. |
| Initialization stops with `CC26-INIT-HTTPCLIENT-MODE` | A Device Administrator must set `xConfiguration HttpClient Mode: On` on the affected device and restart the Macro Runtime. Custom Companion does not retry or change the setting. |
| Initialization stops at HTTPClient Trust Posture or memory | Confirm `HttpClient AllowInsecureHTTPS` is readable and matches the approved production or lab posture, certificate CA/SAN requirements are satisfied in both directions, and the dependency exists under its exact name. |
| Companion Device Select is replaced by Companion Device Unavailable | Read the hard-error diagnostic, correct the prerequisite or required xAPI path, then restart the Macro Runtime. |
| Parent Room Registration fails | Confirm host syntax, expected serial, Parent Room Device credentials and permissions, `HttpClient Mode=On` on both devices, HTTPS reachability in both directions, available registration capacity, issuing-CA trust, and requested-host/SAN matching. The terminal installer result identifies the failed stage, stable code, and verified Parent Room Device host; `Waiting for Parent Room Runtime` directs the Device Administrator to the Parent HTTPClient and callback trust path. |
| WebWidget is absent or incomplete | Confirm it is enabled, its URL and icon resources are reachable from the Companion Device, and the configured weather and time values are valid. |
| Upgrade loses saved rooms or PIN state | Confirm whether `Custom-Campanion-Storage` was removed. Only Install or Update — Keep Saved Data preserves it; a deleted storage macro cannot be reconstructed by the installer. |

For exact runtime behavior and xAPI contracts, see the [Technical Reference](technical-reference.md). For operational ownership and planned acceptance coverage, see the [Admin Guide](admin-guide.md).
