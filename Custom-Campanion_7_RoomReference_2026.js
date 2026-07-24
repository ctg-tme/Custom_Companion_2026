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
 * Date Created:            July 09, 2026
 * Revised:                 July 24, 2026
 * Version:                 0.1.2.49
 *
 * Description:             Inactive Parent Room entry source for registration, validation,
 *                          deregistration, peripheral cleanup, and controller coordination.
 *                          Parent Room installation renames and activates it as
 *                          Custom-Campanion_Room_2026.
 *
 * Documentation:           https://github.com/ctg-tme/Custom_Companion_2026/blob/main/docs/technical-reference.md
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Compatible RoomOS Parent Room Devices
 *
 * Code Dependencies:       Memory-Storage-Functions-V2, Custom-Campanion_3_Utils_2026,
 *                          Custom-Campanion_6_DeviceComms_2026,
 *                          Custom-Campanion_12_ParentCallCoordination_2026
 *
 * AI Generation:           Percentage: 95% (estimated)
 *                          Model(s): OpenAI Codex (GPT-5 family)
 *                          Instruction File(s): AGENTS.md,
 *                          https://github.com/ctg-tme/Bobbys_Macro_AI_Agents/blob/main/AGENTS.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

import xapi from 'xapi';
import { MemoryStorage } from './Memory-Storage-Functions-V2';
import { utils } from './Custom-Campanion_3_Utils_2026';
import { deviceComms } from './Custom-Campanion_6_DeviceComms_2026';
import { parentCallCoordination } from './Custom-Campanion_12_ParentCallCoordination_2026';

const log = new utils.Logger('Custom-Campanion_RoomReference');

const STORAGE_MACRO_NAME = 'Custom-Campanion';
const REGISTERED_COMPANION_DEVICES_STORAGE_KEY = 'registeredBoards';
const COMPANION_DEVICE_CONFIGS_STORAGE_KEY = 'boardConfigs';
const MAX_REGISTERED_COMPANION_DEVICES = 3;
const HTTP_CLIENT_CONFIG = {
	mode: 'On',
	allowInsecureHTTPS: true,
	maxConcurrentRequests: 3
};
const STANDBY_SYNC_DEBOUNCE_MS = 250;

const mem = new MemoryStorage(xapi, { StorageMacroName: STORAGE_MACRO_NAME });

let registeredCompanionDevices = [];
let companionDeviceConfigs = {};
let standbySyncTimeout = null;
let lastStandbyState = '';

const parentCallCoordinationController = parentCallCoordination.create({
	xapi: xapi,
	log: log,
	utils: utils,
	deviceComms: deviceComms,
	httpClientConfig: HTTP_CLIENT_CONFIG,
	sendRegistrationResponse: sendRegistrationResponse,
	normalizeCompanionDeviceRecord: normalizeCompanionDeviceRecord
});

async function init() {
	try {
		try {
			await deviceComms.initializeHttpClient(xapi, HTTP_CLIENT_CONFIG);
		} catch (error) {
			utils.hardError({
				Code: 'CC26-INIT-HTTPCLIENT',
				Component: 'RoomReference',
				Context: 'Failed to initialize RoomOS HTTPClient',
				Remediation: 'Correct the HTTPClient configuration or macro permissions, then restart the Macro Runtime.',
				Error: error
			});
		}

		try {
			await mem.init();
		} catch (error) {
			utils.hardError({
				Code: 'CC26-INIT-MEMORY',
				Component: 'RoomReference',
				Context: 'Failed to initialize Memory-Storage-Functions-V2',
				Remediation: 'Verify the Memory-Storage-Functions-V2 dependency and storage macro, then restart the Macro Runtime.',
				Error: error
			});
		}

		registeredCompanionDevices = await readMemoryOrDefault(REGISTERED_COMPANION_DEVICES_STORAGE_KEY, []);
		companionDeviceConfigs = await readMemoryOrDefault(COMPANION_DEVICE_CONFIGS_STORAGE_KEY, {});
		parentCallCoordinationController.setRegisteredCompanionDevices(registeredCompanionDevices);
			registerMessageHandler();
			registerStandbyStateHandler();
			await parentCallCoordinationController.start();
			await validateRegisteredCompanionDevices();
		log.info({ Message: 'Custom Companion initialized on Parent Room Device', RegisteredCompanionDeviceCount: registeredCompanionDevices.length });
	} catch (error) {
		const diagnostic = error.Diagnostic || {};
		log.error({
			Message: 'Custom Companion initialization stopped on Parent Room Device',
			Code: diagnostic.Code || error.code || 'CC26-INIT-UNKNOWN',
			Component: diagnostic.Component || 'RoomReference',
			Context: diagnostic.Context || 'Unhandled initialization failure',
			Remediation: diagnostic.Remediation || 'Diagnose the logged xAPI failure, then restart the Macro Runtime.',
			Error: error
		});
	}
}

