/**
********************************************************
Copyright (c) 2026 Cisco and/or its affiliates.
This software is licensed to you under the terms of the Cisco Sample
Code License, Version 1.1 (the "License"). You may obtain a copy of the
License at
              https://developer.cisco.com/docs/licenses
All use of the material herein must be in accordance with the terms of
the License. All rights not expressly granted by the License are
reserved. Unless required by applicable law or agreed to separately in
writing, software distributed under the License is distributed on an "AS
IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
or implied.
*********************************************************
*/

/**
 * Author(s):               Robert (Bobby) McGonigle Jr
 *                          Technical Marketing Engineer
 *                          Cisco Systems Inc.

 * Date Created:            July 09, 2026
 * Revised:                 July 09, 2026
 * Version:                 1.0.11
 *
 * Description:             A macro that facilitates a custom Companion Solution for Board Series endpoints with Wheel Kits
 *                          This is the Main Macro, that will initialize all other devices in scope and will govern the solution's main logic and functionality.
 *
 * Documentation:           N/A
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro Series
 *
 * Code Dependencies:       Memory-Storage-Functions-V2, Custom-Campanion_Config_2026, Custom-Campanion_DeviceComms_2026, Custom-Campanion_UI_2026, Custom-Campanion_Utils_2026, Custom-Companion-Memory-Storage
 *
 * AI Generation:           Percentage: 95%
 *                          Model(s): GPT-5.3-Codex
 *                          Instruction File(s): /Users/bomcgoni/.claude/rules/Bobby_McGonigles_Macro_Rule_Set_for_AI.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

import xapi from 'xapi';
import { MemoryStorage } from './Memory-Storage-Functions-V2';
import { config } from './Custom-Campanion_Config_2026';
import { deviceComms } from './Custom-Campanion_DeviceComms_2026';
import { companionUi } from './Custom-Campanion_UI_2026';
import { utils } from './Custom-Campanion_Utils_2026';

const log = new utils.Logger('Custom-Campanion_Board_Main');

const STORAGE_MACRO_NAME = 'Custom-Campanion';
const PARENT_DEVICES_STORAGE_KEY = 'parentDevices';
const ACTIVE_PARENT_SERIAL_STORAGE_KEY = 'activeParentSerial';
const STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY = 'standaloneUiFeatureConfig';
const STAND_ALONE_PARENT_SERIAL = 'StandAlone';
const COMPANION_BOARD_INFORMATION = config.CompanionBoardInformation;
const PARENT_STATUS_INTERVAL_MS = 30000;
const INITIAL_PERIPHERAL_HEARTBEAT_TIMEOUT_SECONDS = 5;
const ACTIVE_PARENT_HEARTBEAT_TIMEOUT_SECONDS = 40;
const OFFLINE_PARENT_SELECTION_RETRY_COUNT = 5;
const PERIPHERAL_TYPE = 'ControlSystem';
const HTTP_CLIENT_CONFIG = {
  mode: 'On',
  allowInsecureHTTPS: config.httpClient.allowInsecureHTTPS,
  maxConcurrentRequests: 3
};
const MESSAGE_CONFIG = {
  service: 'CustomCampanion',
  routes: {
    heartbeat: 'parent.heartbeat',
    boardRegistration: 'parent.boardRegistration',
    callState: 'parent.callState',
    joinCall: 'board.joinCall'
  }
};
const PARENT_INSTALL_CONFIG = {
  roomReferenceSourceMacroName: 'Custom-Campanion_RoomReference_2026',
  roomReferenceTargetMacroName: 'Custom-Campanion_Room_2026',
  configMacroName: 'Custom-Campanion_Config_2026',
  memoryStorageMacroName: 'Memory-Storage-Functions-V2'
};
const UI_FEATURE_CONFIGS = [
  { key: 'call', path: ['UserInterface', 'Features', 'Call', 'Start'], pairedValue: 'Hidden' },
  { key: 'share', path: ['UserInterface', 'Features', 'Share', 'Start'], pairedValue: 'Hidden' },
  { key: 'aiNotes', path: ['UserInterface', 'Features', 'Call', 'AINotes'], pairedValue: 'Hidden' },
  { key: 'webex', path: ['UserInterface', 'Features', 'Call', 'JoinWebex'], pairedValue: 'Hidden' },
  { key: 'microsoftTeamsCvi', path: ['UserInterface', 'Features', 'Call', 'JoinMicrosoftTeamsCVI'], pairedValue: 'Hidden' },
  { key: 'microsoftTeamsDirectGuestJoin', path: ['UserInterface', 'Features', 'Call', 'JoinMicrosoftTeamsDirectGuestJoin'], pairedValue: 'Hidden' },
  { key: 'googleMeet', path: ['UserInterface', 'Features', 'Call', 'JoinGoogleMeet'], pairedValue: 'Hidden' },
  { key: 'zoom', path: ['UserInterface', 'Features', 'Call', 'JoinZoom'], pairedValue: 'Hidden' },
  { key: 'scanToPair', path: ['BYOD', 'QRCodePairing'], pairedValue: 'Disabled' }
];

const mem = new MemoryStorage(xapi, { StorageMacroName: STORAGE_MACRO_NAME });

let parentDevices = [];
let boardState = createDefaultBoardState();
let parentDeviceStatus = [];
let parentStatusInterval = null;
let activeParentSerial = STAND_ALONE_PARENT_SERIAL;
let companionPeripheralId = '';
let standaloneUiFeatureConfig = {};
let isApplyingUiFeatureConfig = false;

async function init() {
  try { await deviceComms.initializeHttpClient(xapi, HTTP_CLIENT_CONFIG) } catch (error) { utils.hardError({ Context: 'Failed to initialize HTTPClient', Error: error }) };
  try { await mem.init() } catch (e) { utils.hardError({ Context: 'Failed to initialize memory', Error: e }) };

  parentDevices = await readMemoryOrDefault(PARENT_DEVICES_STORAGE_KEY, []);
  activeParentSerial = await readMemoryOrInitialize(ACTIVE_PARENT_SERIAL_STORAGE_KEY, STAND_ALONE_PARENT_SERIAL);
  standaloneUiFeatureConfig = await readMemoryOrDefault(STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY, {});
  await ensureStandaloneUiFeatureConfig();
  registerStandaloneUiFeatureSubscriptions();
  boardState = createDefaultBoardState(activeParentSerial);
  parentDeviceStatus = await refreshParentDeviceIdentities(parentDevices, { isInterval: false });
  boardState = createDefaultBoardState(activeParentSerial);
  await applyUiFeatureMode(boardState.mode);
  await renderSelectDeviceUi();
  await installParentMacrosOnOnlineParents(parentDeviceStatus);
  await connectPeripheralToOnlineParents(parentDeviceStatus);
  registerUiEventHandlers();
  startParentStatusInterval();

  warnIfCredentialsAreStored(parentDevices);
  log.info({ Message: 'Custom Campanion initialized', Version: config.version, ActiveParent: boardState.activeParent.name });
}

async function readMemoryOrDefault(key, defaultValue) {
  try {
    return await mem.read(key);
  } catch (error) {
    if (error.code === 'msfv2.r.3') {
      return defaultValue;
    }

    utils.hardError({ Context: `Failed to fetch memory key [${key}]`, Error: error });
    return defaultValue;
  }
}

async function readMemoryOrInitialize(key, defaultValue) {
  try {
    return await mem.read(key);
  } catch (error) {
    if (error.code === 'msfv2.r.3') {
      await mem.write(key, defaultValue);
      return defaultValue;
    }

    utils.hardError({ Context: `Failed to fetch memory key [${key}]`, Error: error });
    return defaultValue;
  }
}

async function refreshParentDeviceIdentities(devices, options = {}) {
  const refreshedStatus = [];
  const updatedDevices = [];
  let hasParentDeviceUpdates = false;
  const statusLog = options.isInterval ? log.debug.bind(log) : log.info.bind(log);
  const errorLog = options.isInterval ? log.debug.bind(log) : log.warn.bind(log);

  for (let index = 0; index < devices.length; index++) {
    const device = devices[index];

    try {
      const refreshedDevice = await deviceComms.parentInitializationRequest(xapi, device, HTTP_CLIENT_CONFIG);
      const updatedDevice = {
        serial: refreshedDevice.serial,
        name: refreshedDevice.name,
        host: device.host,
        username: device.username,
        password: device.password
      };

      updatedDevices.push(updatedDevice);
      if (device.serial !== updatedDevice.serial || device.name !== updatedDevice.name) {
        hasParentDeviceUpdates = true;
      }

      refreshedStatus.push({
        host: device.host,
        serial: refreshedDevice.serial,
        name: refreshedDevice.name,
        online: true,
        lastHeartbeat: new Date().toISOString(),
        lastError: ''
      });
      statusLog({ Message: 'Parent device identity refreshed', Host: device.host, Serial: refreshedDevice.serial, Name: refreshedDevice.name });
    } catch (error) {
      updatedDevices.push(device);
      refreshedStatus.push({
        host: device.host,
        serial: device.serial,
        name: device.name,
        online: false,
        lastError: error.code || error.message || 'Unknown parent refresh error',
        lastHeartbeat: device.lastHeartbeat || ''
      });
      errorLog({ Message: 'Parent device identity refresh failed', Host: device.host, Error: error.code || error.message || 'Unknown parent refresh error' });
    }
  }

  if (hasParentDeviceUpdates) {
    parentDevices = updatedDevices;
    await mem.write(PARENT_DEVICES_STORAGE_KEY, parentDevices);
    log.info({ Message: 'Persisted refreshed parent device identity fields', UpdatedDeviceCount: parentDevices.length });
  }

  return refreshedStatus;
}

async function connectPeripheralToOnlineParents(statusList) {
  const companionBoardInformation = await getRuntimeCompanionBoardInformation();
  const peripheralInfo = buildCompanionPeripheralInfo(companionBoardInformation);
  companionPeripheralId = peripheralInfo.ID;

  for (let index = 0; index < statusList.length; index++) {
    const status = statusList[index];

    if (!status.online) {
      continue;
    }

    const parentDevice = findParentDeviceByHost(status.host);
    if (!parentDevice) {
      continue;
    }

    try {
      const connectResponse = await deviceComms.connectPeripheral(xapi, parentDevice, peripheralInfo, HTTP_CLIENT_CONFIG);
      const heartbeatResponse = await deviceComms.sendPeripheralHeartbeat(xapi, parentDevice, peripheralInfo.ID, INITIAL_PERIPHERAL_HEARTBEAT_TIMEOUT_SECONDS, HTTP_CLIENT_CONFIG);
      await sendBoardRegistrationMessage(parentDevice, companionBoardInformation);
      log.info({ Message: 'Companion board peripheral connect HTTP response', Host: parentDevice.host, Response: sanitizeHttpResponse(connectResponse) });
      log.info({ Message: 'Companion board initial peripheral heartbeat HTTP response', Host: parentDevice.host, Response: sanitizeHttpResponse(heartbeatResponse), Timeout: INITIAL_PERIPHERAL_HEARTBEAT_TIMEOUT_SECONDS });
      log.info({ Message: 'Companion board peripheral connected to parent', Host: parentDevice.host, PeripheralID: peripheralInfo.ID, Type: peripheralInfo.Type });
    } catch (error) {
      log.warn({ Message: 'Companion board peripheral connect failed', Host: parentDevice.host, Error: error.code || error.message || 'Unknown peripheral connect error' });
    }
  }
}

async function installParentMacrosOnOnlineParents(statusList) {
  const macroPayloads = await getParentInstallMacroPayloads();

  for (let index = 0; index < statusList.length; index++) {
    const status = statusList[index];

    if (!status.online) {
      continue;
    }

    const parentDevice = findParentDeviceByHost(status.host);
    if (!parentDevice) {
      continue;
    }

    try {
      await deviceComms.installParentMacros(xapi, parentDevice, macroPayloads, PARENT_INSTALL_CONFIG, HTTP_CLIENT_CONFIG);
      log.info({ Message: 'Parent macro installation completed', Host: parentDevice.host, MacroName: PARENT_INSTALL_CONFIG.roomReferenceTargetMacroName });
    } catch (error) {
      log.warn({ Message: 'Parent macro installation failed', Host: parentDevice.host, Error: error.code || error.message || 'Unknown parent macro installation error' });
    }
  }
}

async function getParentInstallMacroPayloads() {
  return {
    roomReference: await getLocalMacroContent(PARENT_INSTALL_CONFIG.roomReferenceSourceMacroName),
    config: await getLocalMacroContent(PARENT_INSTALL_CONFIG.configMacroName),
    memoryStorage: await getLocalMacroContent(PARENT_INSTALL_CONFIG.memoryStorageMacroName)
  };
}

async function getLocalMacroContent(macroName) {
  const response = await xapi.Command.Macros.Macro.Get({ Name: macroName, Content: 'True' });
  const macro = response && response.Macro && response.Macro[0];

  if (!macro || !macro.Content) {
    throw new Error(`Macro content not found for ${macroName}`);
  }

  return macro.Content;
}

function startParentStatusInterval() {
  if (parentStatusInterval) {
    clearInterval(parentStatusInterval);
  }

  parentStatusInterval = setInterval(() => {
    runParentStatusInterval().catch(error => {
      utils.softError({ Context: 'Parent status interval failed', Error: error });
    });
  }, PARENT_STATUS_INTERVAL_MS);
}

async function runParentStatusInterval() {
  parentDeviceStatus = await refreshParentDeviceIdentities(parentDevices, { isInterval: true });
  await renderSelectDeviceUi();
  await sendActiveParentHeartbeat();
}

async function renderSelectDeviceUi() {
  try {
    await companionUi.savePanel(xapi, parentDevices, parentDeviceStatus, activeParentSerial);
  } catch (error) {
    utils.softError({ Context: 'Failed to render Companion Device Select UI', Error: error });
  }
}

function registerUiEventHandlers() {
  xapi.Event.UserInterface.Extensions.Widget.Action.on(event => {
    handleWidgetAction(event).catch(error => {
      utils.softError({ Context: 'Failed to handle UI widget action', Event: event, Error: error });
    });
  });
}

async function handleWidgetAction(event) {
  if (!event || event.Type !== 'clicked' || !companionUi.isSelectDeviceWidget(event.WidgetId)) {
    return;
  }

  const widget = companionUi.parseWidgetId(event.WidgetId);

  switch (widget.action) {
    case 'ReleaseDevice':
      await selectStandAloneMode();
      break;
    case 'ReleaseInfo':
      await companionUi.showReleaseInfo(xapi);
      break;
    case 'ParentSelect':
      await selectParentByIndex(widget.index);
      break;
  }
}

async function selectStandAloneMode() {
  activeParentSerial = STAND_ALONE_PARENT_SERIAL;
  await mem.write(ACTIVE_PARENT_SERIAL_STORAGE_KEY, activeParentSerial);
  boardState = createDefaultBoardState(activeParentSerial);
  await applyUiFeatureMode(boardState.mode);
  await companionUi.setSelectedParent(xapi, parentDevices, activeParentSerial);
  log.info({ Message: 'Companion board released to StandAlone mode' });
}

async function selectParentByIndex(parentIndex) {
  const parentDevice = parentDevices[parentIndex];

  if (!parentDevice) {
    return;
  }

  const parentStatus = await refreshParentStatusWithRetries(parentDevice, OFFLINE_PARENT_SELECTION_RETRY_COUNT);
  await renderSelectDeviceUi();

  if (!parentStatus.online) {
    await showSelectedParentOfflinePrompt(parentDevice);
    return;
  }

  activeParentSerial = parentStatus.serial;
  await mem.write(ACTIVE_PARENT_SERIAL_STORAGE_KEY, activeParentSerial);
  boardState = createDefaultBoardState(activeParentSerial);
  await applyUiFeatureMode(boardState.mode);
  await companionUi.setSelectedParent(xapi, parentDevices, activeParentSerial);
  await sendActiveParentHeartbeat();
  log.info({ Message: 'Companion board paired to parent', Host: parentDevice.host, Serial: activeParentSerial, Name: parentStatus.name });
}

async function refreshParentStatusWithRetries(parentDevice, retryCount) {
  let latestStatus = null;

  for (let attempt = 0; attempt < retryCount; attempt++) {
    parentDeviceStatus = await refreshParentDeviceIdentities(parentDevices, { isInterval: true });
    latestStatus = parentDeviceStatus.find(status => status.host === parentDevice.host || status.serial === parentDevice.serial) || null;

    if (latestStatus && latestStatus.online) {
      return latestStatus;
    }
  }

  return latestStatus || {
    host: parentDevice.host,
    serial: parentDevice.serial,
    name: parentDevice.name,
    online: false,
    lastError: 'Parent offline after retry',
    lastHeartbeat: ''
  };
}

async function showSelectedParentOfflinePrompt(parentDevice) {
  await xapi.Command.UserInterface.Message.Prompt.Display({
    Title: 'Room Offline',
    Text: `${parentDevice.name || parentDevice.host} is offline and cannot be paired. Check the room device and try again.`,
    Duration: 10
  });
}

async function ensureStandaloneUiFeatureConfig() {
  let hasUpdates = false;

  for (let index = 0; index < UI_FEATURE_CONFIGS.length; index++) {
    const feature = UI_FEATURE_CONFIGS[index];

    if (standaloneUiFeatureConfig[feature.key] !== undefined) {
      continue;
    }

    const currentValue = await getUiFeatureConfigValue(feature);
    if (currentValue !== null) {
      standaloneUiFeatureConfig[feature.key] = currentValue;
      hasUpdates = true;
    }
  }

  if (hasUpdates) {
    await mem.write(STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY, standaloneUiFeatureConfig);
  }
}

function registerStandaloneUiFeatureSubscriptions() {
  for (let index = 0; index < UI_FEATURE_CONFIGS.length; index++) {
    const feature = UI_FEATURE_CONFIGS[index];
    const node = getXapiConfigNode(feature.path);

    if (!node || typeof node.on !== 'function') {
      log.debug({ Message: 'UI feature config subscription unavailable', Feature: feature.key, Path: feature.path.join('.') });
      continue;
    }

    node.on(value => {
      handleStandaloneUiFeatureChange(feature, normalizeConfigEventValue(value)).catch(error => {
        utils.softError({ Context: 'Failed to save standalone UI feature config change', Feature: feature.key, Error: error });
      });
    });
  }
}

async function handleStandaloneUiFeatureChange(feature, value) {
  if (isApplyingUiFeatureConfig || boardState.mode !== 'StandAlone' || value === undefined || value === null) {
    return;
  }

  standaloneUiFeatureConfig[feature.key] = value;
  await mem.write(STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY, standaloneUiFeatureConfig);
  log.info({ Message: 'Saved standalone UI feature preference', Feature: feature.key, Value: value });
}

async function applyUiFeatureMode(mode) {
  isApplyingUiFeatureConfig = true;

  try {
    for (let index = 0; index < UI_FEATURE_CONFIGS.length; index++) {
      const feature = UI_FEATURE_CONFIGS[index];
      const value = mode === 'StandAlone' ? standaloneUiFeatureConfig[feature.key] : feature.pairedValue;

      if (value === undefined || value === null) {
        continue;
      }

      await setUiFeatureConfigValue(feature, value);
    }
  } finally {
    isApplyingUiFeatureConfig = false;
  }
}

async function getUiFeatureConfigValue(feature) {
  const node = getXapiConfigNode(feature.path);

  if (!node || typeof node.get !== 'function') {
    log.debug({ Message: 'UI feature config get unavailable', Feature: feature.key, Path: feature.path.join('.') });
    return null;
  }

  try {
    return await node.get();
  } catch (error) {
    log.debug({ Message: 'UI feature config get failed', Feature: feature.key, Path: feature.path.join('.'), Error: error.message || error.code || 'Unknown get error' });
    return null;
  }
}

async function setUiFeatureConfigValue(feature, value) {
  const node = getXapiConfigNode(feature.path);

  if (!node || typeof node.set !== 'function') {
    log.debug({ Message: 'UI feature config set unavailable', Feature: feature.key, Path: feature.path.join('.') });
    return;
  }

  try {
    await node.set(value);
  } catch (error) {
    log.warn({ Message: 'UI feature config set failed', Feature: feature.key, Path: feature.path.join('.'), Value: value, Error: error.message || error.code || 'Unknown set error' });
  }
}

function getXapiConfigNode(path) {
  let node = xapi.Config;

  for (let index = 0; index < path.length; index++) {
    if (!node || node[path[index]] === undefined) {
      return null;
    }
    node = node[path[index]];
  }

  return node;
}

function normalizeConfigEventValue(value) {
  if (value && typeof value === 'object' && value.Value !== undefined) {
    return value.Value;
  }

  return value;
}

async function sendActiveParentHeartbeat() {
  const activeParentDevice = findActiveParentDevice();

  if (!activeParentDevice) {
    return;
  }

  const activeParentStatus = parentDeviceStatus.find(status => status.host === activeParentDevice.host);
  if (!activeParentStatus || !activeParentStatus.online) {
    log.warn({ Message: 'Active parent is offline; skipping peripheral heartbeat', Host: activeParentDevice.host });
    return;
  }

  try {
    await deviceComms.sendPeripheralHeartbeat(xapi, activeParentDevice, getCompanionPeripheralId(), ACTIVE_PARENT_HEARTBEAT_TIMEOUT_SECONDS, HTTP_CLIENT_CONFIG);
    log.debug({ Message: 'Companion board peripheral heartbeat sent', Host: activeParentDevice.host, PeripheralID: getCompanionPeripheralId(), Timeout: ACTIVE_PARENT_HEARTBEAT_TIMEOUT_SECONDS });
  } catch (error) {
    log.warn({ Message: 'Companion board peripheral heartbeat failed', Host: activeParentDevice.host, Error: error.code || error.message || 'Unknown peripheral heartbeat error' });
  }
}

async function sendBoardRegistrationMessage(parentDevice, companionBoardInformation) {
  await deviceComms.sendMessageCommand(xapi, parentDevice, MESSAGE_CONFIG.routes.boardRegistration, {
    serial: companionBoardInformation.serial,
    name: companionBoardInformation.name,
    host: companionBoardInformation.host,
    username: companionBoardInformation.username,
    password: companionBoardInformation.password,
    macAddress: companionBoardInformation.macAddress
  }, { service: MESSAGE_CONFIG.service, version: config.version }, HTTP_CLIENT_CONFIG);
}

function findActiveParentDevice() {
  if (boardState.mode === 'StandAlone') {
    return null;
  }

  return parentDevices.find(device => device.serial === boardState.activeParent.serial || device.host === boardState.activeParent.host) || null;
}

function findParentDeviceByHost(host) {
  return parentDevices.find(device => device.host === host) || null;
}

function buildCompanionPeripheralInfo(companionBoardInformation) {
  return {
    ID: getCompanionPeripheralId(companionBoardInformation),
    Name: companionBoardInformation.name,
    NetworkAddress: companionBoardInformation.host,
    SerialNumber: companionBoardInformation.serial,
    HardwareInfo: companionBoardInformation.productPlatform,
    SoftwareInfo: config.version,
    Type: PERIPHERAL_TYPE
  };
}

function getCompanionPeripheralId(companionBoardInformation) {
  if (!companionBoardInformation && companionPeripheralId) {
    return companionPeripheralId;
  }

  companionBoardInformation = companionBoardInformation || getConfiguredCompanionBoardInformation();
  return companionBoardInformation.macAddress || companionBoardInformation.serial || companionBoardInformation.host || companionBoardInformation.name;
}

function createDefaultBoardState(parentSerial = STAND_ALONE_PARENT_SERIAL) {
  const activeParent = getActiveParentBySerial(parentSerial);

  return {
    activeParent: activeParent,
    mode: parentSerial === STAND_ALONE_PARENT_SERIAL ? 'StandAlone' : 'Paired',
    lastKnownParentSerial: activeParent.serial,
    lastUpdated: new Date().toISOString()
  };
}

function getActiveParentBySerial(parentSerial) {
  if (parentSerial === STAND_ALONE_PARENT_SERIAL) {
    return getConfiguredCompanionBoardInformation();
  }

  return parentDevices.find(device => device.serial === parentSerial) || {
    serial: parentSerial,
    name: parentSerial,
    host: '',
    username: '',
    password: ''
  };
}

async function getRuntimeCompanionBoardInformation() {
  const boardInformation = getConfiguredCompanionBoardInformation();
  const productPlatform = await getProductPlatform();
  const serial = await getBoardSerialNumber(boardInformation.serial);
  const macAddress = await getActiveNetworkMacAddress(boardInformation.macAddress);

  return {
    serial: serial,
    host: boardInformation.host,
    username: boardInformation.username,
    password: boardInformation.password,
    macAddress: macAddress,
    productPlatform: productPlatform,
    name: 'Custom Companion Device 2026'
  };
}

async function getProductPlatform() {
  try {
    return await xapi.Status.SystemUnit.ProductPlatform.get();
  } catch (error) {
    log.warn({ Message: 'Failed to fetch ProductPlatform for peripheral name', Error: error.message || error.code || 'Unknown ProductPlatform error' });
    return 'RoomOS Device';
  }
}

async function getBoardSerialNumber(fallbackSerial) {
  try {
    return await xapi.Status.SystemUnit.Hardware.Module.SerialNumber.get();
  } catch (error) {
    log.warn({ Message: 'Failed to fetch board serial number for peripheral registration', Error: error.message || error.code || 'Unknown serial number error' });
    return fallbackSerial || '';
  }
}

async function getActiveNetworkMacAddress(fallbackMacAddress) {
  try {
    const networkStatus = await xapi.Status.Network.get();
    const networkEntries = normalizeNetworkEntries(networkStatus);
    const wifiEntry = networkEntries.find(entry => isWifiConnected(entry) && entry.Wifi && entry.Wifi.MacAddress);

    if (wifiEntry) {
      return wifiEntry.Wifi.MacAddress;
    }

    const ethernetEntry = networkEntries.find(entry => entry.Ethernet && entry.Ethernet.MacAddress);
    if (ethernetEntry) {
      return ethernetEntry.Ethernet.MacAddress;
    }
  } catch (error) {
    log.warn({ Message: 'Failed to fetch network MAC address for peripheral ID', Error: error.message || error.code || 'Unknown network status error' });
  }

  return fallbackMacAddress || '';
}

function normalizeNetworkEntries(networkStatus) {
  if (!networkStatus) {
    return [];
  }

  if (Array.isArray(networkStatus)) {
    return networkStatus;
  }

  if (typeof networkStatus === 'object') {
    return Object.keys(networkStatus).map(key => networkStatus[key]);
  }

  return [];
}

function isWifiConnected(networkEntry) {
  if (!networkEntry || !networkEntry.Wifi || !networkEntry.Wifi.Status) {
    return false;
  }

  return networkEntry.Wifi.Status.toLowerCase() !== 'disconnected';
}

function getConfiguredCompanionBoardInformation() {
  const boardInformation = COMPANION_BOARD_INFORMATION || {};

  return {
    serial: boardInformation.serial || 'StandAlone',
    name: boardInformation.name || 'StandAlone',
    host: boardInformation.host || '',
    username: boardInformation.username || '',
    password: boardInformation.password || '',
    macAddress: boardInformation.macAddress || ''
  };
}

function sanitizeHttpResponse(response) {
  if (!response || typeof response !== 'object') {
    return response;
  }

  return {
    StatusCode: response.StatusCode,
    ReasonPhrase: response.ReasonPhrase,
    Body: response.Body
  };
}

function warnIfCredentialsAreStored(devices) {
  const credentialCount = devices.filter(device => device.username || device.password).length;

  if (credentialCount > 0) {
    log.warn({
      Context: 'Stored parent device credentials are present in MemoryStorage. This is required for autonomous device-to-device communication, but macro/storage access can expose these credentials.',
      CredentialSetCount: credentialCount
    });
  }
}

init();