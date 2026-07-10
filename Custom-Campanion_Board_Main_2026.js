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
 * Version:                 1.0.8
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
 * Code Dependencies:       Memory-Storage-Functions-V2, Custom-Campanion_Config_2026, Custom-Campanion_DeviceComms_2026, Custom-Campanion_Utils_2026, Custom-Companion-Memory-Storage
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
import { utils } from './Custom-Campanion_Utils_2026';

const log = new utils.Logger('Custom-Campanion_Board_Main');

const STORAGE_MACRO_NAME = 'Custom-Campanion';
const PARENT_DEVICES_STORAGE_KEY = 'parentDevices';
const COMPANION_BOARD_INFORMATION = config.CompanionBoardInformation;
const PARENT_STATUS_INTERVAL_MS = 30000;
const PERIPHERAL_TYPE = 'Controller';
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

const mem = new MemoryStorage(xapi, { StorageMacroName: STORAGE_MACRO_NAME });

let parentDevices = [];
let boardState = createDefaultBoardState();
let parentDeviceStatus = [];
let parentStatusInterval = null;

async function init() {
  try { await deviceComms.initializeHttpClient(xapi, HTTP_CLIENT_CONFIG) } catch (error) { utils.hardError({ Context: 'Failed to initialize HTTPClient', Error: error }) };
  try { await mem.init() } catch (e) { utils.hardError({ Context: 'Failed to initialize memory', Error: e }) };

  parentDevices = await readMemoryOrDefault(PARENT_DEVICES_STORAGE_KEY, []);
  boardState = createDefaultBoardState();
  parentDeviceStatus = await refreshParentDeviceIdentities(parentDevices, { isInterval: false });
  await connectPeripheralToOnlineParents(parentDeviceStatus);
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
  const companionBoardInformation = getConfiguredCompanionBoardInformation();
  const peripheralInfo = buildCompanionPeripheralInfo(companionBoardInformation);

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
      await deviceComms.connectPeripheral(xapi, parentDevice, peripheralInfo, HTTP_CLIENT_CONFIG);
      await sendBoardRegistrationMessage(parentDevice, companionBoardInformation);
      log.info({ Message: 'Companion board peripheral connected to parent', Host: parentDevice.host, PeripheralID: peripheralInfo.ID, Type: peripheralInfo.Type });
    } catch (error) {
      log.warn({ Message: 'Companion board peripheral connect failed', Host: parentDevice.host, Error: error.code || error.message || 'Unknown peripheral connect error' });
    }
  }
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
  await sendActiveParentHeartbeat();
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
    await deviceComms.sendPeripheralHeartbeat(xapi, activeParentDevice, getCompanionPeripheralId(), HTTP_CLIENT_CONFIG);
    log.debug({ Message: 'Companion board peripheral heartbeat sent', Host: activeParentDevice.host, PeripheralID: getCompanionPeripheralId() });
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
    ID: getCompanionPeripheralId(),
    Name: companionBoardInformation.name,
    NetworkAddress: companionBoardInformation.host,
    SerialNumber: companionBoardInformation.serial,
    HardwareInfo: 'Custom Campanion Board',
    SoftwareInfo: config.version,
    Type: PERIPHERAL_TYPE
  };
}

function getCompanionPeripheralId() {
  const companionBoardInformation = getConfiguredCompanionBoardInformation();
  return companionBoardInformation.macAddress || companionBoardInformation.serial || companionBoardInformation.host || companionBoardInformation.name;
}

function createDefaultBoardState() {
  const activeParent = getConfiguredCompanionBoardInformation();

  return {
    activeParent: activeParent,
    mode: 'StandAlone',
    lastKnownParentSerial: activeParent.serial,
    lastUpdated: new Date().toISOString()
  };
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