async function readMemoryOrDefault(key, defaultValue) {
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

function registerMessageHandler() {
	xapi.Event.Message.Send.on(event => {
		const message = deviceComms.parseCompanionMessage(event.Text);
		if (!message) {
			return;
		}

		handleCompanionMessage(message).catch(error => {
			utils.softError({ Context: 'Failed to handle companion message', Action: message.Action, Error: error });
		});
	});
}

function registerStandbyStateHandler() {
	xapi.Status.Standby.State.on(state => {
		queueStandbySync(normalizeEventValue(state));
	});
}

function queueStandbySync(state) {
	lastStandbyState = state;

	if (standbySyncTimeout) {
		clearTimeout(standbySyncTimeout);
	}

	standbySyncTimeout = setTimeout(() => {
		standbySyncTimeout = null;
		sendStandbySync(lastStandbyState).catch(error => {
			utils.softError({ Context: 'Failed to send standby sync', State: lastStandbyState, Error: error });
		});
	}, STANDBY_SYNC_DEBOUNCE_MS);
}

async function sendStandbySync(state) {
	const syncRequests = [];
	for (let index = 0; index < registeredCompanionDevices.length; index++) {
		syncRequests.push(sendRegistrationResponse('StandbySync', { MessageId: '' }, registeredCompanionDevices[index], { State: state }, true));
	}
	await Promise.all(syncRequests);

	log.debug({ Message: 'Parent Room Device standby sync sent', State: state, RegisteredCompanionDeviceCount: registeredCompanionDevices.length });
}

function normalizeEventValue(value) {
	if (value && typeof value === 'object' && value.Value !== undefined) {
		return value.Value;
	}

	return value;
}

async function handleCompanionMessage(message) {
	if (message.Action === 'DeregisterRequest') {
		await handleDeregisterRequest(message);
		return;
	}

	if (message.Action === 'ParentReadyRequest') {
		await handleParentReadyRequest(message);
		return;
	}

	if (message.Action === 'ConfigSync') {
		await handleConfigSync(message);
		return;
	}

	if (!isRegisteredCompanionDevice(message.Serial)) {
		await sendConfigRequired(message);
		return;
	}

	if (message.Action === 'RegistrationValidated') {
		log.info({ Message: 'Companion Device confirmed Parent Room Registration', Serial: message.Serial, TransactionId: getTransactionId(message) });
		return;
	}

	if (message.Action === 'ActiveCallDetailsRequest') {
		await parentCallCoordinationController.handleActiveCallDetailsRequest(message);
		return;
	}

	if (message.Action === 'MeetingPasswordRequest') {
		await parentCallCoordinationController.handleMeetingPasswordRequest(message);
		return;
	}

	log.debug({ Message: 'Companion message received', Action: message.Action, Serial: message.Serial });
}

async function handleParentReadyRequest(message) {
	const companionDeviceRecord = normalizeCompanionDeviceRecord(message);
	await sendRegistrationResponse('ParentReady', message, companionDeviceRecord, withTransaction(message, { Status: 'Ready' }), true);
}

async function handleConfigSync(message) {
	const companionDeviceRecord = normalizeCompanionDeviceRecord(message);
	const syncedConfig = message.Payload && message.Payload.Config ? message.Payload.Config : {};
	const existingIndex = registeredCompanionDevices.findIndex(companionDevice => companionDevice.Serial === companionDeviceRecord.Serial);

	if (existingIndex === -1 && registeredCompanionDevices.length >= MAX_REGISTERED_COMPANION_DEVICES) {
		await sendRegistrationResponse('ConfigDenied', message, companionDeviceRecord, withTransaction(message, {
			Reason: 'MaxBoardsReached',
			MaxBoards: MAX_REGISTERED_COMPANION_DEVICES,
			RegisteredBoardCount: registeredCompanionDevices.length
		}), false);
		return;
	}

	if (existingIndex >= 0) {
		registeredCompanionDevices[existingIndex] = companionDeviceRecord;
	} else {
		registeredCompanionDevices.push(companionDeviceRecord);
	}
	parentCallCoordinationController.setRegisteredCompanionDevices(registeredCompanionDevices);

	companionDeviceConfigs[companionDeviceRecord.Serial] = syncedConfig;
	await mem.write(REGISTERED_COMPANION_DEVICES_STORAGE_KEY, registeredCompanionDevices);
	await mem.write(COMPANION_DEVICE_CONFIGS_STORAGE_KEY, companionDeviceConfigs);
	await applySyncedConfig(syncedConfig);
	await sendRegistrationResponse('ConfigAccepted', message, companionDeviceRecord, withTransaction(message, {
		MaxBoards: MAX_REGISTERED_COMPANION_DEVICES,
		RegisteredBoardCount: registeredCompanionDevices.length
	}), true);
	log.info({ Message: 'Companion Device configuration synced', Serial: companionDeviceRecord.Serial, Name: companionDeviceRecord.Name, RegisteredCompanionDeviceCount: registeredCompanionDevices.length });
}

async function applySyncedConfig(syncedConfig) {
	if (syncedConfig && syncedConfig.httpClient) {
		await deviceComms.initializeHttpClient(xapi, {
			mode: 'On',
			allowInsecureHTTPS: syncedConfig.httpClient.allowInsecureHTTPS,
			maxConcurrentRequests: 3
		});
	}
}

async function validateRegisteredCompanionDevices() {
	for (let index = 0; index < registeredCompanionDevices.length; index++) {
		const companionDeviceRecord = registeredCompanionDevices[index];
		await sendRegistrationResponse('RegistrationValidation', { MessageId: '' }, companionDeviceRecord, {
			TransactionId: createTransactionId('validation', companionDeviceRecord.Serial),
			Status: 'ValidationRequested'
		}, true);
	}
}

async function handleDeregisterRequest(message) {
	const companionDeviceRecord = normalizeCompanionDeviceRecord(message);
	const peripheralId = String(message.Payload && message.Payload.PeripheralId || companionDeviceRecord.MacAddress || companionDeviceRecord.Serial || '');

	await purgeCompanionDevicePeripheral(peripheralId);
	registeredCompanionDevices = registeredCompanionDevices.filter(companionDevice => companionDevice.Serial !== companionDeviceRecord.Serial);
	delete companionDeviceConfigs[companionDeviceRecord.Serial];
	await mem.write(COMPANION_DEVICE_CONFIGS_STORAGE_KEY, companionDeviceConfigs);
	await mem.write(REGISTERED_COMPANION_DEVICES_STORAGE_KEY, registeredCompanionDevices);
	parentCallCoordinationController.setRegisteredCompanionDevices(registeredCompanionDevices);

	await sendRegistrationResponse('DeregistrationAccepted', message, companionDeviceRecord, withTransaction(message, {
		Status: 'Deregistered',
		PeripheralId: peripheralId
	}), true);
	log.info({ Message: 'Companion Device deregistered from Parent Room Device', Serial: companionDeviceRecord.Serial, PeripheralId: peripheralId, RegisteredCompanionDeviceCount: registeredCompanionDevices.length });
}

async function purgeCompanionDevicePeripheral(peripheralId) {
	if (!peripheralId || !await isPeripheralConnected(peripheralId)) {
		log.debug({ Message: 'Companion Device peripheral already absent', PeripheralId: peripheralId });
		return;
	}

	await xapi.Command.Peripherals.Purge({ ID: peripheralId });
	log.info({ Message: 'Companion Device peripheral purged', PeripheralId: peripheralId });
}

async function isPeripheralConnected(peripheralId) {
	try {
		const status = await xapi.Status.Peripherals.ConnectedDevice.get();
		const devices = normalizeStatusList(status);
		return devices.some(device => String(device.ID || device.Id || device.id || '') === peripheralId);
	} catch (error) {
		log.warn({ Message: 'Could not inspect connected peripherals before purge; attempting purge once', PeripheralId: peripheralId, Error: error.message || error.code || 'Unknown peripheral status error' });
		return true;
	}
}

function normalizeStatusList(status) {
	if (!status) {
		return [];
	}
	if (Array.isArray(status)) {
		return status;
	}
	if (Array.isArray(status.ConnectedDevice)) {
		return status.ConnectedDevice;
	}
	if (status.ID || status.Id || status.id) {
		return [status];
	}
	return Object.keys(status).map(key => status[key]).filter(value => value && typeof value === 'object');
}

function normalizeCompanionDeviceRecord(message) {
	const source = message.Source || {};
	const payload = message.Payload || {};
	const companionDevicePayload = payload.Board || {};
	const serial = companionDevicePayload.Serial || message.Serial;
	const existingCompanionDeviceRecord = registeredCompanionDevices.find(item => item.Serial === serial) || {};
	const now = new Date().toISOString();

	return {
		Serial: serial,
		Name: companionDevicePayload.Name || source.Name || message.Serial,
		Host: companionDevicePayload.Host || source.Host || existingCompanionDeviceRecord.Host || '',
		Username: companionDevicePayload.Username || existingCompanionDeviceRecord.Username || '',
		Password: companionDevicePayload.Password || existingCompanionDeviceRecord.Password || '',
		MacAddress: companionDevicePayload.MacAddress || source.MacAddress || '',
		ProductPlatform: companionDevicePayload.ProductPlatform || '',
		Capabilities: payload.Capabilities || {},
		RegisteredAt: getRegisteredAt(serial) || now,
		LastMessageAt: now
	};
}

function getRegisteredAt(serial) {
	const companionDevice = registeredCompanionDevices.find(item => item.Serial === serial);
	return companionDevice ? companionDevice.RegisteredAt : '';
}

function isRegisteredCompanionDevice(serial) {
	return registeredCompanionDevices.some(companionDevice => companionDevice.Serial === serial);
}

async function sendConfigRequired(message) {
	const companionDeviceRecord = normalizeCompanionDeviceRecord(message);
	await sendRegistrationResponse('ConfigRequired', message, companionDeviceRecord, withTransaction(message, { Reason: 'BoardConfigNotSynced' }), false);
}

function withTransaction(message, payload) {
	const response = payload || {};
	response.TransactionId = getTransactionId(message);
	return response;
}

function getTransactionId(message) {
	return String(message && message.Payload && message.Payload.TransactionId || '');
}

function createTransactionId(prefix, serial) {
	return `${prefix}:${serial}:${Date.now()}`;
}

async function sendRegistrationResponse(action, inboundMessage, companionDeviceRecord, payload, isAccepted) {
	const parentIdentity = await Promise.all([
		getParentSource(),
		getParentSerial()
	]);
	const parentSource = parentIdentity[0];
	const parentSerial = parentIdentity[1];
	const companionDevice = {
		host: companionDeviceRecord.Host,
		username: companionDeviceRecord.Username,
		password: companionDeviceRecord.Password
	};

	try {
		await deviceComms.sendMessageCommand(xapi, companionDevice, action, payload, {
			app: 'Companion Board 2026',
			serial: parentSerial,
			source: parentSource
		}, HTTP_CLIENT_CONFIG);
	} catch (error) {
		if (action === 'ConfigAccepted' || action === 'ConfigDenied') {
			await xapi.Command.UserInterface.Message.Prompt.Display({
				Title: 'Companion Device Registration Error',
				Text: `${isAccepted ? 'Accepted' : 'Denied'} ${companionDeviceRecord.Name}, but response failed. Check Companion Device credentials.`,
				Duration: 10
			});
		}
		log.warn({ Message: 'Failed to send registration response to Companion Device', Action: action, Serial: companionDeviceRecord.Serial, Error: error.code || error.message || 'Unknown response error', ErrorContext: error.Context || {} });
	}
}

async function getParentSource() {
	return {
		Role: 'Parent',
		Name: await getParentName(),
		Host: ''
	};
}

async function getParentSerial() {
	try {
		return await xapi.Status.SystemUnit.Hardware.Module.SerialNumber.get();
	} catch (error) {
		return '';
	}
}

async function getParentName() {
	try {
		return await xapi.Status.SystemUnit.BroadcastName.get();
	} catch (error) {
		return '';
	}
}

init();
