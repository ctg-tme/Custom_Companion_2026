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
 * Version:                 0.1.2.25
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
const PARENT_CONNECTION_RETRY_DELAY_MS = 5000;
const PARENT_CONNECTION_FAILURE_INFO_MS = 60000;
const REQUIRED_PAIRED_VOLUME_LEVEL = 1;
const ALLOW_STANDALONE_DURING_ACTIVE_CALL = true;
const STANDBY_SYNC_PROMPT_ID = 'cc26_standby_sync';
const RESTORE_VOLUME_PROMPT_ID = 'cc26_restore_volume';
const STANDBY_SYNC_APPLY_DELAY_MS = 30000;
const STANDBY_SYNC_PROMPT_REFRESH_MS = 5000;
const STANDBY_SYNC_SHORT_BYPASS_MS = 5 * 60 * 1000;
const STANDBY_SYNC_LONG_BYPASS_MS = 30 * 60 * 1000;
const CALL_JOIN_RETRY_COUNT = 5;
const CALL_JOIN_RETRY_DELAY_MS = 5000;
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
		activeCallDetailsRequest: 'ActiveCallDetailsRequest',
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
let callSyncInfoText = '';
let callSyncToken = 0;
let lastWebexCallSyncPayload = null;
let isCallRejoinInProgress = false;
let parentConnectivityInfoText = '';
let parentConnectivityClearTimer = null;
let parentConnectionToken = 0;
let activeParentRecoveryPromise = null;
let isCallPreservationActive = false;
let isUnhealthy = false;
let unhealthyReleasePending = false;
let areUiEventHandlersRegistered = false;
let isEnforcingMicrophoneMute = false;
let isEnforcingVolume = false;
let isVolumeRestorePromptActive = false;

async function init() {
	try {
		registerUiEventHandlers();
		try {
			await deviceComms.initializeHttpClient(xapi, HTTP_CLIENT_CONFIG);
		} catch (error) {
			utils.hardError({
				Code: 'CC26-INIT-HTTPCLIENT',
				Component: 'BoardMain',
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
				Component: 'BoardMain',
				Context: 'Failed to initialize Memory-Storage-Functions-V2',
				Remediation: 'Verify the Memory-Storage-Functions-V2 dependency and storage macro, then restart the Macro Runtime.',
				Error: error
			});
		}

		await loadMemoryState();
		registerCompanionMessageHandlers();
		registerBoardCallCountHandler();
		registerPairedMediaHandlers();
		await initializeBoardActiveCallCount();
		await initializeUiFeatureMode();
		await initializeStandbyMode();
		await refreshParents({ isInterval: false });
		boardState = createBoardState(activeParentSerial);
		await applyUiFeatureMode(boardState.mode);
		await applyStandbyMode(boardState.mode);
		if (boardState.mode === 'Paired') {
			await enforceInitialPairedMediaState();
		}
		if (isUnhealthy) {
			return;
		}
		await renderSelectDeviceUi();
		await installParentMacrosOnOnlineParents();
		await connectPeripheralToOnlineParents();
		startParentStatusInterval();
		await evaluateActiveParentAvailability();

		companionState.warnIfCredentialsAreStored(parentDevices, log);
		log.info({ Message: 'Custom Campanion initialized', Version: config.version, ActiveParent: boardState.activeParent.name });
	} catch (error) {
		await handleInitializationFailure(error);
	}
}

