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
 * Revised:                 July 22, 2026
 * Version:                 0.1.2.29
 *
 * Description:             Companion board entry macro and lifecycle orchestrator. Domain workflows
 *                          are delegated to the numbered controller modules listed below.
 *
 * Documentation:           N/A
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro Series
 *
 * Code Dependencies:       Memory-Storage-Functions-V2, Custom-Campanion_2_Config_2026, Custom-Campanion_3_Utils_2026, Custom-Campanion_4_UI_2026, Custom-Campanion_5_State_2026, Custom-Campanion_6_DeviceComms_2026, Custom-Campanion_8_Services_2026, Custom-Campanion_9_ParentConnectivity_2026, Custom-Campanion_10_PairedEnvironment_2026, Custom-Campanion_11_BoardCallSync_2026, Custom-Campanion_13_StandbyCoordination_2026, Custom-Campanion_14_PinMode_2026, Custom-Campanion_15_ParentRegistration_2026, Custom-Companion-Memory-Storage
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
import { parentConnectivity } from './Custom-Campanion_9_ParentConnectivity_2026';
import { pairedEnvironment } from './Custom-Campanion_10_PairedEnvironment_2026';
import { boardCallSync } from './Custom-Campanion_11_BoardCallSync_2026';
import { standbyCoordination } from './Custom-Campanion_13_StandbyCoordination_2026';
import { pinMode } from './Custom-Campanion_14_PinMode_2026';
import { parentRegistration } from './Custom-Campanion_15_ParentRegistration_2026';

const log = new utils.Logger('Custom-Campanion_Board_Main');

const STORAGE_MACRO_NAME = 'Custom-Campanion';
const MAX_PARENT_DEVICES = 6;
const INITIAL_PERIPHERAL_HEARTBEAT_TIMEOUT_SECONDS = 5;
const ALLOW_STANDALONE_DURING_ACTIVE_CALL = true;
const PERIPHERAL_TYPE = 'ControlSystem';
const UNHEALTHY_INFO_TEXT = 'Companion controls are unavailable. Contact a Device Administrator.';
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
	parentCallCoordinationSourceMacroName: 'Custom-Campanion_12_ParentCallCoordination_2026',
	parentCallCoordinationTargetMacroName: 'Custom-Campanion_12_ParentCallCoordination_2026',
	utilsMacroName: 'Custom-Campanion_3_Utils_2026',
	deviceCommsMacroName: 'Custom-Campanion_6_DeviceComms_2026',
	memoryStorageMacroName: 'Memory-Storage-Functions-V2'
};

const mem = new MemoryStorage(xapi, { StorageMacroName: STORAGE_MACRO_NAME });

let parentDevices = [];
let pendingDeregistrations = [];
let boardState = createBoardState(companionState.STAND_ALONE_PARENT_SERIAL);
let parentDeviceStatus = [];
let activeParentSerial = companionState.STAND_ALONE_PARENT_SERIAL;
let companionPeripheralId = '';
let isHandlingSelection = false;
let isUnhealthy = false;
let unhealthyReleasePending = false;
let areUiEventHandlersRegistered = false;

const pinModeController = pinMode.create({
	xapi: xapi,
	mem: mem,
	storageKey: companionState.PIN_MODE_STORAGE_KEY,
	config: config.pinMode,
	companionUi: companionUi,
	log: log,
	utils: utils,
	callbacks: {
		getRuntimeContext: () => ({ isUnhealthy: isUnhealthy }),
		onHardError: handleRuntimeHardFailure
	}
});

