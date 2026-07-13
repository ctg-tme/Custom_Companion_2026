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
 * Revised:                 July 10, 2026
 * Version:                 0.1.1.18
 *
 * Description:             Main orchestrator for the Custom Companion Solution for Board Series endpoints with Wheel Kits.
 *
 * Documentation:           N/A
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro Series
 *
 * Code Dependencies:       Memory-Storage-Functions-V2, Custom-Campanion_2_Config_2026, Custom-Campanion_3_Utils_2026, Custom-Campanion_4_UI_2026, Custom-Campanion_5_State_2026, Custom-Campanion_6_DeviceComms_2026, Custom-Campanion_8_Services_2026, Custom-Companion-Memory-Storage
 *
 * AI Generation:           Percentage: 95%
 *                          Model(s): GPT-5.3-Codex
 *                          Instruction File(s): /Users/bomcgoni/.claude/rules/Bobby_McGonigles_Macro_Rule_Set_for_AI.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

import xapi from 'xapi';
import { MemoryStorage } from './Memory-Storage-Functions-V2';
import { config } from './Custom-Campanion_2_Config_2026';
import { utils } from './Custom-Campanion_3_Utils_2026';
import { companionUi } from './Custom-Campanion_4_UI_2026';
import { companionState } from './Custom-Campanion_5_State_2026';
import { deviceComms } from './Custom-Campanion_6_DeviceComms_2026';
import { boardServices } from './Custom-Campanion_8_Services_2026';

const log = new utils.Logger('Custom-Campanion_Board_Main');

const STORAGE_MACRO_NAME = 'Custom-Campanion';
const MAX_PARENT_DEVICES = 6;
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
		parentReadyRequest: 'ParentReadyRequest',
		configSync: 'ConfigSync',
		callState: 'parent.callState',
		joinCall: 'board.joinCall'
	}
};
const PARENT_INSTALL_CONFIG = {
	roomReferenceSourceMacroName: 'Custom-Campanion_7_RoomReference_2026',
	roomReferenceTargetMacroName: 'Custom-Campanion_Room_2026',
	utilsMacroName: 'Custom-Campanion_3_Utils_2026',
	deviceCommsMacroName: 'Custom-Campanion_6_DeviceComms_2026',
	memoryStorageMacroName: 'Memory-Storage-Functions-V2'
};

const mem = new MemoryStorage(xapi, { StorageMacroName: STORAGE_MACRO_NAME });

let parentDevices = [];
let boardState = createBoardState(companionState.STAND_ALONE_PARENT_SERIAL);
let parentDeviceStatus = [];
let parentStatusInterval = null;
let activeParentSerial = companionState.STAND_ALONE_PARENT_SERIAL;
let companionPeripheralId = '';
let standaloneUiFeatureConfig = {};
let userInterfaceThemeName = 'EveningFjord';
let isApplyingUiFeatureConfig = false;
let isHandlingSelection = false;

async function init() {
	try { await deviceComms.initializeHttpClient(xapi, HTTP_CLIENT_CONFIG) } catch (error) { utils.hardError({ Context: 'Failed to initialize HTTPClient', Error: error }) };
	try { await mem.init() } catch (error) { utils.hardError({ Context: 'Failed to initialize memory', Error: error }) };

	await loadMemoryState();
	await initializeUiFeatureMode();
	await refreshParents({ isInterval: false });
	boardState = createBoardState(activeParentSerial);
	await applyUiFeatureMode(boardState.mode);
	await renderSelectDeviceUi();
	registerCompanionMessageHandlers();
	await installParentMacrosOnOnlineParents();
	await connectPeripheralToOnlineParents();
	registerUiEventHandlers();
	startParentStatusInterval();

	companionState.warnIfCredentialsAreStored(parentDevices, log);
	log.info({ Message: 'Custom Campanion initialized', Version: config.version, ActiveParent: boardState.activeParent.name });
}

