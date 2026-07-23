# ADR 0003: Separate Installer and Companion Device Callback Credentials

- Status: Accepted
- Date: 2026-07-20

The Companion Installer uses an administrator account because RoomOS restricts macro save and activation to the Admin role. The Device Administrator creates a dedicated callback account on the Companion Device before using the installer; the installer suggests the username `custom-companion` but neither creates nor modifies accounts and does not recommend a RoomOS role. Before installation, the installer opens and closes a second JSXAPI connection to confirm that the supplied callback credentials authenticate, without testing permissions. The credentials are then inserted into the in-memory config copy and distributed to registered Parent Room Devices for autonomous messages back to the Companion Device. The installer may allow a Device Administrator to reuse the installer account for controlled deployments, but presents separate fields and recommends distinct accounts so RoomOS audit logs clearly distinguish installation activity from runtime callbacks and Parent Room storage does not normally retain administrator credentials.