const parentConnectivityController = parentConnectivity.create({
	xapi: xapi,
	mem: mem,
	deviceComms: deviceComms,
	httpClientConfig: HTTP_CLIENT_CONFIG,
	parentDevicesStorageKey: companionState.PARENT_DEVICES_STORAGE_KEY,
	log: log,
	utils: utils,
	policy: {
		statusIntervalMs: 30000,
		selectionRetryCount: 5,
		retryDelayMs: 5000,
		failureInfoMs: 60000,
		heartbeatTimeoutSeconds: 40
	},
	callbacks: {
		getRuntimeContext: () => ({
			isUnhealthy: isUnhealthy,
			isHandlingSelection: isHandlingSelection,
			mode: boardState.mode,
			activeParentSerial: activeParentSerial,
			activeParentHost: boardState.activeParent.host,
			activeParentName: boardState.activeParent.name
		}),
		onSnapshotChanged: snapshot => {
			parentDevices = snapshot.parentDevices;
			parentDeviceStatus = snapshot.parentDeviceStatus;
			pendingDeregistrations = parentRegistrationController.getState().pendingDeregistrations;
			parentRegistrationController.setState(parentDevices, pendingDeregistrations);
		},
		onAvailabilityChanged: async () => renderSelectDeviceUi(),
		onInfoChanged: async () => applyRuntimeWebWidget(),
		onSelectionVerified: completeVerifiedParentSelection,
		onCallPreservationChanged: async () => applyUiFeatureMode(boardState.mode),
		onRecovered: async () => {
			await applyUiFeatureMode(boardState.mode);
			await renderSelectDeviceUi();
		},
		onUnavailableFallback: async parentDevice => {
			await transitionToStandalone({ Reason: 'ParentUnavailable', PreserveParentConnectivityInfo: true });
			await showSelectedParentOfflinePrompt(parentDevice);
		},
		isBoardInActiveCall: isBoardInActiveCall,
		getPeripheralId: getCompanionPeripheralId
	}
});

const pairedEnvironmentController = pairedEnvironment.create({
	xapi: xapi,
	mem: mem,
	storageKey: companionState.STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY,
	userInterfaceConfig: config.UserInterface,
	companionUi: companionUi,
	log: log,
	utils: utils,
	policy: {
		requiredVolumeLevel: 1,
		dndTimeoutMinutes: 5,
		dndRefreshMs: 2 * 60 * 1000
	},
	callbacks: {
		getRuntimeContext: () => ({
			mode: boardState.mode,
			isUnhealthy: isUnhealthy,
			activeParentName: boardState.activeParent.name,
			runtimeInfo3: getRuntimeInfo3Text(),
			callEndOverride: boardState.mode === 'Paired' && (parentConnectivityController.isCallPreservationActive() || unhealthyReleasePending) ? 'Auto' : null
		}),
		onRequiredMediaFailure: handleRequiredMediaFailure
	}
});

const standbyCoordinationController = standbyCoordination.create({
	xapi: xapi,
	mem: mem,
	storageKey: companionState.STANDALONE_STANDBY_CONFIG_STORAGE_KEY,
	deviceComms: deviceComms,
	httpClientConfig: HTTP_CLIENT_CONFIG,
	companionUi: companionUi,
	log: log,
	utils: utils,
	policy: {
		applyDelayMs: 30000,
		promptRefreshMs: 5000,
		shortBypassMs: 5 * 60 * 1000,
		longBypassMs: 30 * 60 * 1000
	},
	callbacks: {
		getRuntimeContext: () => ({
			mode: boardState.mode,
			activeParentSerial: activeParentSerial
		}),
		onInfoChanged: async () => applyRuntimeWebWidget()
	}
});

const boardCallSyncController = boardCallSync.create({
	xapi: xapi,
	deviceComms: deviceComms,
	httpClientConfig: HTTP_CLIENT_CONFIG,
	activeCallDetailsRoute: MESSAGE_CONFIG.routes.activeCallDetailsRequest,
	log: log,
	utils: utils,
	policy: {
		joinRetryCount: 5,
		joinRetryDelayMs: 5000
	},
	callbacks: {
		getRuntimeContext: () => ({
			mode: boardState.mode,
			activeParentSerial: activeParentSerial
		}),
		getActiveParentDevice: () => companionState.findActiveParentDevice(boardState, parentDevices),
		getRuntimeBoardInformation: async () => boardServices.getRuntimeCompanionBoardInformation(xapi, getConfiguredCompanionBoardInformation(), log),
		clearStandbySyncState: () => standbyCoordinationController.clear(),
		onCallCountZeroBoundary: handleCallCountZeroBoundary,
		onInfoChanged: async () => applyRuntimeWebWidget()
	}
});

