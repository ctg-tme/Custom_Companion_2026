import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = new URL(".", import.meta.url).pathname;
const outputPath = `${outputDir}Custom_Companion_Paired_xAPI_Inventory.xlsx`;
const previewPath = `${outputDir}Custom_Companion_Paired_xAPI_Inventory.png`;
const bottomPreviewPath = `${outputDir}Custom_Companion_Paired_xAPI_Inventory_bottom.png`;

const uiSource = "Custom-Campanion_10_PairedEnvironment_2026.js:58";
const standbySource = "Custom-Campanion_13_StandbyCoordination_2026.js:54";

const modeConfig = (path, pairedValue, source = uiSource, notes = "") => [
  path,
  "xConfiguration",
  "Companion Device",
  "Enter Paired / initialize in Paired",
  pairedValue,
  "Restore the last captured Standalone value",
  "Yes",
  source,
  notes || "Skipped when the optional path is unavailable on the device.",
];

const rows = [
  modeConfig("xapi.Config.UserInterface.Features.Call.AINotes", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.AudioMute", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.CameraControls", "Hidden"),
  modeConfig(
    "xapi.Config.UserInterface.Features.Call.End",
    "Hidden",
    uiSource,
    "Temporarily Auto during Call Preservation or an active-call Unhealthy State."
  ),
  modeConfig("xapi.Config.UserInterface.Features.Call.HdmiPassthrough", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.JoinGoogleMeet", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.JoinMicrosoftTeamsCVI", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.JoinMicrosoftTeamsDirectGuestJoin", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.JoinWebex", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.JoinZoom", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.Keypad", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.LayoutControls", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.MidCallControls", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.MusicMode", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.ParticipantList", "Auto"),
  modeConfig("xapi.Config.UserInterface.Features.Call.SelfviewControls", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.SimultaneousInterpretation", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.Start", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Call.VideoMute", "Auto"),
  modeConfig("xapi.Config.UserInterface.Features.Call.Webcam", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Share.Start", "Hidden"),
  modeConfig("xapi.Config.UserInterface.Features.Whiteboard.Start", "Auto"),
  modeConfig(
    "xapi.Config.BYOD.QRCodePairing",
    "Disabled",
    uiSource,
    "Present in runtime source but currently missing from the README and CONTEXT Paired-policy lists."
  ),
  modeConfig("xapi.Config.Standby.Control", "Off", standbySource),
  modeConfig("xapi.Config.Standby.Halfwake.Mode", "Manual", standbySource),
  modeConfig("xapi.Config.Time.OfficeHours.Enabled", "False", standbySource),
  [
    "xapi.Command.Audio.Microphones.Mute",
    "xCommand",
    "Companion Device",
    "Enter Paired and whenever an unmute is observed",
    "Mute microphones",
    "Microphones remain muted; the user must unmute",
    "No",
    "Custom-Campanion_10_PairedEnvironment_2026.js:166",
    "The exact pre-Paired microphone state is not captured.",
  ],
  [
    "xapi.Command.Audio.Volume.Set",
    "xCommand",
    "Companion Device",
    "Enter Paired and whenever volume differs from 1",
    "Level: 1",
    "Set to Config.Audio.DefaultVolume when safe; prompt during an active call",
    "No",
    "Custom-Campanion_10_PairedEnvironment_2026.js:186",
    "The exact pre-Paired volume is not captured.",
  ],
  [
    "xapi.Config.Audio.DefaultVolume",
    "xConfiguration read",
    "Companion Device",
    "Leaving Paired",
    "Not changed",
    "Read as the target for Command.Audio.Volume.Set",
    "N/A",
    "Custom-Campanion_10_PairedEnvironment_2026.js:372",
    "Read-only dependency; the solution does not change DefaultVolume.",
  ],
  [
    "xapi.Command.Conference.DoNotDisturb.Activate",
    "xCommand",
    "Companion Device",
    "Enter Paired; renew every 2 minutes",
    "Timeout: 5 minutes",
    "Lease is released with DoNotDisturb.Deactivate",
    "No",
    "Custom-Campanion_10_PairedEnvironment_2026.js:250",
    "A Do Not Disturb state that existed before Paired is not captured.",
  ],
  [
    "xapi.Command.Conference.DoNotDisturb.Deactivate",
    "xCommand",
    "Companion Device",
    "Leaving Paired / initialize in Standalone",
    "Not invoked",
    "Deactivate Do Not Disturb",
    "No",
    "Custom-Campanion_10_PairedEnvironment_2026.js:235",
    "Always releases the solution-owned lease; it does not restore an earlier DND state.",
  ],
  [
    "xapi.Command.Standby.Deactivate",
    "xCommand",
    "Companion Device",
    "Active Parent Room Device standby sync",
    "Match Parent state Off",
    "Parent synchronization stops",
    "No",
    "Custom-Campanion_13_StandbyCoordination_2026.js:233",
    "The exact pre-Paired operational standby state is not replayed.",
  ],
  [
    "xapi.Command.Standby.Activate",
    "xCommand",
    "Companion Device",
    "Active Parent Room Device standby sync",
    "Match Parent state Standby",
    "Parent synchronization stops",
    "No",
    "Custom-Campanion_13_StandbyCoordination_2026.js:233",
    "The exact pre-Paired operational standby state is not replayed.",
  ],
  [
    "xapi.Command.Standby.Halfwake",
    "xCommand",
    "Companion Device",
    "Active Parent Room Device standby sync",
    "Match Parent state Halfwake",
    "Parent synchronization stops",
    "No",
    "Custom-Campanion_13_StandbyCoordination_2026.js:233",
    "The exact pre-Paired operational standby state is not replayed.",
  ],
  [
    "xapi.Command.UserInterface.Extensions.WebWidget.Save",
    "xCommand",
    "Companion Device",
    "Mode change and runtime information update",
    "Save Companion Web Widget with Paired content",
    "Save Standalone Companion content, or restore the captured original widget",
    "Conditional",
    "Custom-Campanion_4_UI_2026.js:473",
    "Original widget restoration requires restoreStandaloneExisting: true.",
  ],
  [
    "xapi.Command.UserInterface.Extensions.WebWidget.Remove",
    "xCommand",
    "Companion Device",
    "Leaving Paired when restoring an original widget",
    "Not normally invoked",
    "Remove cc26WebWidget before restoring the original widget",
    "Conditional",
    "Custom-Campanion_4_UI_2026.js:494",
    "Only used when an original Standalone Web Widget was captured.",
  ],
  [
    "xapi.Command.UserInterface.Extensions.Panel.Save",
    "xCommand",
    "Companion Device",
    "Initialization and selection UI refresh",
    "Save cc26_access and cc26_hidden",
    "Panels remain available",
    "Remains",
    "Custom-Campanion_4_UI_2026.js:234",
    "Not a Paired-only change; the panels are solution UI in both modes.",
  ],
  [
    "xapi.Command.UserInterface.Extensions.Panel.Remove",
    "xCommand",
    "Companion Device",
    "Initialization and Unhealthy UI transitions",
    "Remove exact legacy/error panel IDs as applicable",
    "Same lifecycle applies",
    "N/A",
    "Custom-Campanion_4_UI_2026.js:254",
    "Does not remove unrelated UI Extensions.",
  ],
  [
    "xapi.Command.UserInterface.Extensions.Widget.SetValue",
    "xCommand",
    "Companion Device",
    "Parent selection or Standalone transition",
    "Mark active Parent Room Device",
    "Mark Standalone active",
    "N/A",
    "Custom-Campanion_4_UI_2026.js:427",
    "Selection feedback only; it is not a RoomOS xConfiguration.",
  ],
  [
    "xapi.Config.HttpClient.Mode",
    "xConfiguration",
    "Companion Device",
    "Runtime initialization",
    "On",
    "Remains On",
    "No",
    "Custom-Campanion_6_DeviceComms_2026.js:62",
    "Initialization prerequisite, not a Paired-mode toggle; the prior value is not restored.",
  ],
  [
    "xapi.Config.HttpClient.AllowInsecureHTTPS",
    "xConfiguration",
    "Companion Device",
    "Runtime initialization",
    "True with the current deployment default",
    "Remains set",
    "No",
    "Custom-Campanion_6_DeviceComms_2026.js:62",
    "Initialization prerequisite, not a Paired-mode toggle; the prior value is not restored.",
  ],
  [
    "xapi.Config.HttpClient.Mode",
    "xConfiguration",
    "Parent Room Device",
    "Parent runtime initialization and ConfigSync",
    "On",
    "Not affected by Companion Standalone",
    "N/A",
    "Custom-Campanion_7_RoomReference_2026.js:80",
    "Parent prerequisite; the Parent Room Device has no Companion Standalone mode.",
  ],
  [
    "xapi.Config.HttpClient.AllowInsecureHTTPS",
    "xConfiguration",
    "Parent Room Device",
    "Parent runtime initialization and ConfigSync",
    "True initially; then use the synced Companion setting",
    "Not affected by Companion Standalone",
    "N/A",
    "Custom-Campanion_7_RoomReference_2026.js:272",
    "The Parent stores the full ConfigSync subset but only applies its HTTPClient configuration.",
  ],
  [
    "xapi.Command.Macros.Macro.Save",
    "Remote xCommand",
    "Parent Room Device",
    "Parent Room Registration and initialization refresh",
    "Save Parent entry macro and four dependencies",
    "Macros remain installed",
    "Remains",
    "Custom-Campanion_6_DeviceComms_2026.js:466",
    "Delivered from the Companion Device through xapi.Command.HttpClient.Post to /putxml.",
  ],
  [
    "xapi.Command.Macros.Macro.Activate",
    "Remote xCommand",
    "Parent Room Device",
    "Parent Room Registration and initialization refresh",
    "Activate Custom-Campanion_Room_2026",
    "Remains active",
    "Remains",
    "Custom-Campanion_6_DeviceComms_2026.js:466",
    "Imported Parent dependencies remain inactive.",
  ],
  [
    "xapi.Command.Macros.Runtime.Restart",
    "Remote xCommand",
    "Parent Room Device",
    "After Parent macro save/activation",
    "Restart Parent Macro Runtime",
    "No further action",
    "N/A",
    "Custom-Campanion_6_DeviceComms_2026.js:466",
    "One command in the Parent macro installation payload.",
  ],
  [
    "xapi.Command.Peripherals.Connect",
    "Remote xCommand",
    "Parent Room Device",
    "Parent Room Registration and initialization",
    "Register Companion Device as a peripheral",
    "Peripheral remains registered",
    "Remains",
    "Custom-Campanion_6_DeviceComms_2026.js:239",
    "Standalone does not purge the peripheral record.",
  ],
  [
    "xapi.Command.Peripherals.HeartBeat",
    "Remote xCommand",
    "Parent Room Device",
    "Registration, initialization, and active-parent monitoring",
    "Refresh Companion Device peripheral lease",
    "No active-parent heartbeat while Standalone",
    "N/A",
    "Custom-Campanion_6_DeviceComms_2026.js:255",
    "The existing peripheral record remains until deregistration or timeout behavior on RoomOS.",
  ],
  [
    "xapi.Command.Peripherals.Purge",
    "xCommand",
    "Parent Room Device",
    "Confirmed Parent Room Deregistration",
    "Not invoked by Paired selection",
    "Purge the deregistered Companion Device peripheral",
    "N/A",
    "Custom-Campanion_7_RoomReference_2026.js:310",
    "Included for lifecycle completeness; Standalone alone does not invoke it.",
  ],
  [
    "xapi.Command.HttpClient.Post",
    "xCommand transport",
    "Companion Device or Parent Room Device",
    "Remote commands and Custom Companion messages",
    "POST XML to the remote /putxml endpoint",
    "Transport remains available",
    "N/A",
    "Custom-Campanion_6_DeviceComms_2026.js:456",
    "Transport path carrying remote Message.Send, macro, and peripheral commands; it is not itself a mode configuration.",
  ],
];

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("xAPI Inventory");
sheet.showGridLines = false;

sheet.mergeCells("A1:I1");
sheet.getRange("A1").values = [["Custom Companion 2026 — Paired xAPI Inventory"]];
sheet.getRange("A1:I1").format = {
  fill: "#17324D",
  font: { bold: true, color: "#FFFFFF", size: 16 },
  verticalAlignment: "center",
};
sheet.getRange("A1:I1").format.rowHeight = 32;

sheet.mergeCells("A2:I2");
sheet.getRange("A2").values = [[
  "Current working-tree snapshot · one row per full macro-syntax xAPI path · no Area column · solution storage-only records omitted"
]];
sheet.getRange("A2:I2").format = {
  fill: "#DDEBF7",
  font: { color: "#17324D", italic: true, size: 10 },
  verticalAlignment: "center",
};
sheet.getRange("A2:I2").format.rowHeight = 24;

const headers = [
  "Full xAPI Path",
  "Interface Type",
  "Device",
  "Timing / Scope",
  "Paired Value or Behavior",
  "Standalone Handling",
  "Preserved in Standalone?",
  "Source",
  "Notes",
];
sheet.getRange("A4:I4").values = [headers];
sheet.getRange("A5:I" + (rows.length + 4)).values = rows;

const tableRange = `A4:I${rows.length + 4}`;
const table = sheet.tables.add(tableRange, true, "XapiInventoryTable");
table.style = "TableStyleMedium2";
table.showFilterButton = true;
table.showBandedRows = true;

sheet.freezePanes.freezeRows(4);
sheet.freezePanes.freezeColumns(1);

sheet.getRange(tableRange).format = {
  verticalAlignment: "top",
  wrapText: true,
  font: { size: 10, color: "#1F2937" },
};
sheet.getRange("A4:I4").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF", size: 10 },
  verticalAlignment: "center",
  wrapText: true,
};
sheet.getRange("A4:I4").format.rowHeight = 30;

const dataEnd = rows.length + 4;
sheet.getRange(`A5:A${dataEnd}`).format.font = {
  name: "Aptos Mono",
  size: 9,
  color: "#0F3C5E",
};
sheet.getRange(`B5:B${dataEnd}`).format.font = { bold: true, size: 9, color: "#334155" };
sheet.getRange(`G5:G${dataEnd}`).format.horizontalAlignment = "center";
sheet.getRange(`H5:H${dataEnd}`).format.font = { name: "Aptos Mono", size: 8, color: "#475569" };

sheet.getRange(`G5:G${dataEnd}`).conditionalFormats.add("containsText", {
  text: "Yes",
  format: { fill: "#DCFCE7", font: { bold: true, color: "#166534" } },
});
sheet.getRange(`G5:G${dataEnd}`).conditionalFormats.add("containsText", {
  text: "No",
  format: { fill: "#FEE2E2", font: { bold: true, color: "#991B1B" } },
});
sheet.getRange(`G5:G${dataEnd}`).conditionalFormats.add("containsText", {
  text: "Conditional",
  format: { fill: "#FEF3C7", font: { bold: true, color: "#92400E" } },
});
sheet.getRange(`G5:G${dataEnd}`).conditionalFormats.add("containsText", {
  text: "Remains",
  format: { fill: "#DBEAFE", font: { bold: true, color: "#1E40AF" } },
});
sheet.getRange(`G5:G${dataEnd}`).conditionalFormats.add("containsText", {
  text: "N/A",
  format: { fill: "#E5E7EB", font: { color: "#4B5563" } },
});

const widths = {
  A: 48,
  B: 18,
  C: 22,
  D: 30,
  E: 34,
  F: 40,
  G: 23,
  H: 40,
  I: 52,
};
for (const [column, width] of Object.entries(widths)) {
  sheet.getRange(`${column}:${column}`).format.columnWidth = width;
}
sheet.getRange(`A5:I${dataEnd}`).format.rowHeight = 42;

const check = await workbook.inspect({
  kind: "table",
  range: `xAPI Inventory!A1:I${Math.min(dataEnd, 18)}`,
  include: "values,formulas",
  tableMaxRows: 18,
  tableMaxCols: 9,
  maxChars: 12000,
});
console.log(check.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const preview = await workbook.render({
  sheetName: "xAPI Inventory",
  range: `A1:I${Math.min(dataEnd, 20)}`,
  scale: 1,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const bottomPreview = await workbook.render({
  sheetName: "xAPI Inventory",
  range: `A34:I${dataEnd}`,
  scale: 1,
  format: "png",
});
await fs.writeFile(bottomPreviewPath, new Uint8Array(await bottomPreview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(JSON.stringify({ outputPath, previewPath, bottomPreviewPath, rowCount: rows.length }));
