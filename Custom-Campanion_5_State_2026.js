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
 *
 * Date Created:            July 10, 2026
 * Revised:                 July 24, 2026
 * Version:                 1.0.6
 *
 * Description:             Durable registration, tombstone, Paired Environment, and standby storage keys,
 *                          safe MemoryStorage reads, and basic Companion Device mode state.
 *
 * Documentation:           https://github.com/ctg-tme/Custom_Companion_2026/blob/main/docs/technical-reference.md
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro, Board Pro G2, Board Pro G3, Desk Pro, Desk, Desk Mini, Desk Pro G2
 *
 * Code Dependencies:       None
 *
 * AI Generation:           Percentage: 95% (estimated)
 *                          Model(s): OpenAI Codex (GPT-5 family)
 *                          Instruction File(s): AGENTS.md,
 *                          https://github.com/ctg-tme/Bobbys_Macro_AI_Agents/blob/main/AGENTS.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

const STANDALONE_PARENT_SERIAL = 'Standalone';
const PARENT_DEVICES_STORAGE_KEY = 'parentDevices';
const PENDING_DEREGISTRATIONS_STORAGE_KEY = 'pendingDeregistrations';
const ACTIVE_PARENT_SERIAL_STORAGE_KEY = 'activeParentSerial';
const PIN_MODE_STORAGE_KEY = 'pinMode';
const STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY = 'standaloneUiFeatureConfig';
const STANDALONE_PAIRED_ENVIRONMENT_CONFIG_STORAGE_KEY = 'standalonePairedEnvironmentConfig';
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

function createCompanionDeviceState(parentSerial, parentDevices, companionDeviceInformation) {
	parentSerial = normalizeActiveParentSerial(parentSerial);
	const activeParent = getActiveParentBySerial(parentSerial, parentDevices, companionDeviceInformation);

	return {
		activeParent: activeParent,
		mode: parentSerial === STANDALONE_PARENT_SERIAL ? 'Standalone' : 'Paired',
		lastKnownParentSerial: activeParent.serial,
		lastUpdated: new Date().toISOString()
	};
}

function getActiveParentBySerial(parentSerial, parentDevices, companionDeviceInformation) {
	if (normalizeActiveParentSerial(parentSerial) === STANDALONE_PARENT_SERIAL) {
		return companionDeviceInformation;
	}

	return parentDevices.find(device => device.serial === parentSerial) || {
		serial: parentSerial,
		name: parentSerial,
		host: '',
		username: '',
		password: ''
	};
}

function normalizeActiveParentSerial(parentSerial) {
	const normalizedSerial = String(parentSerial || '').trim();
	if (!normalizedSerial || normalizedSerial.toLowerCase() === STANDALONE_PARENT_SERIAL.toLowerCase()) {
		return STANDALONE_PARENT_SERIAL;
	}
	return normalizedSerial;
}

function findParentDeviceByHost(parentDevices, host) {
	return parentDevices.find(device => device.host === host) || null;
}

function findActiveParentDevice(companionDeviceState, parentDevices) {
	if (companionDeviceState.mode === 'Standalone') {
		return null;
	}

	return parentDevices.find(device => device.serial === companionDeviceState.activeParent.serial || device.host === companionDeviceState.activeParent.host) || null;
}

function warnIfCredentialsAreStored(parentDevices, log) {
	const credentialCount = parentDevices.filter(device => device.username || device.password).length;

	if (credentialCount > 0) {
		log.warn({
			Context: 'Stored Parent Room Device credentials are present in MemoryStorage. This is required for autonomous device-to-device communication, but macro/storage access can expose these credentials.',
			CredentialSetCount: credentialCount
		});
	}
}

const companionState = {
	STANDALONE_PARENT_SERIAL,
	PARENT_DEVICES_STORAGE_KEY,
	PENDING_DEREGISTRATIONS_STORAGE_KEY,
	ACTIVE_PARENT_SERIAL_STORAGE_KEY,
	PIN_MODE_STORAGE_KEY,
	STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY,
	STANDALONE_PAIRED_ENVIRONMENT_CONFIG_STORAGE_KEY,
	STANDALONE_STANDBY_CONFIG_STORAGE_KEY,
	readMemoryOrDefault,
	readMemoryOrInitialize,
	createCompanionDeviceState,
	normalizeActiveParentSerial,
	findParentDeviceByHost,
	findActiveParentDevice,
	warnIfCredentialsAreStored
};

export { companionState };
