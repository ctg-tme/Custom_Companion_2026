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
 * Revised:                 July 10, 2026
 * Version:                 1.0.1
 *
 * Description:             State and MemoryStorage helpers for the Custom Companion Solution.
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

async function refreshParentDeviceIdentities(options) {
	const refreshedStatus = [];
	const updatedDevices = [];
	let hasParentDeviceUpdates = false;
	const statusLog = options.isInterval ? options.log.debug.bind(options.log) : options.log.info.bind(options.log);
	const errorLog = options.isInterval ? options.log.debug.bind(options.log) : options.log.warn.bind(options.log);

	for (let index = 0; index < options.parentDevices.length; index++) {
		const device = options.parentDevices[index];

		try {
			const refreshedDevice = await options.deviceComms.parentInitializationRequest(options.xapi, device, options.httpClientConfig);
			if (device.serial && refreshedDevice.serial !== device.serial) {
				const mismatchError = new Error('Parent identity serial changed for an existing parent record');
				mismatchError.code = 'CC26-PARENT-IDENTITY-MISMATCH';
				throw mismatchError;
			}
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
			errorLog({ Message: 'Parent device identity refresh failed', Host: device.host, Error: error.code || error.message || 'Unknown parent refresh error', ErrorContext: error.Context || {} });
		}
	}

	if (hasParentDeviceUpdates) {
		await options.mem.write(PARENT_DEVICES_STORAGE_KEY, updatedDevices);
		options.log.info({ Message: 'Persisted refreshed parent device identity fields', UpdatedDeviceCount: updatedDevices.length });
	}

	return {
		parentDevices: hasParentDeviceUpdates ? updatedDevices : options.parentDevices,
		parentDeviceStatus: refreshedStatus
	};
}

async function refreshParentStatusWithRetries(options) {
	let latestStatus = null;
	let parentDeviceStatus = (options.parentDeviceStatus || []).slice();
	let parentDevices = (options.parentDevices || []).slice();
	const retryDelayMs = Number(options.retryDelayMs) || 0;

	for (let attempt = 1; attempt <= options.retryCount; attempt++) {
		if (options.isCanceled && options.isCanceled()) {
			return { parentDevices, parentDeviceStatus, parentStatus: latestStatus, canceled: true, attempt: attempt };
		}

		if (options.onAttempt) {
			await options.onAttempt(attempt, options.retryCount);
		}

		try {
			const refreshedDevice = await options.deviceComms.parentInitializationRequest(options.xapi, options.parentDevice, options.httpClientConfig);
			if (options.expectedSerial && refreshedDevice.serial !== options.expectedSerial) {
				const mismatchError = new Error('Parent identity serial did not match the selected parent');
				mismatchError.code = 'CC26-PARENT-IDENTITY-MISMATCH';
				throw mismatchError;
			}

			if (options.isCanceled && options.isCanceled()) {
				return { parentDevices, parentDeviceStatus, parentStatus: latestStatus, canceled: true, attempt: attempt };
			}

			const parentIndex = parentDevices.findIndex(device => device.host === options.parentDevice.host || device.serial === options.parentDevice.serial);
			const updatedDevice = {
				serial: refreshedDevice.serial,
				name: refreshedDevice.name,
				host: options.parentDevice.host,
				username: options.parentDevice.username,
				password: options.parentDevice.password
			};
			if (parentIndex >= 0) {
				const existingDevice = parentDevices[parentIndex];
				parentDevices[parentIndex] = updatedDevice;
				if (existingDevice.serial !== updatedDevice.serial || existingDevice.name !== updatedDevice.name) {
					await options.mem.write(PARENT_DEVICES_STORAGE_KEY, parentDevices);
				}
			}

			latestStatus = {
				host: updatedDevice.host,
				serial: updatedDevice.serial,
				name: updatedDevice.name,
				online: true,
				lastHeartbeat: new Date().toISOString(),
				lastError: ''
			};
			parentDeviceStatus = replaceParentStatus(parentDeviceStatus, latestStatus, options.parentDevice);

			return { parentDevices, parentDeviceStatus, parentStatus: latestStatus, canceled: false, attempt: attempt };
		} catch (error) {
			latestStatus = {
				host: options.parentDevice.host,
				serial: options.parentDevice.serial,
				name: options.parentDevice.name,
				online: false,
				lastError: error.code || error.message || 'Unknown parent refresh error',
				lastHeartbeat: ''
			};
			parentDeviceStatus = replaceParentStatus(parentDeviceStatus, latestStatus, options.parentDevice);
			options.log.debug({
				Message: 'Parent connection attempt failed',
				Host: options.parentDevice.host,
				Attempt: attempt,
				AttemptCount: options.retryCount,
				Error: latestStatus.lastError,
				ErrorContext: error.Context || {}
			});
		}

		if (attempt < options.retryCount && retryDelayMs > 0) {
			await delay(retryDelayMs);
		}
	}

	return {
		parentDevices,
		parentDeviceStatus,
		parentStatus: latestStatus || {
			host: options.parentDevice.host,
			serial: options.parentDevice.serial,
			name: options.parentDevice.name,
			online: false,
			lastError: 'Parent offline after retry',
			lastHeartbeat: ''
		},
		canceled: false,
		attempt: options.retryCount
	};
}

function replaceParentStatus(parentDeviceStatus, replacementStatus, parentDevice) {
	const updatedStatus = parentDeviceStatus.slice();
	const statusIndex = updatedStatus.findIndex(status => status.host === parentDevice.host || status.serial === parentDevice.serial);
	if (statusIndex >= 0) {
		updatedStatus[statusIndex] = replacementStatus;
	} else {
		updatedStatus.push(replacementStatus);
	}
	return updatedStatus;
}

function delay(milliseconds) {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
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
	STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY,
	STANDALONE_STANDBY_CONFIG_STORAGE_KEY,
	readMemoryOrDefault,
	readMemoryOrInitialize,
	refreshParentDeviceIdentities,
	refreshParentStatusWithRetries,
	createBoardState,
	findParentDeviceByHost,
	findActiveParentDevice,
	warnIfCredentialsAreStored
};

export { companionState };