async function loadMemoryState() {
	parentDevices = await companionState.readMemoryOrDefault(mem, companionState.PARENT_DEVICES_STORAGE_KEY, [], utils);
	if (parentDevices.length > MAX_PARENT_DEVICES) {
		parentDevices = parentDevices.slice(0, MAX_PARENT_DEVICES);
		await mem.write(companionState.PARENT_DEVICES_STORAGE_KEY, parentDevices);
		log.warn({ Message: 'Parent device list exceeded maximum and was trimmed', MaxParentDevices: MAX_PARENT_DEVICES });
	}
	activeParentSerial = await companionState.readMemoryOrInitialize(mem, companionState.ACTIVE_PARENT_SERIAL_STORAGE_KEY, companionState.STAND_ALONE_PARENT_SERIAL, utils);
	standaloneUiFeatureConfig = await companionState.readMemoryOrDefault(mem, companionState.STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY, {}, utils);
	boardState = createBoardState(activeParentSerial);
}

function registerCompanionMessageHandlers() {
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

async function handleCompanionMessage(message) {
	switch (message.Action) {
		case 'ParentReady':
			await sendParentConfigMessage(message);
			break;
		case 'ConfigAccepted':
			log.info({ Message: 'Parent accepted board configuration', Source: message.Source, Payload: message.Payload });
			break;
		case 'ConfigDenied':
			await xapi.Command.UserInterface.Message.Prompt.Display({
				Title: 'Room Configuration Denied',
				Text: message.Payload && message.Payload.Reason ? message.Payload.Reason : 'The room denied this board registration request.',
				Duration: 10
			});
			break;
		case 'ConfigRequired':
			log.warn({ Message: 'Parent requested config sync before processing action', Source: message.Source, Payload: message.Payload });
			break;
	}
}

async function initializeUiFeatureMode() {
	userInterfaceThemeName = await boardServices.getUserInterfaceThemeName({ xapi: xapi, log: log });

	standaloneUiFeatureConfig = await boardServices.ensureStandaloneUiFeatureConfig({
		xapi: xapi,
		mem: mem,
		storageKey: companionState.STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY,
		standaloneUiFeatureConfig: standaloneUiFeatureConfig,
		mode: boardState.mode,
		userInterfaceConfig: config.UserInterface,
		companionUi: companionUi,
		log: log
	});

	boardServices.registerStandaloneUiFeatureSubscriptions({
		xapi: xapi,
		log: log,
		utils: utils,
		onChange: handleStandaloneUiFeatureChange
	});

	boardServices.registerUserInterfaceThemeSubscription({
		xapi: xapi,
		log: log,
		utils: utils,
		onChange: handleUserInterfaceThemeChange
	});
}

async function refreshParents(options = {}) {
	const refreshResult = await companionState.refreshParentDeviceIdentities({
		xapi: xapi,
		mem: mem,
		parentDevices: parentDevices,
		deviceComms: deviceComms,
		httpClientConfig: HTTP_CLIENT_CONFIG,
		log: log,
		isInterval: options.isInterval
	});

	parentDevices = refreshResult.parentDevices;
	parentDeviceStatus = refreshResult.parentDeviceStatus;
}

async function installParentMacrosOnOnlineParents() {
	await boardServices.installParentMacrosOnOnlineParents({
		xapi: xapi,
		deviceComms: deviceComms,
		parentDeviceStatus: parentDeviceStatus,
		findParentDeviceByHost: findParentDeviceByHost,
		installConfig: PARENT_INSTALL_CONFIG,
		httpClientConfig: HTTP_CLIENT_CONFIG,
		log: log
	});
}

async function connectPeripheralToOnlineParents() {
	companionPeripheralId = await boardServices.connectPeripheralToOnlineParents({
		xapi: xapi,
		deviceComms: deviceComms,
		parentDeviceStatus: parentDeviceStatus,
		findParentDeviceByHost: findParentDeviceByHost,
		companionBoardInformation: getConfiguredCompanionBoardInformation(),
		configVersion: config.version,
		peripheralType: PERIPHERAL_TYPE,
		httpClientConfig: HTTP_CLIENT_CONFIG,
		initialHeartbeatTimeout: INITIAL_PERIPHERAL_HEARTBEAT_TIMEOUT_SECONDS,
		sendParentReadyRequest: sendParentReadyRequest,
		log: log
	});
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
	const previousAvailabilitySignature = getParentAvailabilitySignature();
	await refreshParents({ isInterval: true });
	const currentAvailabilitySignature = getParentAvailabilitySignature();
	if (previousAvailabilitySignature !== currentAvailabilitySignature) {
		await renderSelectDeviceUi();
	}
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
	if (!event || event.Type !== 'released' || !companionUi.isSelectDeviceWidget(event.WidgetId)) {
		return;
	}

	if (isHandlingSelection) {
		return;
	}

	const widget = companionUi.parseWidgetId(event.WidgetId);

	if (widget.action === 'ReleaseInfo') {
		await companionUi.showReleaseInfo(xapi);
		return;
	}

	isHandlingSelection = true;

	try {
		switch (widget.action) {
			case 'ReleaseDevice':
				await selectStandAloneMode();
				break;
			case 'ParentSelect':
				await selectParentByIndex(widget.index);
				break;
		}
	} finally {
		isHandlingSelection = false;
	}
}

async function selectStandAloneMode() {
	activeParentSerial = companionState.STAND_ALONE_PARENT_SERIAL;
	boardState = createBoardState(activeParentSerial);
	await companionUi.setSelectedParent(xapi, parentDevices, activeParentSerial);
	await mem.write(companionState.ACTIVE_PARENT_SERIAL_STORAGE_KEY, activeParentSerial);
	await applyUiFeatureMode(boardState.mode);
	log.info({ Message: 'Companion board released to StandAlone mode' });
}

async function selectParentByIndex(parentIndex) {
	const parentDevice = parentDevices[parentIndex];

	if (!parentDevice) {
		return;
	}

	let parentStatus = findParentStatus(parentDevice);

	if (!parentStatus || !parentStatus.online) {
		const refreshResult = await companionState.refreshParentStatusWithRetries({
			xapi: xapi,
			mem: mem,
			parentDevices: parentDevices,
			parentDeviceStatus: parentDeviceStatus,
			parentDevice: parentDevice,
			retryCount: OFFLINE_PARENT_SELECTION_RETRY_COUNT,
			deviceComms: deviceComms,
			httpClientConfig: HTTP_CLIENT_CONFIG,
			log: log
		});
		parentDevices = refreshResult.parentDevices;
		parentDeviceStatus = refreshResult.parentDeviceStatus;
		parentStatus = refreshResult.parentStatus;
		await renderSelectDeviceUi();
	}

	if (!parentStatus.online) {
		await showSelectedParentOfflinePrompt(parentDevice);
		return;
	}

	activeParentSerial = parentStatus.serial;
	boardState = createBoardState(activeParentSerial);
	await companionUi.setSelectedParent(xapi, parentDevices, activeParentSerial);
	await mem.write(companionState.ACTIVE_PARENT_SERIAL_STORAGE_KEY, activeParentSerial);
	await applyUiFeatureMode(boardState.mode);
	await sendActiveParentHeartbeat();
	log.info({ Message: 'Companion board paired to parent', Host: parentDevice.host, Serial: activeParentSerial, Name: parentStatus.name });
}

function findParentStatus(parentDevice) {
	return parentDeviceStatus.find(status => status.host === parentDevice.host || status.serial === parentDevice.serial) || null;
}

function getParentAvailabilitySignature() {
	return parentDeviceStatus.map(status => `${status.host}:${status.online ? 'online' : 'offline'}`).join('|');
}

async function showSelectedParentOfflinePrompt(parentDevice) {
	await xapi.Command.UserInterface.Message.Prompt.Display({
		Title: 'Room Offline',
		Text: `${parentDevice.name || parentDevice.host} is offline and cannot be paired. Check the room device and try again.`,
		Duration: 10
	});
}

async function handleStandaloneUiFeatureChange(feature, value) {
	if (isApplyingUiFeatureConfig || boardState.mode !== 'StandAlone' || value === undefined || value === null) {
		return;
	}

	standaloneUiFeatureConfig[feature.key] = value;
	await mem.write(companionState.STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY, standaloneUiFeatureConfig);
	log.info({ Message: 'Saved standalone UI feature preference', Feature: feature.key, Value: value });
}

async function handleUserInterfaceThemeChange(value) {
	userInterfaceThemeName = value || 'EveningFjord';
	await applyUiFeatureMode(boardState.mode);
	log.info({ Message: 'Applied Companion Web Widget theme update', Theme: userInterfaceThemeName });
}

async function applyUiFeatureMode(mode) {
	isApplyingUiFeatureConfig = true;

	try {
		await boardServices.applyUiFeatureMode({
			xapi: xapi,
			mode: mode,
			standaloneUiFeatureConfig: standaloneUiFeatureConfig,
			userInterfaceConfig: config.UserInterface,
			activeParentName: boardState.activeParent.name,
			themeName: userInterfaceThemeName,
			companionUi: companionUi,
			log: log
		});
	} finally {
		isApplyingUiFeatureConfig = false;
	}
}

async function sendActiveParentHeartbeat() {
	const activeParentDevice = companionState.findActiveParentDevice(boardState, parentDevices);

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

async function sendParentReadyRequest(parentDevice, companionBoardInformation) {
	await deviceComms.sendMessageCommand(xapi, parentDevice, MESSAGE_CONFIG.routes.parentReadyRequest, {
		Board: {
			Username: companionBoardInformation.username,
			Password: companionBoardInformation.password
		}
	}, {
		app: 'Companion Board 2026',
		serial: companionBoardInformation.serial,
		source: {
			Role: 'Board',
			Name: companionBoardInformation.name,
			Host: companionBoardInformation.host,
			MacAddress: companionBoardInformation.macAddress
		}
	}, HTTP_CLIENT_CONFIG);
}

async function sendParentConfigMessage(message) {
	const parentDevice = findParentDeviceBySerial(message.Serial) || companionState.findParentDeviceByHost(parentDevices, message.Source && message.Source.Host);
	if (!parentDevice) {
		log.warn({ Message: 'ParentReady received from unknown parent', Serial: message.Serial, Source: message.Source });
		return;
	}

	const companionBoardInformation = await boardServices.getRuntimeCompanionBoardInformation(xapi, getConfiguredCompanionBoardInformation(), log);
	await deviceComms.sendMessageCommand(xapi, parentDevice, MESSAGE_CONFIG.routes.configSync, {
		Config: config,
		Board: {
			Username: companionBoardInformation.username,
			Password: companionBoardInformation.password,
			ProductPlatform: companionBoardInformation.productPlatform
		},
		Capabilities: {
			CanJoinCall: true,
			CanMuteAudio: true,
			CanMuteVideo: true,
			CanReceiveMessages: true
		}
	}, {
		app: 'Companion Board 2026',
		serial: companionBoardInformation.serial,
		source: {
			Role: 'Board',
			Name: companionBoardInformation.name,
			Host: companionBoardInformation.host,
			MacAddress: companionBoardInformation.macAddress
		}
	}, HTTP_CLIENT_CONFIG);
}

function createBoardState(parentSerial) {
	return companionState.createBoardState(parentSerial, parentDevices, getStandaloneCompanionBoardInformation());
}

function findParentDeviceByHost(host) {
	return companionState.findParentDeviceByHost(parentDevices, host);
}

function findParentDeviceBySerial(serial) {
	return parentDevices.find(device => device.serial === serial) || null;
}

function getCompanionPeripheralId() {
	return companionPeripheralId || boardServices.getCompanionPeripheralId(getConfiguredCompanionBoardInformation());
}

function getConfiguredCompanionBoardInformation() {
	const boardInformation = config.CompanionBoardInformation || {};

	return {
		host: boardInformation.host || '',
		username: boardInformation.username || '',
		password: boardInformation.password || ''
	};
}

function getStandaloneCompanionBoardInformation() {
	const boardInformation = getConfiguredCompanionBoardInformation();

	return {
		serial: companionState.STAND_ALONE_PARENT_SERIAL,
		name: companionState.STAND_ALONE_PARENT_SERIAL,
		host: boardInformation.host,
		username: boardInformation.username,
		password: boardInformation.password
	};
}

init();