const parentRegistrationController = parentRegistration.create({
	xapi: xapi,
	mem: mem,
	deviceComms: deviceComms,
	boardServices: boardServices,
	companionUi: companionUi,
	pinModeController: pinModeController,
	parentDevicesStorageKey: companionState.PARENT_DEVICES_STORAGE_KEY,
	pendingStorageKey: companionState.PENDING_DEREGISTRATIONS_STORAGE_KEY,
	httpClientConfig: HTTP_CLIENT_CONFIG,
	installConfig: PARENT_INSTALL_CONFIG,
	configVersion: config.version,
	peripheralType: PERIPHERAL_TYPE,
	initialHeartbeatTimeout: INITIAL_PERIPHERAL_HEARTBEAT_TIMEOUT_SECONDS,
	log: log,
	utils: utils,
	policy: {
		maxParentDevices: MAX_PARENT_DEVICES,
		networkRetryMs: 5000
	},
	callbacks: {
		getRuntimeContext: () => ({
			isUnhealthy: isUnhealthy,
			mode: boardState.mode,
			activeParentSerial: activeParentSerial
		}),
		isBoardInActiveCall: isBoardInActiveCall,
		getRuntimeBoardInformation: async () => boardServices.getRuntimeCompanionBoardInformation(xapi, getConfiguredCompanionBoardInformation(), log),
		getParentSyncConfig: getParentSyncConfig,
		releaseActiveParentForDeregistration: releaseActiveParentForDeregistration,
		onStateChanged: handleParentRegistrationStateChanged
	}
});

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
		boardCallSyncController.registerCallCountHandler();
		pairedEnvironmentController.registerMediaHandlers();
		await boardCallSyncController.initializeActiveCallCount();
		await initializeUiFeatureMode();
		await standbyCoordinationController.initializeConfig();
		await parentConnectivityController.refresh({ isInterval: false, notifyAvailabilityChange: false });
		boardState = createBoardState(activeParentSerial);
		await applyUiFeatureMode(boardState.mode);
		await standbyCoordinationController.applyMode(boardState.mode);
		if (boardState.mode === 'Paired') {
			await pairedEnvironmentController.enforceInitialMediaState();
		}
		if (isUnhealthy) {
			return;
		}
		await renderSelectDeviceUi();
		await installParentMacrosOnOnlineParents();
		await connectPeripheralToOnlineParents();
		await parentRegistrationController.reconcilePendingDeregistrations();
		parentConnectivityController.start();
		await parentConnectivityController.evaluate();

		companionState.warnIfCredentialsAreStored(parentDevices, log);
		log.info({ Message: 'Custom Campanion initialized', Version: config.version, ActiveParent: boardState.activeParent.name });
	} catch (error) {
		await handleInitializationFailure(error);
	}
}

