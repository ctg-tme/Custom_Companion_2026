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
 * Revised:                 July 28, 2026
 * Version:                 0.1.2.63
 *
 * Description:             Inactive Parent Room entry source for registration, pairing-state
 *                          validation, Registered Companion Devices UI and alerts,
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
const COMPANION_DEVICE_PAIRING_STATES_STORAGE_KEY = 'companionPairingStates';
const MAX_REGISTERED_COMPANION_DEVICES = 3;
const REGISTERED_COMPANION_DEVICES_PANEL_ID = 'cc26_registered_companions';
const REGISTERED_COMPANION_DEVICES_PAGE_ID = `${REGISTERED_COMPANION_DEVICES_PANEL_ID}~Status`;
const REGISTERED_COMPANION_DEVICES_ICON_URL = 'https://ctg-tme.github.io/Custom_Companion_2026/icons/custom-companion-512.png';
const PAIRING_VALIDATION_ATTEMPT_COUNT = 3;
const PAIRING_VALIDATION_RESPONSE_DELAY_MS = 2000;
const PAIRING_ALERT_DURATION_SECONDS = 10;
const HTTP_TRANSPORT_CONFIG = {
	maxConcurrentRequests: 3
};
const STANDBY_SYNC_DEBOUNCE_MS = 250;

const mem = new MemoryStorage(xapi, { StorageMacroName: STORAGE_MACRO_NAME });

let registeredCompanionDevices = [];
let companionDeviceConfigs = {};
let companionDevicePairingStates = {};
let companionDeviceReachability = {};
let standbySyncTimeout = null;
let lastStandbyState = '';
let pendingRegistrationValidation = null;
let isStartupValidationCollecting = false;
let startupAlertCandidates = createStartupAlertCandidates();
let downloadedPanelIconId = '';
let pendingPanelIconDownload = null;

const parentCallCoordinationController = parentCallCoordination.create({
	xapi: xapi,
	log: log,
	utils: utils,
	deviceComms: deviceComms,
	sendRegistrationResponse: sendRegistrationResponse,
	normalizeCompanionDeviceRecord: normalizeCompanionDeviceRecord
});

