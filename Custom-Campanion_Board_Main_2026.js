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
 * Version:                 1.0.1
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

const mem = new MemoryStorage(xapi, { StorageMacroName: config.memory.storageMacroName });

let parentDevices = [];
let boardState = createDefaultBoardState();

async function init() {
  try { await deviceComms.initializeHttpClient(xapi, config.httpClient) } catch (error) { utils.hardError({ Context: 'Failed to initialize HTTPClient', Error: error }) };
  try { await mem.init() } catch (e) { utils.hardError({ Context: 'Failed to initialize memory', Error: e }) };

  parentDevices = await readOrInitializeMemory(config.parentDevices.storageKey, []);
  boardState = await readOrInitializeMemory(config.boardState.storageKey, createDefaultBoardState());

  if (!boardState.activeParent || !boardState.activeParent.serial) {
    boardState = createDefaultBoardState();
    await mem.write(config.boardState.storageKey, boardState);
  }

  warnIfCredentialsAreStored(parentDevices);
  log.info({ Message: 'Custom Campanion initialized', Version: config.version, ActiveParent: boardState.activeParent.name });
}

async function readOrInitializeMemory(key, defaultValue) {
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

function createDefaultBoardState() {
  return {
    activeParent: config.boardState.standAloneParent,
    mode: 'StandAlone',
    lastKnownParentSerial: config.boardState.standAloneParent.serial,
    lastUpdated: new Date().toISOString()
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