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
 * Version:                 0.1.2.8
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
const STANDBY_SYNC_PROMPT_ID = 'cc26_standby_sync';
const STANDBY_SYNC_APPLY_DELAY_MS = 30000;
const STANDBY_SYNC_PROMPT_REFRESH_MS = 5000;
const STANDBY_SYNC_SHORT_BYPASS_MS = 5 * 60 * 1000;
const STANDBY_SYNC_LONG_BYPASS_MS = 30 * 60 * 1000;
const PERIPHERAL_TYPE = 'ControlSystem';
const HTTP_CLIENT_CONFIG = {
	mode: 'On',
	allowInsecureHTTPS: config.httpClient.allowInsecureHTTPS,
	maxConcurrentRequests: 3
};
const MESSAGE_CONFIG = {
	service: 'CustomCampanion',
	routes: {
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
let standaloneStandbyConfig = {};
let userInterfaceThemeName = 'EveningFjord';
let isApplyingUiFeatureConfig = false;
let isApplyingStandbyConfig = false;
let isHandlingSelection = false;
let pendingStandbySyncTimer = null;
let pendingStandbyPromptRefreshTimer = null;
let pendingStandbySyncDeadline = 0;
let pendingStandbySyncState = '';
let standbySyncPromptDismissed = false;
let standbyBypassUntil = 0;
let standbyBypassTimer = null;

async function init() {
	try { await deviceComms.initializeHttpClient(xapi, HTTP_CLIENT_CONFIG) } catch (error) { utils.hardError({ Context: 'Failed to initialize HTTPClient', Error: error }) };
	try { await mem.init() } catch (error) { utils.hardError({ Context: 'Failed to initialize memory', Error: error }) };

	await loadMemoryState();
	await initializeUiFeatureMode();
	await initializeStandbyMode();
	await refreshParents({ isInterval: false });
	boardState = createBoardState(activeParentSerial);
	await applyUiFeatureMode(boardState.mode);
	await applyStandbyMode(boardState.mode);
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
	standaloneStandbyConfig = await companionState.readMemoryOrDefault(mem, companionState.STANDALONE_STANDBY_CONFIG_STORAGE_KEY, {}, utils);
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
		case 'StandbySync':
			await handleStandbySync(message);
			break;
		case 'CallSync':
			await handleCallSync(message);
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

async function initializeStandbyMode() {
	standaloneStandbyConfig = await boardServices.ensureStandaloneStandbyConfig({
		xapi: xapi,
		mem: mem,
		storageKey: companionState.STANDALONE_STANDBY_CONFIG_STORAGE_KEY,
		standaloneStandbyConfig: standaloneStandbyConfig,
		log: log
	});

	boardServices.registerStandaloneStandbySubscriptions({
		xapi: xapi,
		log: log,
		utils: utils,
		onChange: handleStandaloneStandbyChange
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

	xapi.Event.UserInterface.Message.Prompt.Response.on(event => {
		handlePromptResponse(event).catch(error => {
			utils.softError({ Context: 'Failed to handle prompt response', Event: event, Error: error });
		});
	});
}

async function handlePromptResponse(event) {
	if (!event || event.FeedbackId !== STANDBY_SYNC_PROMPT_ID) {
		return;
	}

	switch (String(event.OptionId || event.Option || '')) {
		case '1':
			await activateStandbyBypass(STANDBY_SYNC_SHORT_BYPASS_MS);
			break;
		case '2':
			await activateStandbyBypass(STANDBY_SYNC_LONG_BYPASS_MS);
			break;
		case '3':
			standbySyncPromptDismissed = true;
			clearStandbyPromptRefreshTimer();
			await companionUi.clearPrompt(xapi, STANDBY_SYNC_PROMPT_ID);
			break;
	}
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
	clearStandbySyncState();
	activeParentSerial = companionState.STAND_ALONE_PARENT_SERIAL;
	boardState = createBoardState(activeParentSerial);
	await companionUi.setSelectedParent(xapi, parentDevices, activeParentSerial);
	await mem.write(companionState.ACTIVE_PARENT_SERIAL_STORAGE_KEY, activeParentSerial);
	await applyUiFeatureMode(boardState.mode);
	await applyStandbyMode(boardState.mode);
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

	clearStandbySyncState();
	activeParentSerial = parentStatus.serial;
	boardState = createBoardState(activeParentSerial);
	await companionUi.setSelectedParent(xapi, parentDevices, activeParentSerial);
	await mem.write(companionState.ACTIVE_PARENT_SERIAL_STORAGE_KEY, activeParentSerial);
	await applyUiFeatureMode(boardState.mode);
	await applyStandbyMode(boardState.mode);
	await scheduleSelectedParentStandbySync(parentDevice);
	await sendActiveParentHeartbeat();
	log.info({ Message: 'Companion board paired to parent', Host: parentDevice.host, Serial: activeParentSerial, Name: parentStatus.name });
}

async function scheduleSelectedParentStandbySync(parentDevice) {
	try {
		const state = await deviceComms.parentStandbyStateRequest(xapi, parentDevice, HTTP_CLIENT_CONFIG);
		await scheduleStandbySync(state);
		log.info({ Message: 'Selected parent standby state fetched', Host: parentDevice.host, State: state });
	} catch (error) {
		log.warn({ Message: 'Failed to fetch selected parent standby state', Host: parentDevice.host, Error: error.code || error.message || 'Unknown parent standby state error' });
	}
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

async function handleStandaloneStandbyChange(standbyConfig, value) {
	if (isApplyingStandbyConfig || boardState.mode !== 'StandAlone' || value === undefined || value === null) {
		return;
	}

	standaloneStandbyConfig[standbyConfig.key] = value;
	await mem.write(companionState.STANDALONE_STANDBY_CONFIG_STORAGE_KEY, standaloneStandbyConfig);
	log.info({ Message: 'Saved standalone standby preference', Feature: standbyConfig.key, Value: value });
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
			runtimeInfo3: getStandbyBypassInfoText(),
			companionUi: companionUi,
			log: log
		});
	} finally {
		isApplyingUiFeatureConfig = false;
	}
}

async function applyStandbyMode(mode) {
	isApplyingStandbyConfig = true;

	try {
		await boardServices.applyStandbyMode({
			xapi: xapi,
			mode: mode,
			standaloneStandbyConfig: standaloneStandbyConfig,
			log: log
		});
	} finally {
		isApplyingStandbyConfig = false;
	}
}

async function handleStandbySync(message) {
	if (message.Serial !== activeParentSerial) {
		log.debug({ Message: 'Ignored standby sync from non-active parent', SendingParentSerial: message.Serial, ActiveParentSerial: activeParentSerial });
		return;
	}

	await scheduleStandbySync(message.Payload && message.Payload.State);
}

async function handleCallSync(message) {
	if (message.Serial !== activeParentSerial) {
		log.debug({ Message: 'Ignored call sync from non-active parent', SendingParentSerial: message.Serial, ActiveParentSerial: activeParentSerial });
		return;
	}

	clearStandbySyncState();
	log.info({ Message: 'Parent call sync received', Source: message.Source, Payload: message.Payload });
}

async function scheduleStandbySync(state) {
	if (state === 'EnteringStandby') {
		log.debug({ Message: 'Ignored parent standby transition state', State: state });
		return;
	}

	if (isStandbyBypassActive()) {
		log.info({ Message: 'Ignored parent standby sync while bypass is active', State: state, BypassUntil: new Date(standbyBypassUntil).toISOString() });
		return;
	}

	pendingStandbySyncState = state;

	if (!pendingStandbySyncTimer) {
		pendingStandbySyncDeadline = Date.now() + STANDBY_SYNC_APPLY_DELAY_MS;
		standbySyncPromptDismissed = false;
		pendingStandbySyncTimer = setTimeout(() => {
			applyPendingStandbySync().catch(error => {
				utils.softError({ Context: 'Failed to apply pending standby sync', State: pendingStandbySyncState, Error: error });
			});
		}, STANDBY_SYNC_APPLY_DELAY_MS);
	}

	await refreshStandbySyncPrompt();
}

async function applyPendingStandbySync() {
	const state = pendingStandbySyncState;
	clearStandbySyncTimers();

	await boardServices.applyStandbySyncState({
		xapi: xapi,
		state: state,
		log: log
	});
}

async function refreshStandbySyncPrompt() {
	if (standbySyncPromptDismissed || !pendingStandbySyncState) {
		return;
	}

	const remainingSeconds = Math.max(0, Math.ceil((pendingStandbySyncDeadline - Date.now()) / 1000));
	await companionUi.showStandbySyncPrompt(xapi, {
		feedbackId: STANDBY_SYNC_PROMPT_ID,
		state: pendingStandbySyncState,
		remainingSeconds: remainingSeconds
	});

	clearStandbyPromptRefreshTimer();
	if (remainingSeconds > 0) {
		pendingStandbyPromptRefreshTimer = setTimeout(() => {
			refreshStandbySyncPrompt().catch(error => {
				utils.softError({ Context: 'Failed to refresh standby sync prompt', Error: error });
			});
		}, STANDBY_SYNC_PROMPT_REFRESH_MS);
	}
}

async function activateStandbyBypass(durationMs) {
	standbyBypassUntil = Date.now() + durationMs;
	clearStandbySyncTimers();
	clearStandbyBypassTimer();
	standbyBypassTimer = setTimeout(() => {
		standbyBypassUntil = 0;
		applyUiFeatureMode(boardState.mode).catch(error => {
			utils.softError({ Context: 'Failed to clear expired standby bypass widget info', Error: error });
		});
	}, durationMs);
	await applyUiFeatureMode(boardState.mode);
	log.info({ Message: 'Standby sync bypass activated', BypassUntil: new Date(standbyBypassUntil).toISOString() });
}

function clearStandbySyncState() {
	clearStandbySyncTimers();
	clearStandbyBypassTimer();
	standbyBypassUntil = 0;
}

function clearStandbySyncTimers() {
	if (pendingStandbySyncTimer) {
		clearTimeout(pendingStandbySyncTimer);
	}
	clearStandbyPromptRefreshTimer();
	pendingStandbySyncTimer = null;
	pendingStandbySyncDeadline = 0;
	pendingStandbySyncState = '';
	standbySyncPromptDismissed = false;
	companionUi.clearPrompt(xapi, STANDBY_SYNC_PROMPT_ID).catch(error => {
		utils.softError({ Context: 'Failed to clear standby sync prompt', Error: error });
	});
}

function clearStandbyPromptRefreshTimer() {
	if (pendingStandbyPromptRefreshTimer) {
		clearTimeout(pendingStandbyPromptRefreshTimer);
	}
	pendingStandbyPromptRefreshTimer = null;
}

function clearStandbyBypassTimer() {
	if (standbyBypassTimer) {
		clearTimeout(standbyBypassTimer);
	}
	standbyBypassTimer = null;
}

function isStandbyBypassActive() {
	if (!standbyBypassUntil) {
		return false;
	}

	if (Date.now() < standbyBypassUntil) {
		return true;
	}

	standbyBypassUntil = 0;
	clearStandbyBypassTimer();
	return false;
}

function getStandbyBypassInfoText() {
	if (!isStandbyBypassActive()) {
		return '';
	}

	return `Standby sync bypass until ${formatTime(new Date(standbyBypassUntil))}`;
}

function formatTime(date) {
	const hours = date.getHours();
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const suffix = hours >= 12 ? 'PM' : 'AM';
	const displayHours = hours % 12 || 12;
	return `${displayHours}:${minutes} ${suffix}`;
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