async function handleInitializationFailure(error) {
	const diagnostic = error.Diagnostic || {};
	isUnhealthy = true;
	stopParentStatusInterval();
	log.error({
		Message: 'Custom Campanion board initialization stopped',
		Code: diagnostic.Code || error.code || 'CC26-INIT-UNKNOWN',
		Component: diagnostic.Component || 'BoardMain',
		Context: diagnostic.Context || 'Unhandled initialization failure',
		Remediation: diagnostic.Remediation || 'Diagnose the logged xAPI failure, then restart the Macro Runtime.',
		Error: error
	});

	try {
		await companionUi.saveErrorPanel(xapi);
	} catch (panelError) {
		log.error({
			Code: 'CC26-INIT-ERROR-PANEL',
			Component: 'CompanionUI',
			Context: 'Failed to install the Companion Unavailable action panel',
			Remediation: 'Diagnose the UserInterface Extensions xAPI failure, then restart the Macro Runtime.',
			Error: panelError
		});
	}
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

function stopParentStatusInterval() {
	if (parentStatusInterval) {
		clearInterval(parentStatusInterval);
	}
	parentStatusInterval = null;
}

async function runParentStatusInterval() {
	if (isUnhealthy || isHandlingSelection || activeParentRecoveryPromise) {
		return;
	}

	const previousAvailabilitySignature = getParentAvailabilitySignature();
	await refreshParents({ isInterval: true });
	const currentAvailabilitySignature = getParentAvailabilitySignature();
	if (previousAvailabilitySignature !== currentAvailabilitySignature) {
		await renderSelectDeviceUi();
	}
	await evaluateActiveParentAvailability();
	if (!activeParentRecoveryPromise && !isCallPreservationActive) {
		await sendActiveParentHeartbeat();
	}
}

async function renderSelectDeviceUi() {
	if (isUnhealthy) {
		return;
	}

	try {
		await companionUi.savePanel(xapi, parentDevices, parentDeviceStatus, activeParentSerial);
	} catch (error) {
		utils.softError({ Context: 'Failed to render Companion Device Select UI', Error: error });
	}
}

function registerUiEventHandlers() {
	if (areUiEventHandlersRegistered) {
		return;
	}
	areUiEventHandlersRegistered = true;

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

	xapi.Event.UserInterface.Extensions.Panel.Clicked.on(event => {
		handlePanelClicked(event).catch(error => {
			utils.softError({ Context: 'Failed to handle UI panel click', Event: event, Error: error });
		});
	});
}

async function handlePromptResponse(event) {
	if (!event) {
		return;
	}
	if (event.FeedbackId === RESTORE_VOLUME_PROMPT_ID) {
		await handleRestoreVolumePromptResponse(event);
		return;
	}
	if (event.FeedbackId !== STANDBY_SYNC_PROMPT_ID) {
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

async function handlePanelClicked(event) {
	if (!event || !companionUi.isErrorPanel(event.PanelId)) {
		return;
	}
	await companionUi.showErrorPrompt(xapi);
}

async function handleWidgetAction(event) {
	if (!event || event.Type !== 'released' || !companionUi.isSelectDeviceWidget(event.WidgetId)) {
		return;
	}
	if (isUnhealthy) {
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
	if (!ALLOW_STANDALONE_DURING_ACTIVE_CALL && await isBoardInActiveCall()) {
		await xapi.Command.UserInterface.Message.Prompt.Display({
			Title: 'Call In Progress',
			Text: 'End the active call before running this board Stand Alone.',
			Duration: 10
		});
		return;
	}

	await transitionToStandalone({ Reason: 'UserSelection' });
}

async function selectParentByIndex(parentIndex) {
	const parentDevice = parentDevices[parentIndex];

	if (!parentDevice) {
		return;
	}
	isVolumeRestorePromptActive = false;
	await companionUi.clearPrompt(xapi, RESTORE_VOLUME_PROMPT_ID);

	cancelParentConnectionWork(true);
	const connectionToken = parentConnectionToken;
	const refreshResult = await runParentConnectionAttempts(parentDevice, connectionToken, OFFLINE_PARENT_SELECTION_RETRY_COUNT, true);
	if (refreshResult.canceled) {
		return;
	}
	await renderSelectDeviceUi();

	if (!refreshResult.parentStatus || !refreshResult.parentStatus.online) {
		await finishParentUnavailableFallback(parentDevice, connectionToken);
		return;
	}

	const parentStatus = refreshResult.parentStatus;
	const refreshedParentDevice = findParentDeviceBySerial(parentStatus.serial) || parentDevice;

	clearStandbySyncState();
	cancelCallSynchronization();
	activeParentSerial = parentStatus.serial;
	boardState = createBoardState(activeParentSerial);
	await companionUi.setSelectedParent(xapi, parentDevices, activeParentSerial);
	await mem.write(companionState.ACTIVE_PARENT_SERIAL_STORAGE_KEY, activeParentSerial);
	await setParentConnectivityInfo('');
	await applyUiFeatureMode(boardState.mode);
	await applyStandbyMode(boardState.mode);
	await enforceInitialPairedMediaState();
	if (isUnhealthy) {
		return;
	}
	await scheduleSelectedParentStandbySync(refreshedParentDevice);
	await sendActiveParentHeartbeat();
	log.info({ Message: 'Companion board paired to parent', Host: refreshedParentDevice.host, Serial: activeParentSerial, Name: parentStatus.name });
}

async function runParentConnectionAttempts(parentDevice, connectionToken, retryCount, showAttemptInfo) {
	const refreshResult = await companionState.refreshParentStatusWithRetries({
		xapi: xapi,
		mem: mem,
		parentDevices: parentDevices,
		parentDeviceStatus: parentDeviceStatus,
		parentDevice: parentDevice,
		expectedSerial: parentDevice.serial,
		retryCount: retryCount,
		retryDelayMs: PARENT_CONNECTION_RETRY_DELAY_MS,
		deviceComms: deviceComms,
		httpClientConfig: HTTP_CLIENT_CONFIG,
		log: log,
		isCanceled: () => connectionToken !== parentConnectionToken || isUnhealthy,
		onAttempt: showAttemptInfo ? async (attempt, attemptCount) => {
			await setParentConnectivityInfo(`Connecting to ${getParentDisplayName(parentDevice)} — attempt ${attempt} of ${attemptCount}`);
		} : null
	});

	parentDevices = refreshResult.parentDevices;
	parentDeviceStatus = refreshResult.parentDeviceStatus;
	return refreshResult;
}

async function evaluateActiveParentAvailability() {
	if (isUnhealthy || isHandlingSelection || boardState.mode !== 'Paired') {
		return;
	}

	const activeParentDevice = companionState.findActiveParentDevice(boardState, parentDevices);
	if (!activeParentDevice) {
		log.warn({ Message: 'Active parent record is unavailable', ActiveParentSerial: activeParentSerial });
		const connectionToken = ++parentConnectionToken;
		await finishParentUnavailableFallback({ name: boardState.activeParent.name || activeParentSerial, host: '' }, connectionToken);
		return;
	}

	const activeParentStatus = findParentStatus(activeParentDevice);
	const identityMatches = !!(activeParentStatus && activeParentStatus.online && activeParentStatus.serial === activeParentSerial);
	if (identityMatches) {
		if (isCallPreservationActive) {
			await completeActiveParentRecovery(activeParentDevice);
		}
		return;
	}

	startActiveParentRecovery(activeParentDevice);
}

function startActiveParentRecovery(parentDevice) {
	if (activeParentRecoveryPromise || isUnhealthy || boardState.mode !== 'Paired') {
		return;
	}

	const connectionToken = ++parentConnectionToken;
	const recoveryPromise = recoverActiveParent(parentDevice, connectionToken)
		.catch(error => {
			utils.softError({ Context: 'Active parent recovery failed', Host: parentDevice.host, Error: error });
		})
		.then(() => {
			if (activeParentRecoveryPromise === recoveryPromise) {
				activeParentRecoveryPromise = null;
			}
		});
	activeParentRecoveryPromise = recoveryPromise;
}

async function recoverActiveParent(parentDevice, connectionToken) {
	const refreshResult = await runParentConnectionAttempts(parentDevice, connectionToken, OFFLINE_PARENT_SELECTION_RETRY_COUNT, true);
	if (refreshResult.canceled) {
		return;
	}
	await renderSelectDeviceUi();

	if (refreshResult.parentStatus && refreshResult.parentStatus.online) {
		await completeActiveParentRecovery(parentDevice);
		return;
	}

	if (await isBoardInActiveCall()) {
		await enterCallPreservation(parentDevice, connectionToken);
		return;
	}

	await finishParentUnavailableFallback(parentDevice, connectionToken);
}

async function enterCallPreservation(parentDevice, connectionToken) {
	if (connectionToken !== parentConnectionToken || boardState.mode !== 'Paired' || isUnhealthy) {
		return;
	}

	isCallPreservationActive = true;
	await setParentConnectivityInfo(`${getParentDisplayName(parentDevice)} is temporarily unavailable. Your call will continue.`);
	await applyUiFeatureMode(boardState.mode);
	log.warn({ Message: 'Call Preservation State entered', Host: parentDevice.host, Serial: activeParentSerial });
	await runCallPreservationRetryLoop(parentDevice, connectionToken);
}

async function runCallPreservationRetryLoop(parentDevice, connectionToken) {
	while (isCallPreservationActive && connectionToken === parentConnectionToken && boardState.mode === 'Paired' && !isUnhealthy) {
		await delay(PARENT_CONNECTION_RETRY_DELAY_MS);
		if (!isCallPreservationActive || connectionToken !== parentConnectionToken || boardState.mode !== 'Paired' || isUnhealthy) {
			return;
		}

		if (!await isBoardInActiveCall()) {
			await finishParentUnavailableFallback(parentDevice, connectionToken);
			return;
		}

		const refreshResult = await runParentConnectionAttempts(parentDevice, connectionToken, 1, false);
		if (refreshResult.canceled) {
			return;
		}
		if (refreshResult.parentStatus && refreshResult.parentStatus.online && refreshResult.parentStatus.serial === activeParentSerial) {
			await completeActiveParentRecovery(parentDevice);
			return;
		}
	}
}

async function completeActiveParentRecovery(parentDevice) {
	if (boardState.mode !== 'Paired' || activeParentSerial !== parentDevice.serial) {
		return;
	}

	isCallPreservationActive = false;
	await setParentConnectivityInfo('');
	await applyUiFeatureMode(boardState.mode);
	await renderSelectDeviceUi();
	await sendActiveParentHeartbeat();
	log.info({ Message: 'Active parent communication restored', Host: parentDevice.host, Serial: activeParentSerial });
}

async function finishParentUnavailableFallback(parentDevice, connectionToken) {
	if (connectionToken !== parentConnectionToken || isUnhealthy) {
		return;
	}

	isCallPreservationActive = false;
	const roomName = getParentDisplayName(parentDevice);
	await setParentConnectivityInfo(`Unable to connect to ${roomName}. Running Stand Alone.`, PARENT_CONNECTION_FAILURE_INFO_MS);
	await transitionToStandalone({ Reason: 'ParentUnavailable', PreserveParentConnectivityInfo: true });
	await showSelectedParentOfflinePrompt(parentDevice);
}

function cancelParentConnectionWork(clearConnectivityInfo) {
	parentConnectionToken++;
	isCallPreservationActive = false;
	activeParentRecoveryPromise = null;
	if (clearConnectivityInfo) {
		clearParentConnectivityInfoTimer();
		parentConnectivityInfoText = '';
	}
}

function getParentDisplayName(parentDevice) {
	return parentDevice.name || parentDevice.host || 'Selected room';
}

async function transitionToStandalone(options = {}) {
	const wasPaired = boardState.mode === 'Paired';
	const hadActiveCall = wasPaired && !options.SkipMediaRestore ? await isBoardInActiveCall() : false;

	cancelParentConnectionWork(!options.PreserveParentConnectivityInfo);
	cancelCallSynchronization();
	clearStandbySyncState();
	activeParentSerial = companionState.STAND_ALONE_PARENT_SERIAL;
	boardState = createBoardState(activeParentSerial);
	await companionUi.setSelectedParent(xapi, parentDevices, activeParentSerial);
	await mem.write(companionState.ACTIVE_PARENT_SERIAL_STORAGE_KEY, activeParentSerial);
	await applyUiFeatureMode(boardState.mode);
	await applyStandbyMode(boardState.mode);

	if (wasPaired && !options.SkipMediaRestore) {
		if (hadActiveCall) {
			await showRestoreVolumePrompt();
		} else {
			await restoreDefaultVolumeAndNotify();
		}
	}

	log.info({ Message: 'Companion board released to StandAlone mode', Reason: options.Reason || 'Unspecified', ActiveCallPreserved: hadActiveCall });
}

function cancelCallSynchronization() {
	callSyncToken++;
	lastWebexCallSyncPayload = null;
	isCallRejoinInProgress = false;
	callSyncInfoText = '';
}

async function isBoardInActiveCall() {
	try {
		const activeCallCount = Number(getXapiValue(await xapi.Status.SystemUnit.State.NumberOfActiveCalls.get()));
		if (!Number.isFinite(activeCallCount)) {
			throw new Error('Active call count was not numeric');
		}
		return activeCallCount > 0;
	} catch (error) {
		log.error({
			Code: 'CC26-CALL-COUNT-READ',
			Component: 'BoardMain',
			Context: 'Failed to read the local active call count at a release boundary',
			Remediation: 'Diagnose Status.SystemUnit.State.NumberOfActiveCalls. Volume will remain unchanged because call safety cannot be confirmed.',
			Error: error
		});
		return true;
	}
}

async function showRestoreVolumePrompt() {
	try {
		await xapi.Command.UserInterface.Message.Prompt.Display({
			Title: 'Restore Volume?',
			Text: 'This board is now running Stand Alone while a call is active. Restore the device default volume?',
			FeedbackId: RESTORE_VOLUME_PROMPT_ID,
			'Option.1': 'Restore Volume',
			'Option.2': 'Keep Current',
			'Option.3': 'Dismiss',
			Duration: 30
		});
		isVolumeRestorePromptActive = true;
	} catch (error) {
		isVolumeRestorePromptActive = false;
		log.error({
			Code: 'CC26-VOLUME-RESTORE-PROMPT',
			Component: 'BoardMain',
			Context: 'Failed to display the StandAlone volume restoration prompt',
			Remediation: 'Volume was left unchanged. Diagnose UserInterface.Message.Prompt if the user needs this choice.',
			Error: error
		});
	}
}

async function handleRestoreVolumePromptResponse(event) {
	if (!isVolumeRestorePromptActive || boardState.mode !== 'StandAlone') {
		return;
	}
	isVolumeRestorePromptActive = false;
	const option = String(event.OptionId || event.Option || '');
	if (option !== '1') {
		log.info({ Message: 'StandAlone volume restoration declined or dismissed; volume left unchanged', Option: option || 'Dismissed' });
		return;
	}

	await restoreDefaultVolumeAndNotify();
}

async function restoreDefaultVolumeAndNotify() {
	let defaultVolume;
	try {
		defaultVolume = Number(getXapiValue(await xapi.Config.Audio.DefaultVolume.get()));
		if (!Number.isFinite(defaultVolume)) {
			throw new Error('Audio DefaultVolume was not numeric');
		}
		await xapi.Command.Audio.Volume.Set({ Level: defaultVolume });
		log.info({ Message: 'StandAlone default volume restored', Level: defaultVolume, MicrophonesRemainMuted: true });
	} catch (error) {
		log.error({
			Code: 'CC26-VOLUME-RESTORE',
			Component: 'BoardMain',
			Context: 'Failed to restore Audio.DefaultVolume after entering StandAlone',
			Remediation: 'Volume was left unchanged. Diagnose Config.Audio.DefaultVolume and Command.Audio.Volume.Set.',
			Error: error
		});
		return;
	}

	try {
		await xapi.Command.UserInterface.Message.Alert.Display({
			Title: 'Companion Released',
			Text: 'Volume was restored to the device default. Microphones remain muted; unmute when ready.',
			Duration: 10
		});
	} catch (error) {
		log.warn({
			Code: 'CC26-MICROPHONE-MUTE-NOTICE',
			Component: 'BoardMain',
			Context: 'Default volume was restored, but the microphone mute reminder could not be displayed',
			Error: error
		});
	}
}

function registerPairedMediaHandlers() {
	if (!xapi.Status.Audio || !xapi.Status.Audio.Microphones || !xapi.Status.Audio.Microphones.Mute || typeof xapi.Status.Audio.Microphones.Mute.on !== 'function') {
		utils.hardError({
			Code: 'CC26-MEDIA-MICROPHONE-SUBSCRIPTION',
			Component: 'BoardMain',
			Context: 'Status.Audio.Microphones.Mute subscription is unavailable',
			Remediation: 'Verify the RoomOS xAPI path and supported device software, then restart the Macro Runtime.'
		});
	}
	if (!xapi.Status.Audio.Volume || typeof xapi.Status.Audio.Volume.on !== 'function') {
		utils.hardError({
			Code: 'CC26-MEDIA-VOLUME-SUBSCRIPTION',
			Component: 'BoardMain',
			Context: 'Status.Audio.Volume subscription is unavailable',
			Remediation: 'Verify the RoomOS xAPI path and supported device software, then restart the Macro Runtime.'
		});
	}

	xapi.Status.Audio.Microphones.Mute.on(value => {
		handleMicrophoneMuteState(value).catch(error => {
			utils.softError({ Context: 'Failed to handle microphone mute state', Error: error });
		});
	});
	xapi.Status.Audio.Volume.on(value => {
		handleAudioVolumeState(value).catch(error => {
			utils.softError({ Context: 'Failed to handle audio volume state', Error: error });
		});
	});
}

async function enforceInitialPairedMediaState() {
	if (boardState.mode !== 'Paired' || isUnhealthy) {
		return;
	}

	try {
		await handleMicrophoneMuteState(await xapi.Status.Audio.Microphones.Mute.get());
	} catch (error) {
		await handleRequiredMediaFailure('CC26-MEDIA-MICROPHONE-READ', 'Failed to read Status.Audio.Microphones.Mute while entering Paired', error);
		return;
	}
	if (isUnhealthy) {
		return;
	}

	try {
		await handleAudioVolumeState(await xapi.Status.Audio.Volume.get());
	} catch (error) {
		await handleRequiredMediaFailure('CC26-MEDIA-VOLUME-READ', 'Failed to read Status.Audio.Volume while entering Paired', error);
	}
}

async function handleMicrophoneMuteState(value) {
	if (boardState.mode !== 'Paired' || isUnhealthy || isEnforcingMicrophoneMute) {
		return;
	}
	if (String(getXapiValue(value) || '').toLowerCase() === 'on') {
		return;
	}

	isEnforcingMicrophoneMute = true;
	try {
		await xapi.Command.Audio.Microphones.Mute();
		log.info({ Message: 'Paired microphone mute enforced' });
	} catch (error) {
		await handleRequiredMediaFailure('CC26-MEDIA-MICROPHONE-ENFORCE', 'Failed to enforce Command.Audio.Microphones.Mute while Paired', error);
	} finally {
		isEnforcingMicrophoneMute = false;
	}
}

async function handleAudioVolumeState(value) {
	if (boardState.mode !== 'Paired' || isUnhealthy || isEnforcingVolume) {
		return;
	}
	const currentVolume = Number(getXapiValue(value));
	if (!Number.isFinite(currentVolume)) {
		await handleRequiredMediaFailure('CC26-MEDIA-VOLUME-READ', 'Status.Audio.Volume did not return a numeric level while Paired', new Error('Audio volume was not numeric'));
		return;
	}
	if (currentVolume === REQUIRED_PAIRED_VOLUME_LEVEL) {
		return;
	}

	isEnforcingVolume = true;
	try {
		await xapi.Command.Audio.Volume.Set({ Level: REQUIRED_PAIRED_VOLUME_LEVEL });
		log.info({ Message: 'Paired audio volume enforced', Level: REQUIRED_PAIRED_VOLUME_LEVEL });
	} catch (error) {
		await handleRequiredMediaFailure('CC26-MEDIA-VOLUME-ENFORCE', 'Failed to enforce Command.Audio.Volume.Set while Paired', error);
	} finally {
		isEnforcingVolume = false;
	}
}

async function handleRequiredMediaFailure(code, context, error) {
	if (isUnhealthy) {
		return;
	}

	isUnhealthy = true;
	stopParentStatusInterval();
	cancelParentConnectionWork(false);
	log.error({
		Code: code,
		Component: 'BoardMain',
		Context: context,
		Remediation: 'Diagnose the logged local xAPI path or command, correct the macro or RoomOS compatibility issue, then restart the Macro Runtime.',
		Error: error
	});

	try {
		await companionUi.saveErrorPanel(xapi);
	} catch (panelError) {
		log.error({
			Code: 'CC26-RUNTIME-ERROR-PANEL',
			Component: 'CompanionUI',
			Context: 'Failed to install the Companion Unavailable action panel after a media enforcement failure',
			Remediation: 'Diagnose UserInterface.Extensions.Panel and restart the Macro Runtime.',
			Error: panelError
		});
	}

	if (await isBoardInActiveCall()) {
		unhealthyReleasePending = boardState.mode === 'Paired';
		await applyUiFeatureMode(boardState.mode);
		return;
	}

	if (boardState.mode === 'Paired') {
		await transitionToStandalone({ Reason: 'RequiredMediaFailure' });
	}
}

async function scheduleSelectedParentStandbySync(parentDevice) {
	try {
		const state = await deviceComms.parentStandbyStateRequest(xapi, parentDevice, HTTP_CLIENT_CONFIG);
		await scheduleStandbySync(state);
		log.info({ Message: 'Selected parent standby state fetched', Host: parentDevice.host, State: state });
	} catch (error) {
		log.warn({ Message: 'Failed to fetch selected parent standby state', Host: parentDevice.host, Error: error.code || error.message || 'Unknown parent standby state error', ErrorContext: error.Context || {} });
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
		Title: 'Room Unavailable',
		Text: `${getParentDisplayName(parentDevice)} is unavailable. This board is now running Stand Alone.`,
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
	await applyRuntimeWebWidget();
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
			runtimeInfo3: getRuntimeInfo3Text(),
			callEndOverride: mode === 'Paired' && (isCallPreservationActive || unhealthyReleasePending) ? 'Auto' : null,
			companionUi: companionUi,
			log: log
		});
	} finally {
		isApplyingUiFeatureConfig = false;
	}
}

async function applyRuntimeWebWidget() {
	await boardServices.applyWebWidgetMode({
		xapi: xapi,
		mode: boardState.mode,
		standaloneUiFeatureConfig: standaloneUiFeatureConfig,
		userInterfaceConfig: config.UserInterface,
		activeParentName: boardState.activeParent.name,
		themeName: userInterfaceThemeName,
		runtimeInfo3: getRuntimeInfo3Text(),
		companionUi: companionUi,
		log: log
	});
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

	const state = message.Payload && message.Payload.State;
	if (pendingStandbySyncTimer) {
		await scheduleStandbySync(state);
		return;
	}

	await applyImmediateStandbySync(state);
}

async function applyImmediateStandbySync(state) {
	if (state === 'EnteringStandby') {
		log.debug({ Message: 'Ignored parent standby transition state', State: state });
		return;
	}

	if (isStandbyBypassActive()) {
		log.info({ Message: 'Ignored parent standby sync while bypass is active', State: state, BypassUntil: new Date(standbyBypassUntil).toISOString() });
		return;
	}

	await boardServices.applyStandbySyncState({
		xapi: xapi,
		state: state,
		log: log
	});
}

async function handleCallSync(message) {
	if (message.Serial !== activeParentSerial) {
		log.debug({ Message: 'Ignored call sync from non-active parent', SendingParentSerial: message.Serial, ActiveParentSerial: activeParentSerial });
		return;
	}

	clearStandbySyncState();
	await handleParentCallSyncPayload(message.Payload || {});
}

async function handleParentCallSyncPayload(payload) {
	if (payload.CallKind === 'Disconnect') {
		callSyncToken++;
		lastWebexCallSyncPayload = null;
		await boardServices.disconnectAllCalls({ xapi: xapi, log: log });
		await setCallSyncInfo('');
		log.info({ Message: 'Parent call disconnect sync received', Payload: payload });
		return;
	}

	if (payload.CallKind === 'BYOD') {
		await setCallSyncInfo('Companion Device will only join Webex calls. Laptop/BYOD calls are not supported.');
		await xapi.Command.UserInterface.Message.Alert.Display({
			Title: 'Unsupported Call Type',
			Text: 'The Companion Device will only join Webex calls. Laptop/BYOD calls are not supported.',
			Duration: 15
		});
		log.info({ Message: 'BYOD call sync received; board join not supported', Payload: payload });
		return;
	}

	if (payload.CallKind === 'AdmissionRequired') {
		await setCallSyncInfo('Host needs to admit this board to the Webex call.');
		log.info({ Message: 'Parent cannot auto-admit companion board because it is not host', Payload: payload });
		return;
	}

	if (payload.CallKind === 'AdmissionAdmitted') {
		await setCallSyncInfo('');
		log.info({ Message: 'Companion board admitted by parent host', Payload: payload });
		return;
	}

	if (payload.CallKind === 'ActiveCallDetails') {
		await handleActiveCallDetailsResponse(payload);
		return;
	}

	const isWebexCall = isWebexCallPayload(payload);
	log.debug({ Message: 'Call sync payload classified', IsWebexCall: isWebexCall, RemoteNumber: payload.RemoteNumber || '', MeetingPlatform: payload.MeetingPlatform || '', Protocol: payload.Protocol || '' });
	if (!isWebexCall) {
		callSyncToken++;
		await setCallSyncInfo(getUnsupportedCallInfoText(payload));
		log.info({ Message: 'Non-Webex call sync received; board join is out of scope', Payload: payload });
		return;
	}

	callSyncToken++;
	lastWebexCallSyncPayload = payload;
	await joinParentCallWithRetries(payload, callSyncToken);
}

function registerBoardCallCountHandler() {
	xapi.Status.SystemUnit.State.NumberOfActiveCalls.on(callCount => {
		const activeCallCount = Number(getXapiValue(callCount));
		if (activeCallCount < 1) {
			handleBoardCallCountZero().catch(error => {
				utils.softError({ Context: 'Failed to handle companion board call count zero', Error: error });
			});
		}
	});
}

async function initializeBoardActiveCallCount() {
	try {
		const activeCallCount = Number(getXapiValue(await xapi.Status.SystemUnit.State.NumberOfActiveCalls.get()));
		if (!Number.isFinite(activeCallCount)) {
			throw new Error('Initial active call count was not numeric');
		}
		log.debug({ Message: 'Initial companion board active call count read', ActiveCallCount: activeCallCount });
	} catch (error) {
		log.error({
			Code: 'CC26-CALL-COUNT-READ',
			Component: 'BoardMain',
			Context: 'Failed to read the initial local active call count',
			Remediation: 'Diagnose Status.SystemUnit.State.NumberOfActiveCalls before relying on automatic release behavior.',
			Error: error
		});
	}
}

async function handleBoardCallCountZero() {
	if (isUnhealthy && unhealthyReleasePending) {
		unhealthyReleasePending = false;
		await transitionToStandalone({ Reason: 'UnhealthyCallEnded' });
		return;
	}
	if (isCallPreservationActive) {
		const activeParentDevice = companionState.findActiveParentDevice(boardState, parentDevices);
		if (activeParentDevice) {
			await finishParentUnavailableFallback(activeParentDevice, parentConnectionToken);
		}
		return;
	}
	if (boardState.mode !== 'Paired' || !lastWebexCallSyncPayload || isCallRejoinInProgress) {
		return;
	}

	const activeParentDevice = companionState.findActiveParentDevice(boardState, parentDevices);
	if (!activeParentDevice) {
		log.warn({ Message: 'Board call ended; active parent unavailable for rejoin check' });
		return;
	}

	isCallRejoinInProgress = true;
	await setCallSyncInfo('Checking active parent call before rejoining.');
	try {
		await sendActiveCallDetailsRequest(activeParentDevice);
	} catch (error) {
		isCallRejoinInProgress = false;
		log.warn({ Message: 'Failed to request parent call details after board call ended', Host: activeParentDevice.host, Error: error.message || error.code || 'Unknown parent call details request error' });
		return;
	}

	log.info({ Message: 'Requested active parent call details after board call ended', Host: activeParentDevice.host, Payload: lastWebexCallSyncPayload });
}

async function sendActiveCallDetailsRequest(parentDevice) {
	const companionBoardInformation = await boardServices.getRuntimeCompanionBoardInformation(xapi, getConfiguredCompanionBoardInformation(), log);
	await deviceComms.sendMessageCommand(xapi, parentDevice, MESSAGE_CONFIG.routes.activeCallDetailsRequest, {
		Reason: 'BoardCallEnded',
		LastSyncedCall: lastWebexCallSyncPayload || {}
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

async function handleActiveCallDetailsResponse(payload) {
	if (!isCallRejoinInProgress || !lastWebexCallSyncPayload) {
		log.debug({ Message: 'Ignored active call details response without pending rejoin', Payload: payload });
		return;
	}

	const matchingParentCall = findMatchingParentCall([payload.ParentCall || {}], lastWebexCallSyncPayload);
	if (!matchingParentCall) {
		const skippedPayload = lastWebexCallSyncPayload;
		lastWebexCallSyncPayload = null;
		isCallRejoinInProgress = false;
		await setCallSyncInfo('');
		log.info({ Message: 'Board call ended and active parent call did not match last synced call; rejoin skipped', ParentHasActiveCall: !!payload.ParentHasActiveCall, ParentCall: payload.ParentCall || {}, Payload: skippedPayload });
		return;
	}

	callSyncToken++;
	const rejoinToken = callSyncToken;
	await setCallSyncInfo('Rejoining Webex call from active parent.');
	log.info({ Message: 'Board call ended while parent is still in same call; rejoining companion board', ParentCall: matchingParentCall, Payload: lastWebexCallSyncPayload });

	try {
		await joinParentCallWithRetries(lastWebexCallSyncPayload, rejoinToken);
	} finally {
		isCallRejoinInProgress = false;
	}
}

function findMatchingParentCall(parentCalls, payload) {
	const parentCall = payload.ParentCall || {};
	const expectedCallId = normalizeCallIdentity(parentCall.CallId);
	const expectedRemoteUri = normalizeCallIdentity(parentCall.RemoteURI);
	const expectedParentRemoteNumber = normalizeCallIdentity(parentCall.RemoteNumber);
	const expectedDialedRemoteNumber = normalizeCallIdentity(payload.RemoteNumber);

	for (let index = 0; index < parentCalls.length; index++) {
		const parentCallStatus = parentCalls[index];
		if (expectedCallId && normalizeCallIdentity(parentCallStatus.CallId) === expectedCallId) {
			return parentCallStatus;
		}
		if (expectedRemoteUri && normalizeCallIdentity(parentCallStatus.RemoteURI) === expectedRemoteUri) {
			return parentCallStatus;
		}
		if (expectedParentRemoteNumber && normalizeCallIdentity(parentCallStatus.RemoteNumber) === expectedParentRemoteNumber) {
			return parentCallStatus;
		}
		if (!expectedParentRemoteNumber && expectedDialedRemoteNumber && normalizeCallIdentity(parentCallStatus.RemoteNumber) === expectedDialedRemoteNumber) {
			return parentCallStatus;
		}
	}

	return null;
}

function normalizeCallIdentity(value) {
	return String(value || '').trim().toLowerCase();
}

function getXapiValue(value) {
	if (value && typeof value === 'object' && value.Value !== undefined) {
		return value.Value;
	}
	return value;
}

function isWebexCallPayload(payload) {
	const meetingPlatform = String(payload.MeetingPlatform || '').toLowerCase();
	const protocol = String(payload.Protocol || '').toLowerCase();
	const remoteNumber = String(payload.RemoteNumber || '').toLowerCase();
	const isWebexRemoteNumber = remoteNumber.indexOf('webex') >= 0 && remoteNumber.indexOf('com') >= 0;
	const isWebexProtocol = protocol === 'spark';
	const isKnownNonWebexPlatform = meetingPlatform && meetingPlatform !== 'unknown' && meetingPlatform.indexOf('webex') < 0;

	if (isKnownNonWebexPlatform) {
		return false;
	}

	if (remoteNumber.indexOf('zoom.') >= 0 || remoteNumber.indexOf('zoomcrc.') >= 0 || remoteNumber.indexOf('teams.') >= 0 || remoteNumber.indexOf('google.') >= 0) {
		return false;
	}

	return meetingPlatform.indexOf('webex') >= 0 || isWebexProtocol || isWebexRemoteNumber;
}

function getUnsupportedCallInfoText(payload) {
	const meetingPlatform = getUnsupportedCallPlatformName(payload);
	return `Companion Device will only join Webex calls. Join ${meetingPlatform} manually from the room system.`;
}

function getUnsupportedCallPlatformName(payload) {
	const meetingPlatform = String(payload.MeetingPlatform || '').trim();
	const remoteNumber = String(payload.RemoteNumber || '').toLowerCase();
	if (meetingPlatform && meetingPlatform.toLowerCase() !== 'unknown') {
		return meetingPlatform;
	}
	if (remoteNumber.indexOf('zoom.') >= 0 || remoteNumber.indexOf('zoomcrc.') >= 0) {
		return 'Zoom';
	}
	if (remoteNumber.indexOf('teams.') >= 0 || remoteNumber.indexOf('microsoft.') >= 0) {
		return 'Microsoft Teams';
	}
	if (remoteNumber.indexOf('google.') >= 0 || remoteNumber.indexOf('meet.google') >= 0) {
		return 'Google Meet';
	}

	return 'this meeting';
}

async function joinParentCallWithRetries(payload, joinToken) {
	let lastError = null;

	for (let attempt = 1; attempt <= CALL_JOIN_RETRY_COUNT; attempt++) {
		if (joinToken !== callSyncToken) {
			log.info({ Message: 'Companion board parent call join canceled', Attempt: attempt, Payload: payload });
			return;
		}

		try {
			await boardServices.joinParentCall({ xapi: xapi, payload: payload, log: log });
			if (joinToken !== callSyncToken) {
				log.info({ Message: 'Companion board parent call join completed after cancellation', Attempt: attempt, Payload: payload });
				return;
			}
			await setCallSyncInfo(getCallJoinInfoText(payload));
			log.info({ Message: 'Companion board joined parent call', Attempt: attempt, Payload: payload });
			return;
		} catch (error) {
			lastError = error;
			log.warn({ Message: 'Companion board parent call join failed', Attempt: attempt, Error: error.message || error.code || 'Unknown call join error', Payload: payload });
			if (attempt < CALL_JOIN_RETRY_COUNT) {
				await delay(CALL_JOIN_RETRY_DELAY_MS);
			}
		}
	}

	await setCallSyncInfo(getCallJoinFailureInfoText(payload));
	await xapi.Command.UserInterface.Message.Alert.Display({
		Title: 'Call Sync Failed',
		Text: getCallJoinFailureAlertText(payload),
		Duration: 20
	});
	utils.softError({ Context: 'Failed to join parent call after retries', Error: lastError, Payload: payload });
}

function getCallJoinFailureInfoText(payload) {
	return `⚠️ Failed to join call: ${getCallRemoteNumberText(payload)} ⚠️`;
}

function getCallJoinFailureAlertText(payload) {
	return `Failed to join call: ${getCallRemoteNumberText(payload)}`;
}

function getCallRemoteNumberText(payload) {
	return payload.RemoteNumber || 'Unknown remote number';
}

function getCallJoinInfoText(payload) {
	const meetingPlatform = String(payload.MeetingPlatform || '').toLowerCase();
	const remoteNumber = String(payload.RemoteNumber || '').toLowerCase();
	if (meetingPlatform.indexOf('webex') >= 0 || (remoteNumber.indexOf('webex') >= 0 && remoteNumber.indexOf('com') >= 0)) {
		return '';
	}

	return 'Joining parent call. Admit this board from the meeting lobby if needed.';
}

async function setCallSyncInfo(value) {
	callSyncInfoText = value || '';
	await applyRuntimeWebWidget();
}

async function setParentConnectivityInfo(value, clearAfterMs) {
	clearParentConnectivityInfoTimer();
	parentConnectivityInfoText = value || '';
	await applyRuntimeWebWidget();

	if (parentConnectivityInfoText && clearAfterMs) {
		parentConnectivityClearTimer = setTimeout(() => {
			parentConnectivityClearTimer = null;
			parentConnectivityInfoText = '';
			applyRuntimeWebWidget().catch(error => {
				utils.softError({ Context: 'Failed to clear parent connection information', Error: error });
			});
		}, clearAfterMs);
	}
}

function clearParentConnectivityInfoTimer() {
	if (parentConnectivityClearTimer) {
		clearTimeout(parentConnectivityClearTimer);
	}
	parentConnectivityClearTimer = null;
}

function delay(milliseconds) {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
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
		applyRuntimeWebWidget().catch(error => {
			utils.softError({ Context: 'Failed to clear expired standby bypass widget info', Error: error });
		});
	}, durationMs);
	await applyRuntimeWebWidget();
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

function getRuntimeInfo3Text() {
	return parentConnectivityInfoText || callSyncInfoText || getStandbyBypassInfoText();
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
		log.warn({ Message: 'Companion board peripheral heartbeat failed', Host: activeParentDevice.host, Error: error.code || error.message || 'Unknown peripheral heartbeat error', ErrorContext: error.Context || {} });
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
