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

## Current Runtime Roles

- Companion board: the movable Board Pro or Board device running `Custom-Campanion_1_Main_2026`.
- Parent room device: the fixed room codec that receives the installed `Custom-Campanion_Room_2026` macro.
- Memory storage: generated state owned by `Memory-Storage-Functions-V2`; this stores board parent-device records and parent registered-board records.
- Transport: RoomOS HTTPClient posts putxml payloads to remote codecs, usually to invoke `Message.Send`, `Peripherals.Connect`, `Peripherals.HeartBeat`, or macro save/activate commands.

## Initialization

The companion board initializes first. It loads local state, validates known parent devices, installs the parent-side macro package, connects itself as a peripheral, and sends a structured `Register` message to each online parent.

```mermaid
flowchart TD
	A[Custom-Campanion_1_Main_2026 starts] --> B[Enable HTTPClient]
	B --> C[Initialize MemoryStorage]
	C --> D[Read parentDevices]
	D --> E{More than 6 parents?}
	E -- Yes --> F[Trim parentDevices to first 6 and write memory]
	E -- No --> G[Read activeParentSerial]
	F --> G
	G --> H[Read standalone UI feature config]
	H --> I[Refresh parent identities with HTTP GET]
	I --> J[Apply standalone or paired UI feature mode]
	J --> K[Render Companion Device Select panel]
	K --> L[Install parent macro package on online parents]
	L --> M[Connect board as parent peripheral]
	M --> N[Send initial peripheral heartbeat]
	N --> O[Send Register message]
	O --> P[Subscribe to Message.Send and UI widget events]
	P --> Q[Start parent status and heartbeat interval]
```

## Parent Macro Installation

The board installs the parent-room runtime onto each online parent codec. The installed runtime name is `Custom-Campanion_Room_2026`; helper modules are copied with their numbered source names.

```mermaid
flowchart TD
	A[Board has online parent status] --> B[Read local macro contents]
	B --> C[RoomReference source macro]
	B --> D[Config module]
	B --> E[Utils module]
	B --> F[DeviceComms module]
	B --> G[MemoryStorage library]
	C --> H[POST Macro.Save over putxml]
	D --> H
	E --> H
	F --> H
	G --> H
	H --> I[Activate Custom-Campanion_Room_2026]
	I --> J[Parent RoomReference initializes]
```

## Codec to Codec Communication

Codec-to-codec commands use the board or parent HTTPClient to post XML to the remote codec `/putxml` endpoint. Custom application messages are carried inside RoomOS `Message.Send` as a JSON envelope.

```mermaid
sequenceDiagram
	participant Board as Companion Board
	participant Parent as Parent Room Codec
	participant ParentMacro as Custom-Campanion_Room_2026
	participant ParentMemory as Parent MemoryStorage

	Board->>Parent: HTTPClient POST /putxml Message.Send Register
	Parent->>ParentMacro: xapi.Event.Message.Send
	ParentMacro->>ParentMacro: Parse Companion Board 2026 envelope
	alt Board already registered
		ParentMacro->>ParentMemory: Overwrite board record by Serial
		ParentMacro->>Board: HTTPClient POST /putxml Message.Send RegisterAccepted
	else Parent has fewer than 3 boards
		ParentMacro->>ParentMemory: Store new board record
		ParentMacro->>Board: HTTPClient POST /putxml Message.Send RegisterAccepted
	else Parent already has 3 boards
		ParentMacro->>Board: HTTPClient POST /putxml Message.Send RegisterDenied
		ParentMacro->>ParentMemory: No write
	end
```

## Message Envelope

Every custom application message produced by `deviceComms.sendMessageCommand` uses this JSON shape inside `Command.Message.Send`:

```json
{
  "App": "Companion Board 2026",
  "Action": "Register",
  "Serial": "sending device serial",
  "Source": {
	"Role": "Board",
	"Name": "source display name",
	"Host": "source IP or host",
	"MacAddress": "source MAC when known"
  },
  "Payload": {}
}
```

The envelope is intentionally small because RoomOS `Message.Send` text is limited to 8192 characters. Timestamps are left to the macro logs, serial data is only sent once at the top level, and empty `Source` fields are omitted. `Register` is intentionally allowed before the parent recognizes the board serial. Other parent-side custom actions require the sending serial to already exist in the parent `registeredBoards` memory list.

## Board Registration

Registration happens during the current peripheral-connect path. The board first registers itself as a RoomOS peripheral, then sends its Custom Companion application registration data.