async function handleInitializationFailure(error) {
	const diagnostic = error.Diagnostic || {};
	isUnhealthy = true;
	await pinModeController.stop();
	parentConnectivityController.stop();
	log.error({
		Message: 'Custom Campanion board initialization stopped',
		Code: diagnostic.Code || error.code || 'CC26-INIT-UNKNOWN',
		Component: diagnostic.Component || 'BoardMain',
		Context: diagnostic.Context || 'Unhandled initialization failure',
		Remediation: diagnostic.Remediation || 'Diagnose the logged xAPI failure, then restart the Macro Runtime.',
		StorageErrorCode: diagnostic.StorageErrorCode,
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

	await applyUnhealthyInfoBlock();
}

async function loadMemoryState() {
	parentDevices = await companionState.readMemoryOrDefault(mem, companionState.PARENT_DEVICES_STORAGE_KEY, [], utils);
	pendingDeregistrations = await companionState.readMemoryOrDefault(mem, companionState.PENDING_DEREGISTRATIONS_STORAGE_KEY, [], utils);
	if (parentDevices.length > MAX_PARENT_DEVICES) {
		parentDevices = parentDevices.slice(0, MAX_PARENT_DEVICES);
		await mem.write(companionState.PARENT_DEVICES_STORAGE_KEY, parentDevices);
		log.warn({ Message: 'Parent device list exceeded maximum and was trimmed', MaxParentDevices: MAX_PARENT_DEVICES });
	}
	activeParentSerial = await companionState.readMemoryOrInitialize(mem, companionState.ACTIVE_PARENT_SERIAL_STORAGE_KEY, companionState.STAND_ALONE_PARENT_SERIAL, utils);
	boardState = createBoardState(activeParentSerial);
	await pinModeController.initialize();
	pairedEnvironmentController.setStandaloneUiFeatureConfig(await companionState.readMemoryOrDefault(mem, companionState.STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY, {}, utils));
	standbyCoordinationController.setStandaloneConfig(await companionState.readMemoryOrDefault(mem, companionState.STANDALONE_STANDBY_CONFIG_STORAGE_KEY, {}, utils));
	parentRegistrationController.setState(parentDevices, pendingDeregistrations);
	await parentRegistrationController.reconcileStoredConflicts();
	const registrationState = parentRegistrationController.getState();
	parentDevices = registrationState.parentDevices;
	pendingDeregistrations = registrationState.pendingDeregistrations;
	parentConnectivityController.setParentDevices(parentDevices, parentDeviceStatus);
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
	if (await parentRegistrationController.handleMessage(message)) {
		return;
	}
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
			await standbyCoordinationController.handleMessage(message);
			break;
		case 'CallSync':
			await boardCallSyncController.handleMessage(message);
			break;
	}
}

async function initializeUiFeatureMode() {
	await pairedEnvironmentController.initializeUiFeatureMode();
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

async function renderSelectDeviceUi() {
	if (isUnhealthy) {
		return;
	}

	try {
		await companionUi.savePanel(xapi, parentDevices, parentDeviceStatus, activeParentSerial, pinModeController.isEnabled());
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

	xapi.Event.UserInterface.Message.Prompt.Cleared.on(event => {
		parentRegistrationController.handlePromptCleared(event).catch(error => {
			utils.softError({ Context: 'Failed to handle prompt cleared event', Event: event, Error: error });
		});
	});

	xapi.Event.UserInterface.Message.TextInput.Response.on(event => {
		handleTextInputResponse(event).catch(error => {
			utils.softError({
				Context: 'Failed to handle UI TextInput response',
				FeedbackId: event && event.FeedbackId ? event.FeedbackId : 'Unknown',
				Error: error
			});
		});
	});

	xapi.Event.UserInterface.Message.TextInput.Clear.on(event => {
		parentRegistrationController.handleTextInputCleared(event);
	});

	xapi.Event.UserInterface.Extensions.Panel.Clicked.on(event => {
		handlePanelClicked(event).catch(error => {
			utils.softError({ Context: 'Failed to handle UI panel click', Event: event, Error: error });
		});
	});

	xapi.Event.UserInterface.Extensions.Event.PageOpened.on(event => {
		pinModeController.handlePageOpened(event);
	});

	xapi.Event.UserInterface.Extensions.Event.PageClosed.on(event => {
		pinModeController.handlePageClosed(event);
	});
}

async function handlePromptResponse(event) {
	if (!event) {
		return;
	}
	if (await pinModeController.handlePromptResponse(event)) {
		return;
	}
	if (await parentRegistrationController.handlePromptResponse(event)) {
		return;
	}
	if (await pairedEnvironmentController.handlePromptResponse(event)) {
		return;
	}
	await standbyCoordinationController.handlePromptResponse(event);
}

async function handleTextInputResponse(event) {
	if (await pinModeController.handleTextInputResponse(event)) {
		return;
	}
	await parentRegistrationController.handleTextInputResponse(event);
}

async function handlePanelClicked(event) {
	if (!event) {
		return;
	}
	if (parentRegistrationController.isProvisioningLocked()) {
		return;
	}
	if (companionUi.isErrorPanel(event.PanelId)) {
		await companionUi.showErrorPrompt(xapi);
		return;
	}
	await pinModeController.handlePanelClicked(event);
}

async function handleWidgetAction(event) {
	if (!event) {
		return;
	}
	if (parentRegistrationController.isProvisioningLocked()) {
		return;
	}
	if (await pinModeController.handleWidgetAction(event)) {
		return;
	}
	if (await parentRegistrationController.handleWidgetAction(event)) {
		return;
	}
	if (event.Type !== 'released' || !companionUi.isSelectDeviceWidget(event.WidgetId)) {
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
	await pairedEnvironmentController.clearRestorePrompt();
	await parentConnectivityController.select(parentDevice);
}

async function completeVerifiedParentSelection(refreshedParentDevice, parentStatus) {
	standbyCoordinationController.clear();
	boardCallSyncController.cancel();
	activeParentSerial = parentStatus.serial;
	boardState = createBoardState(activeParentSerial);
	await companionUi.setSelectedParent(xapi, parentDevices, activeParentSerial);
	await mem.write(companionState.ACTIVE_PARENT_SERIAL_STORAGE_KEY, activeParentSerial);
	await parentConnectivityController.clearInfo();
	await applyUiFeatureMode(boardState.mode);
	await standbyCoordinationController.applyMode(boardState.mode);
	await pairedEnvironmentController.enforceInitialMediaState();
	if (isUnhealthy) {
		return false;
	}
	await standbyCoordinationController.scheduleSelectedParentSync(refreshedParentDevice);
	return true;
}

async function transitionToStandalone(options = {}) {
	const wasPaired = boardState.mode === 'Paired';
	const hadActiveCall = wasPaired && !options.SkipMediaRestore ? await isBoardInActiveCall() : false;

	await parentConnectivityController.cancel(!options.PreserveParentConnectivityInfo);
	boardCallSyncController.cancel();
	standbyCoordinationController.clear();
	activeParentSerial = companionState.STAND_ALONE_PARENT_SERIAL;
	boardState = createBoardState(activeParentSerial);
	await companionUi.setSelectedParent(xapi, parentDevices, activeParentSerial);
	await mem.write(companionState.ACTIVE_PARENT_SERIAL_STORAGE_KEY, activeParentSerial);
	await applyUiFeatureMode(boardState.mode);
	await standbyCoordinationController.applyMode(boardState.mode);

	if (wasPaired && !options.SkipMediaRestore) {
		await pairedEnvironmentController.handleStandaloneRelease(hadActiveCall);
	}

	log.info({ Message: 'Companion board released to StandAlone mode', Reason: options.Reason || 'Unspecified', ActiveCallPreserved: hadActiveCall });
}

async function releaseActiveParentForDeregistration() {
	boardCallSyncController.cancel();
	await boardCallSyncController.disconnectAllCalls();
	await transitionToStandalone({ Reason: 'ParentRoomDeregistration', SkipMediaRestore: true });
	await pairedEnvironmentController.handleStandaloneRelease(false);
}

async function handleParentRegistrationStateChanged(snapshot) {
	parentDevices = snapshot.parentDevices;
	pendingDeregistrations = snapshot.pendingDeregistrations;
	if (snapshot.onlineCandidate) {
		parentDeviceStatus = replaceParentDeviceStatus(parentDeviceStatus, {
			host: snapshot.onlineCandidate.host,
			serial: snapshot.onlineCandidate.serial,
			name: snapshot.onlineCandidate.name,
			online: true,
			lastError: ''
		});
	} else {
		parentDeviceStatus = parentDeviceStatus.filter(status => parentDevices.some(device => device.serial === status.serial || device.host === status.host));
	}
	parentConnectivityController.setParentDevices(parentDevices, parentDeviceStatus);
	boardState = createBoardState(activeParentSerial);
	await renderSelectDeviceUi();
}

function replaceParentDeviceStatus(statuses, replacement) {
	const updated = statuses.slice();
	const index = updated.findIndex(status => status.serial === replacement.serial || status.host === replacement.host);
	if (index >= 0) {
		updated[index] = replacement;
	} else {
		updated.push(replacement);
	}
	return updated;
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

async function handleRequiredMediaFailure(code, context, error) {
	await handleRuntimeHardFailure({
		Code: code,
		Component: 'BoardMain',
		Context: context,
		Remediation: 'Diagnose the logged local xAPI path or command, correct the macro or RoomOS compatibility issue, then restart the Macro Runtime.',
		Error: error
	});
}

async function handleRuntimeHardFailure(diagnostic) {
	if (isUnhealthy) {
		return;
	}

	isUnhealthy = true;
	await pinModeController.stop();
	parentConnectivityController.stop();
	await parentConnectivityController.cancel(false);
	log.error({
		Code: diagnostic.Code || 'CC26-RUNTIME-HARD-ERROR',
		Component: diagnostic.Component || 'BoardMain',
		Context: diagnostic.Context || 'A required runtime operation failed',
		Remediation: diagnostic.Remediation || 'Diagnose the logged failure, then restart the Macro Runtime.',
		StorageErrorCode: diagnostic.StorageErrorCode,
		Error: diagnostic.Error
	});

	try {
		await companionUi.saveErrorPanel(xapi);
	} catch (panelError) {
		log.error({
			Code: 'CC26-RUNTIME-ERROR-PANEL',
			Component: 'CompanionUI',
			Context: 'Failed to install the Companion Unavailable action panel after a required runtime failure',
			Remediation: 'Diagnose UserInterface.Extensions.Panel and restart the Macro Runtime.',
			Error: panelError
		});
	}

	await applyUnhealthyInfoBlock();

	if (await isBoardInActiveCall()) {
		unhealthyReleasePending = boardState.mode === 'Paired';
		await applyUiFeatureMode(boardState.mode);
		return;
	}

	if (boardState.mode === 'Paired') {
		await transitionToStandalone({ Reason: diagnostic.Code || 'RuntimeHardFailure' });
	}
}

async function showSelectedParentOfflinePrompt(parentDevice) {
	const roomName = parentDevice.name || parentDevice.host || 'Selected room';
	await xapi.Command.UserInterface.Message.Prompt.Display({
		Title: 'Room Unavailable',
		Text: `${roomName} is unavailable. This board is now running Stand Alone.`,
		Duration: 10
	});
}

async function applyUiFeatureMode(mode) {
	await pairedEnvironmentController.applyUiFeatureMode(mode);
}

async function applyRuntimeWebWidget() {
	await pairedEnvironmentController.applyRuntimeWebWidget(boardState.mode);
}

async function handleCallCountZeroBoundary() {
	if (isUnhealthy && unhealthyReleasePending) {
		unhealthyReleasePending = false;
		await transitionToStandalone({ Reason: 'UnhealthyCallEnded' });
		return true;
	}
	if (await parentConnectivityController.handleCallEnded()) {
		return true;
	}
	return false;
}

function getXapiValue(value) {
	if (value && typeof value === 'object' && value.Value !== undefined) {
		return value.Value;
	}
	return value;
}

function getRuntimeInfo3Text() {
	return (isUnhealthy ? UNHEALTHY_INFO_TEXT : '') || parentConnectivityController.getInfoText() || boardCallSyncController.getInfoText() || standbyCoordinationController.getInfoText();
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
		Config: getParentSyncConfig(),
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

function getParentSyncConfig() {
	return {
		version: config.version,
		CompanionBoardInformation: config.CompanionBoardInformation,
		httpClient: config.httpClient,
		UserInterface: config.UserInterface
	};
}

async function applyUnhealthyInfoBlock() {
	try {
		await pairedEnvironmentController.applyRuntimeWebWidget(boardState.mode);
	} catch (error) {
		log.warn({
			Code: 'CC26-UNHEALTHY-INFO3',
			Component: 'BoardMain',
			Context: 'Failed to publish the Unhealthy State message to Companion Web Widget Infoblock 3',
			Remediation: 'Use the cc26_error panel and console diagnostic for administrator recovery.',
			Error: error
		});
	}
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
