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

 * Date Created:            July 10, 2026
 * Revised:                 July 21, 2026
 * Version:                 1.0.3
 *
 * Description:             Durable storage keys, safe MemoryStorage reads, and basic board mode state.
 *
 * Documentation:           N/A
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro Series
 *
 * Code Dependencies:       None
 *
 * AI Generation:           Percentage: 95%
 *                          Model(s): GPT-5.3-Codex
 *                          Instruction File(s): /Users/bomcgoni/.claude/rules/Bobby_McGonigles_Macro_Rule_Set_for_AI.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

const STAND_ALONE_PARENT_SERIAL = 'StandAlone';
const PARENT_DEVICES_STORAGE_KEY = 'parentDevices';
const ACTIVE_PARENT_SERIAL_STORAGE_KEY = 'activeParentSerial';
const PIN_MODE_STORAGE_KEY = 'pinMode';
const STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY = 'standaloneUiFeatureConfig';
const STANDALONE_STANDBY_CONFIG_STORAGE_KEY = 'standaloneStandbyConfig';

async function readMemoryOrDefault(mem, key, defaultValue, utils) {
	try {
		return await mem.read(key);
	} catch (error) {
		if (error.code === 'msfv2.r.3') {
			return defaultValue;
		}

		utils.hardError({
			Code: 'CC26-INIT-MEMORY',
			Component: 'MemoryStorage',
			Context: `Failed to fetch memory key [${key}]`,
			Remediation: 'Verify Memory-Storage-Functions-V2 and the generated storage macro, then restart the Macro Runtime.',
			Error: error
		});
		return defaultValue;
	}
}

async function readMemoryOrInitialize(mem, key, defaultValue, utils) {
	try {
		return await mem.read(key);
	} catch (error) {
		if (error.code === 'msfv2.r.3') {
			await mem.write(key, defaultValue);
			return defaultValue;
		}

		utils.hardError({
			Code: 'CC26-INIT-MEMORY',
			Component: 'MemoryStorage',
			Context: `Failed to fetch memory key [${key}]`,
			Remediation: 'Verify Memory-Storage-Functions-V2 and the generated storage macro, then restart the Macro Runtime.',
			Error: error
		});
		return defaultValue;
	}
}

function createBoardState(parentSerial, parentDevices, companionBoardInformation) {
	const activeParent = getActiveParentBySerial(parentSerial, parentDevices, companionBoardInformation);

	return {
		activeParent: activeParent,
		mode: parentSerial === STAND_ALONE_PARENT_SERIAL ? 'StandAlone' : 'Paired',
		lastKnownParentSerial: activeParent.serial,
		lastUpdated: new Date().toISOString()
	};
}

function getActiveParentBySerial(parentSerial, parentDevices, companionBoardInformation) {
	if (parentSerial === STAND_ALONE_PARENT_SERIAL) {
		return companionBoardInformation;
	}

	return parentDevices.find(device => device.serial === parentSerial) || {
		serial: parentSerial,
		name: parentSerial,
		host: '',
		username: '',
		password: ''
	};
}

function findParentDeviceByHost(parentDevices, host) {
	return parentDevices.find(device => device.host === host) || null;
}

function findActiveParentDevice(boardState, parentDevices) {
	if (boardState.mode === 'StandAlone') {
		return null;
	}

	return parentDevices.find(device => device.serial === boardState.activeParent.serial || device.host === boardState.activeParent.host) || null;
}

function warnIfCredentialsAreStored(parentDevices, log) {
	const credentialCount = parentDevices.filter(device => device.username || device.password).length;

	if (credentialCount > 0) {
		log.warn({
			Context: 'Stored parent device credentials are present in MemoryStorage. This is required for autonomous device-to-device communication, but macro/storage access can expose these credentials.',
			CredentialSetCount: credentialCount
		});
	}
}

const companionState = {
	STAND_ALONE_PARENT_SERIAL,
	PARENT_DEVICES_STORAGE_KEY,
	ACTIVE_PARENT_SERIAL_STORAGE_KEY,
	PIN_MODE_STORAGE_KEY,
	STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY,
	STANDALONE_STANDBY_CONFIG_STORAGE_KEY,
	readMemoryOrDefault,
	readMemoryOrInitialize,
	createBoardState,
	findParentDeviceByHost,
	findActiveParentDevice,
	warnIfCredentialsAreStored
};

export { companionState };