```mermaid
flowchart TD
	A[Online parent found] --> B[Build companion peripheral info]
	B --> C[Send Peripherals.Connect]
	C --> D[Send initial Peripherals.HeartBeat]
	D --> E[Build Register payload]
	E --> F[Send Message.Send Register]
	F --> G{Parent response}
	G -- RegisterAccepted --> H[Board logs acceptance]
	G -- RegisterDenied --> I[Board shows Room Registration Denied prompt]
	G -- No response or HTTP failure --> J[Board logs peripheral connect failure]
```

The `Register` payload currently includes:

- `Board.Username`
- `Board.Password`
- `Board.ProductPlatform`
- `Capabilities.CanJoinCall`
- `Capabilities.CanMuteAudio`
- `Capabilities.CanMuteVideo`
- `Capabilities.CanReceiveMessages`

## Parent Registration Handling

Each parent codec can store up to 3 registered companion boards. A new registration overwrites an existing board record when the serial matches.

```mermaid
flowchart TD
	A[Parent receives Message.Send event] --> B{Valid Companion Board 2026 message?}
	B -- No --> C[Ignore]
	B -- Yes --> D{Action is Register?}
	D -- Yes --> E[Normalize board record from payload]
	E --> F{Serial already registered?}
	F -- Yes --> G[Overwrite existing board record]
	F -- No --> H{Registered board count below 3?}
	H -- Yes --> I[Append new board record]
	H -- No --> J[Send RegisterDenied with MaxBoardsReached]
	G --> K[Write registeredBoards memory]
	I --> K
	K --> L[Send RegisterAccepted]
	D -- No --> M{Sender serial registered?}
	M -- Yes --> N[Handle or log action]
	M -- No --> O[Send RegisterRequired]
```

If the parent accepts or denies registration but cannot send the response back to the board with the credentials supplied in the `Register` payload, the parent shows a touch panel prompt: `Companion Registration Error`.

## Parent Selection and Ongoing Heartbeat

The board keeps tracking parent availability and maintains the active parent peripheral heartbeat.

```mermaid
flowchart TD
	A[30 second interval fires] --> B[Refresh parent identities and reachability]
	B --> C{Availability changed?}
	C -- Yes --> D[Re-render Companion Device Select panel]
	C -- No --> E[Keep current UI]
	D --> F{Active parent online?}
	E --> F
	F -- Yes --> G[Send Peripherals.HeartBeat with 40 second timeout]
	F -- No --> H[Log active parent offline and skip heartbeat]
```

## UI Feature Mode

The board switches between standalone and paired behavior based on the active parent selection.

```mermaid
flowchart TD
	A[User releases board or selects parent] --> B{Selected StandAlone?}
	B -- Yes --> C[Set activeParentSerial to StandAlone]
	C --> D[Write active parent memory]
	D --> E[Restore stored standalone UI feature values]
	B -- No --> F[Validate selected parent is online]
	F --> G[Set activeParentSerial to parent serial]
	G --> H[Write active parent memory]
	H --> I[Hide paired-mode UI features]
	I --> J[Send active parent heartbeat]
```

## Custom Routes and Actions

The current source keeps a small route map in `Custom-Campanion_1_Main_2026`. The new Message API envelope uses `Action`; older route-like names are still listed here because they are defined as solution routes and are expected to be used by future call-control work.

| Route or Action | Direction | Current Status | Purpose |
| --- | --- | --- | --- |
| `Register` | Board to parent | Implemented | Board sends identity, credentials, and capability payload during peripheral connect. |
| `RegisterAccepted` | Parent to board | Implemented | Parent confirms the board is stored or updated in `registeredBoards`. |
| `RegisterDenied` | Parent to board | Implemented | Parent rejects a new board when its 3-board registration limit is reached. |
| `RegisterRequired` | Parent to board | Implemented guard response | Parent receives a non-register action from an unknown serial and asks the board to register first. |
| `parent.heartbeat` | Board to parent | Defined route | Legacy/custom route name reserved for parent heartbeat messaging. Current heartbeat uses `Peripherals.HeartBeat`. |
| `parent.callState` | Parent to board | Defined route | Reserved for parent call-state updates. |
| `board.joinCall` | Parent to board | Defined route | Reserved for instructing the board to join the selected parent call context. |

## Limits and Storage

- One companion board can keep up to 6 parent devices in board memory.
- One parent room codec can register up to 3 companion boards in parent memory.
- Re-registering the same board serial updates that board record instead of consuming another slot.
- `Custom-Campanion-Storage.js` is generated database state and should not be edited or committed as source.

## Notes

`Custom-Campanion-Storage.js` is generated database state managed by the memory storage library and should not be edited or committed as source.