async function init() {
	try {
		await validateLocalHttpClientPrerequisites();
		deviceComms.initializeHttpTransport(HTTP_TRANSPORT_CONFIG);

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
		companionDevicePairingStates = await readMemoryOrDefault(COMPANION_DEVICE_PAIRING_STATES_STORAGE_KEY, {});
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

async function validateLocalHttpClientPrerequisites() {
	try {
		const posture = await deviceComms.validateHttpClientPrerequisites(xapi);
		log.info({
			Message: 'RoomOS HTTPClient Trust Posture observed',
			Mode: posture.mode,
			TrustPosture: posture.trustPosture
		});
	} catch (error) {
		const isModeFailure = error && error.code === 'CC26-HTTPCLIENT-MODE';
		utils.hardError({
			Code: isModeFailure ? 'CC26-INIT-HTTPCLIENT-MODE' : 'CC26-INIT-HTTPCLIENT-TRUST-POSTURE',
			Component: 'RoomReference',
			Context: isModeFailure
				? 'RoomOS HTTPClient Mode is unavailable or disabled.'
				: 'RoomOS HTTPClient Trust Posture is unavailable.',
			Remediation: isModeFailure
				? 'A Device Administrator must set xConfiguration HttpClient Mode: On and restart the Macro Runtime.'
				: 'A Device Administrator must verify xConfiguration HttpClient AllowInsecureHTTPS is readable and restart the Macro Runtime.',
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
		await handleRegistrationValidated(message);
		return;
	}

	if (message.Action === 'PairingStatus') {
		await handlePairingStatus(message);
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
	await applyAuthoritativePairingState(companionDeviceRecord, message.Payload && message.Payload.PairingState, {
		suppressAlert: true,
		skipPanelRender: true
	});
	await sendRegistrationResponse('ConfigAccepted', message, companionDeviceRecord, withTransaction(message, {
		MaxBoards: MAX_REGISTERED_COMPANION_DEVICES,
		RegisteredBoardCount: registeredCompanionDevices.length
	}), true);
	await renderRegisteredCompanionDevicesPanel();
	log.info({ Message: 'Companion Device configuration synced', Serial: companionDeviceRecord.Serial, Name: companionDeviceRecord.Name, RegisteredCompanionDeviceCount: registeredCompanionDevices.length });
}

async function validateRegisteredCompanionDevices() {
	isStartupValidationCollecting = true;
	startupAlertCandidates = createStartupAlertCandidates();

	for (let index = 0; index < registeredCompanionDevices.length; index++) {
		const companionDeviceRecord = registeredCompanionDevices[index];
		const isValidated = await validateRegisteredCompanionDevice(companionDeviceRecord);
		if (!isValidated) {
			companionDeviceReachability[companionDeviceRecord.Serial] = 'Offline';
			addStartupAlertCandidate('Offline', companionDeviceRecord);
		}
	}

	isStartupValidationCollecting = false;
	await renderRegisteredCompanionDevicesPanel();
	await showStartupPairingAlert();
}

async function validateRegisteredCompanionDevice(companionDeviceRecord) {
	for (let attempt = 1; attempt <= PAIRING_VALIDATION_ATTEMPT_COUNT; attempt++) {
		const transactionId = createTransactionId('validation', companionDeviceRecord.Serial);
		const validationWaiter = createRegistrationValidationWaiter(companionDeviceRecord.Serial, transactionId);
		const wasSent = await sendRegistrationResponse('RegistrationValidation', { MessageId: '' }, companionDeviceRecord, {
			TransactionId: transactionId,
			Status: 'ValidationRequested',
			Attempt: attempt,
			AttemptCount: PAIRING_VALIDATION_ATTEMPT_COUNT
		}, true);

		if (wasSent) {
			startRegistrationValidationResponseDelay(validationWaiter);
			const response = await validationWaiter.promise;
			if (response) {
				return true;
			}
		} else {
			cancelPendingRegistrationValidation(companionDeviceRecord.Serial, transactionId);
			if (attempt < PAIRING_VALIDATION_ATTEMPT_COUNT) {
				await delay(PAIRING_VALIDATION_RESPONSE_DELAY_MS);
			}
		}

		log.debug({
			Message: 'Companion Device registration validation attempt did not return an authoritative response',
			Serial: companionDeviceRecord.Serial,
			Attempt: attempt,
			AttemptCount: PAIRING_VALIDATION_ATTEMPT_COUNT
		});
	}

	return false;
}

function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function createRegistrationValidationWaiter(serial, transactionId) {
	cancelPendingRegistrationValidation();

	const validation = {
		serial: serial,
		transactionId: transactionId,
		resolve: null,
		timeout: null,
		promise: null
	};
	validation.promise = new Promise(resolve => {
		validation.resolve = resolve;
	});
	pendingRegistrationValidation = validation;
	return validation;
}

function startRegistrationValidationResponseDelay(validation) {
	if (pendingRegistrationValidation !== validation || validation.timeout) {
		return;
	}
	validation.timeout = setTimeout(() => {
		if (pendingRegistrationValidation === validation) {
			pendingRegistrationValidation = null;
		}
		validation.resolve(null);
	}, PAIRING_VALIDATION_RESPONSE_DELAY_MS);
}

function cancelPendingRegistrationValidation(serial, transactionId) {
	if (!pendingRegistrationValidation) {
		return;
	}
	if (serial && pendingRegistrationValidation.serial !== serial) {
		return;
	}
	if (transactionId && pendingRegistrationValidation.transactionId !== transactionId) {
		return;
	}

	const validation = pendingRegistrationValidation;
	pendingRegistrationValidation = null;
	if (validation.timeout) {
		clearTimeout(validation.timeout);
	}
	validation.resolve(null);
}

async function handleRegistrationValidated(message) {
	const companionDeviceRecord = registeredCompanionDevices.find(companionDevice => companionDevice.Serial === message.Serial);
	if (!companionDeviceRecord) {
		return;
	}

	const pairingState = message.Payload && message.Payload.PairingState;
	const wasApplied = await applyAuthoritativePairingState(companionDeviceRecord, pairingState);
	if (!wasApplied) {
		log.warn({ Message: 'Companion Device registration validation omitted a valid pairing state', Serial: message.Serial, TransactionId: getTransactionId(message), PairingState: pairingState });
		return;
	}

	const validation = pendingRegistrationValidation;
	if (validation && validation.serial === message.Serial) {
		pendingRegistrationValidation = null;
		if (validation.timeout) {
			clearTimeout(validation.timeout);
		}
		validation.resolve(message);
	}

	log.info({
		Message: 'Companion Device confirmed Parent Room Registration',
		Serial: message.Serial,
		TransactionId: getTransactionId(message),
		PairingState: normalizePairingState(pairingState)
	});
}

async function handlePairingStatus(message) {
	const companionDeviceRecord = registeredCompanionDevices.find(companionDevice => companionDevice.Serial === message.Serial);
	if (!companionDeviceRecord) {
		return;
	}

	const pairingState = message.Payload && message.Payload.PairingState;
	const wasApplied = await applyAuthoritativePairingState(companionDeviceRecord, pairingState);
	if (!wasApplied) {
		log.warn({ Message: 'Ignored Companion Device pairing status with an invalid state', Serial: message.Serial, PairingState: pairingState });
		return;
	}

	log.debug({
		Message: 'Companion Device authoritative pairing status received',
		Serial: message.Serial,
		PairingState: normalizePairingState(pairingState),
		Reason: message.Payload && message.Payload.Reason || ''
	});
}

async function applyAuthoritativePairingState(companionDeviceRecord, value, options = {}) {
	const pairingState = normalizePairingState(value);
	if (!pairingState) {
		return false;
	}

	const serial = companionDeviceRecord.Serial;
	const previousPairingState = normalizePairingState(companionDevicePairingStates[serial] && companionDevicePairingStates[serial].State);
	const didPairingStateChange = !!previousPairingState && previousPairingState !== pairingState;
	companionDeviceReachability[serial] = 'Online';
	removeStartupAlertCandidate(serial);

	if (previousPairingState !== pairingState) {
		companionDevicePairingStates[serial] = {
			State: pairingState,
			UpdatedAt: new Date().toISOString()
		};
		await mem.write(COMPANION_DEVICE_PAIRING_STATES_STORAGE_KEY, companionDevicePairingStates);
	}

	if (didPairingStateChange) {
		if (isStartupValidationCollecting) {
			addStartupAlertCandidate(pairingState, companionDeviceRecord);
		} else if (!options.suppressAlert) {
			await showPairingAlert(pairingState, [companionDeviceRecord]);
		}
	}

	if (!isStartupValidationCollecting && !options.skipPanelRender) {
		await renderRegisteredCompanionDevicesPanel();
	}

	return true;
}

function normalizePairingState(value) {
	if (value === 'Paired') {
		return 'Paired';
	}
	if (value === 'NotPaired') {
		return 'NotPaired';
	}
	return '';
}

function createStartupAlertCandidates() {
	return {
		Paired: [],
		NotPaired: [],
		Offline: []
	};
}

function addStartupAlertCandidate(state, companionDeviceRecord) {
	removeStartupAlertCandidate(companionDeviceRecord.Serial);
	if (!startupAlertCandidates[state]) {
		return;
	}
	startupAlertCandidates[state].push(companionDeviceRecord);
}

function removeStartupAlertCandidate(serial) {
	const states = Object.keys(startupAlertCandidates);
	for (let index = 0; index < states.length; index++) {
		startupAlertCandidates[states[index]] = startupAlertCandidates[states[index]].filter(companionDevice => companionDevice.Serial !== serial);
	}
}

async function showStartupPairingAlert() {
	const priority = ['Paired', 'NotPaired', 'Offline'];
	for (let index = 0; index < priority.length; index++) {
		const state = priority[index];
		if (startupAlertCandidates[state].length > 0) {
			await showPairingAlert(state, startupAlertCandidates[state]);
			return;
		}
	}
}

async function showPairingAlert(state, companionDevices) {
	const names = companionDevices.map(companionDevice => companionDevice.Name || companionDevice.Serial || 'Companion Device');
	const subject = formatDeviceNames(names);
	const plural = names.length > 1;
	let title = '';
	let text = '';

	if (state === 'Paired') {
		title = 'Companion Device Paired';
		text = `${subject} ${plural ? 'are' : 'is'} paired to this room and ready`;
	} else if (state === 'NotPaired') {
		title = 'Companion Device Unpaired';
		text = `${subject} ${plural ? 'are' : 'is'} no longer paired to this room`;
	} else if (state === 'Offline') {
		title = 'Companion Device Offline';
		text = `${subject} ${plural ? 'are' : 'is'} offline`;
	} else {
		return;
	}

	try {
		await xapi.Command.UserInterface.Message.Alert.Display({
			Title: title,
			Text: text,
			Duration: PAIRING_ALERT_DURATION_SECONDS
		});
	} catch (error) {
		log.warn({ Message: 'Failed to display Parent Room Companion Device status alert', Title: title, Text: text, Error: error.code || error.message || 'Unknown Alert.Display error' });
	}
}

function formatDeviceNames(names) {
	if (names.length < 2) {
		return names[0] || 'Companion Device';
	}
	if (names.length === 2) {
		return `${names[0]} and ${names[1]}`;
	}
	return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

async function renderRegisteredCompanionDevicesPanel() {
	try {
		await xapi.Command.UserInterface.Extensions.Panel.Save({
			PanelId: REGISTERED_COMPANION_DEVICES_PANEL_ID
		}, buildRegisteredCompanionDevicesPanelXml());
		await applyRegisteredCompanionDevicesPanelIcon();
	} catch (error) {
		log.warn({
			Message: 'Failed to render Registered Companion Devices Control Panel',
			Error: error.code || error.message || 'Unknown UserInterface Extensions error',
			ErrorContext: error.Context || {}
		});
	}
}

function buildRegisteredCompanionDevicesPanelXml() {
	return `<Extensions>
	<Version>1.11</Version>
	<Panel>
		<Order>4</Order>
		<PanelId>${REGISTERED_COMPANION_DEVICES_PANEL_ID}</PanelId>
		<Origin>local</Origin>
		<Location>ControlPanel</Location>
		<Icon>Input</Icon>
		<Color>#875AE0</Color>
		<Name>Registered Companion Devices</Name>
		<ActivityType>Custom</ActivityType>
		<Page>
			<Name>Registered Companion Devices</Name>
			<Row>
				<Name>About this panel</Name>
				<Widget>
					<WidgetId>${REGISTERED_COMPANION_DEVICES_PAGE_ID}~About</WidgetId>
					<Name>Shows whether each registered Companion Device is paired with this Parent Room Device. Offline means its current status could not be confirmed.</Name>
					<Type>Text</Type>
					<Options>size=4;fontSize=normal;align=left</Options>
				</Widget>
			</Row>
			${buildRegisteredCompanionDeviceRowsXml()}
			<PageId>${REGISTERED_COMPANION_DEVICES_PAGE_ID}</PageId>
			<Options/>
		</Page>
	</Panel>
</Extensions>`;
}

function buildRegisteredCompanionDeviceRowsXml() {
	if (registeredCompanionDevices.length < 1) {
		return `<Row>
				<Name>Registration Status</Name>
				<Widget>
					<WidgetId>${REGISTERED_COMPANION_DEVICES_PAGE_ID}~Empty</WidgetId>
					<Name>No Companion Devices Registered</Name>
					<Type>Text</Type>
					<Options>size=4;fontSize=normal;align=left</Options>
				</Widget>
			</Row>`;
	}

	return registeredCompanionDevices.map((companionDevice, index) => {
		const serial = String(companionDevice.Serial || index + 1).replace(/[^A-Za-z0-9_-]/g, '');
		return `<Row>
				<Name>${escapeXml(companionDevice.Name || companionDevice.Serial || `Companion Device ${index + 1}`)}</Name>
				<Widget>
					<WidgetId>${REGISTERED_COMPANION_DEVICES_PAGE_ID}~Device~${serial}</WidgetId>
					<Name>${getCompanionDevicePanelState(companionDevice)}</Name>
					<Type>Text</Type>
					<Options>size=4;fontSize=normal;align=left</Options>
				</Widget>
			</Row>`;
	}).join('');
}

function getCompanionDevicePanelState(companionDevice) {
	if (companionDeviceReachability[companionDevice.Serial] === 'Offline') {
		return 'Offline';
	}
	return normalizePairingState(companionDevicePairingStates[companionDevice.Serial] && companionDevicePairingStates[companionDevice.Serial].State) === 'Paired'
		? 'Paired'
		: 'Not paired';
}

async function applyRegisteredCompanionDevicesPanelIcon() {
	if (!downloadedPanelIconId) {
		if (!pendingPanelIconDownload) {
			pendingPanelIconDownload = xapi.Command.UserInterface.Extensions.Icon.Download({
				Url: REGISTERED_COMPANION_DEVICES_ICON_URL
			});
		}
		try {
			const response = await pendingPanelIconDownload;
			downloadedPanelIconId = String(response && (response.IconId || response.Id) || '');
			if (!downloadedPanelIconId) {
				throw new Error('Icon download response did not contain an IconId');
			}
		} finally {
			pendingPanelIconDownload = null;
		}
	}

	await xapi.Command.UserInterface.Extensions.Panel.Update({
		Icon: 'Custom',
		IconId: downloadedPanelIconId,
		PanelId: REGISTERED_COMPANION_DEVICES_PANEL_ID
	});
}

async function handleDeregisterRequest(message) {
	const companionDeviceRecord = normalizeCompanionDeviceRecord(message);
	const peripheralId = String(message.Payload && message.Payload.PeripheralId || companionDeviceRecord.MacAddress || companionDeviceRecord.Serial || '');

	await purgeCompanionDevicePeripheral(peripheralId);
	registeredCompanionDevices = registeredCompanionDevices.filter(companionDevice => companionDevice.Serial !== companionDeviceRecord.Serial);
	delete companionDeviceConfigs[companionDeviceRecord.Serial];
	delete companionDevicePairingStates[companionDeviceRecord.Serial];
	delete companionDeviceReachability[companionDeviceRecord.Serial];
	await mem.write(COMPANION_DEVICE_CONFIGS_STORAGE_KEY, companionDeviceConfigs);
	await mem.write(COMPANION_DEVICE_PAIRING_STATES_STORAGE_KEY, companionDevicePairingStates);
	await mem.write(REGISTERED_COMPANION_DEVICES_STORAGE_KEY, registeredCompanionDevices);
	parentCallCoordinationController.setRegisteredCompanionDevices(registeredCompanionDevices);

	await sendRegistrationResponse('DeregistrationAccepted', message, companionDeviceRecord, withTransaction(message, {
		Status: 'Deregistered',
		PeripheralId: peripheralId
	}), true);
	await renderRegisteredCompanionDevicesPanel();
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
		});
		return true;
	} catch (error) {
		if (action === 'ConfigAccepted' || action === 'ConfigDenied') {
			await xapi.Command.UserInterface.Message.Prompt.Display({
				Title: 'Companion Device Registration Error',
				Text: `${isAccepted ? 'Accepted' : 'Denied'} ${companionDeviceRecord.Name}, but response failed. Check Companion Device credentials.`,
				Duration: 10
			});
		}
		log.warn({ Message: 'Failed to send registration response to Companion Device', Action: action, Serial: companionDeviceRecord.Serial, Error: error.code || error.message || 'Unknown response error', ErrorContext: error.Context || {} });
		return false;
	}
}

function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
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
