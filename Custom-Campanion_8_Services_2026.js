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
 * Version:                 1.0.22
 *
 * Description:             Board-local service helpers for the Custom Companion Solution.
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

const UI_FEATURE_CONFIGS = [
	{ key: 'call', path: ['UserInterface', 'Features', 'Call', 'Start'], pairedValue: 'Hidden' },
	{ key: 'share', path: ['UserInterface', 'Features', 'Share', 'Start'], pairedValue: 'Hidden' },
	{ key: 'aiNotes', path: ['UserInterface', 'Features', 'Call', 'AINotes'], pairedValue: 'Hidden' },
	{ key: 'webex', path: ['UserInterface', 'Features', 'Call', 'JoinWebex'], pairedValue: 'Hidden' },
	{ key: 'microsoftTeamsCvi', path: ['UserInterface', 'Features', 'Call', 'JoinMicrosoftTeamsCVI'], pairedValue: 'Hidden' },
	{ key: 'microsoftTeamsDirectGuestJoin', path: ['UserInterface', 'Features', 'Call', 'JoinMicrosoftTeamsDirectGuestJoin'], pairedValue: 'Hidden' },
	{ key: 'googleMeet', path: ['UserInterface', 'Features', 'Call', 'JoinGoogleMeet'], pairedValue: 'Hidden' },
	{ key: 'zoom', path: ['UserInterface', 'Features', 'Call', 'JoinZoom'], pairedValue: 'Hidden' },
	{ key: 'scanToPair', path: ['BYOD', 'QRCodePairing'], pairedValue: 'Disabled' }
];
const STANDBY_CONFIGS = [
	{ key: 'standbyControl', path: ['Standby', 'Control'], pairedValue: 'Off' },
	{ key: 'standbyHalfwakeMode', path: ['Standby', 'Halfwake', 'Mode'], pairedValue: 'Manual' },
	{ key: 'officeHoursEnabled', path: ['Time', 'OfficeHours', 'Enabled'], pairedValue: 'False' }
];

async function installParentMacrosOnOnlineParents(options) {
	const macroPayloads = await getParentInstallMacroPayloads(options.xapi, options.installConfig);

	for (let index = 0; index < options.parentDeviceStatus.length; index++) {
		const status = options.parentDeviceStatus[index];

		if (!status.online) {
			continue;
		}

		const parentDevice = options.findParentDeviceByHost(status.host);
		if (!parentDevice) {
			continue;
		}

		try {
			await options.deviceComms.installParentMacros(options.xapi, parentDevice, macroPayloads, options.installConfig, options.httpClientConfig);
			options.log.info({ Message: 'Parent macro installation completed', Host: parentDevice.host, MacroName: options.installConfig.roomReferenceTargetMacroName });
		} catch (error) {
			options.log.warn({ Message: 'Parent macro installation failed', Host: parentDevice.host, Error: error.code || error.message || 'Unknown parent macro installation error' });
		}
	}
}

async function getParentInstallMacroPayloads(XAPIObject, installConfig) {
	return {
		roomReference: await getLocalMacroContent(XAPIObject, installConfig.roomReferenceSourceMacroName),
		utils: await getLocalMacroContent(XAPIObject, installConfig.utilsMacroName),
		deviceComms: await getLocalMacroContent(XAPIObject, installConfig.deviceCommsMacroName),
		memoryStorage: await getLocalMacroContent(XAPIObject, installConfig.memoryStorageMacroName)
	};
}

async function getLocalMacroContent(XAPIObject, macroName) {
	const response = await XAPIObject.Command.Macros.Macro.Get({ Name: macroName, Content: 'True' });
	const macro = response && response.Macro && response.Macro[0];

	if (!macro || !macro.Content) {
		throw new Error(`Macro content not found for ${macroName}`);
	}

	return macro.Content;
}

async function connectPeripheralToOnlineParents(options) {
	const companionBoardInformation = await getRuntimeCompanionBoardInformation(options.xapi, options.companionBoardInformation, options.log);
	const peripheralInfo = buildCompanionPeripheralInfo(companionBoardInformation, options.configVersion, options.peripheralType);

	for (let index = 0; index < options.parentDeviceStatus.length; index++) {
		const status = options.parentDeviceStatus[index];

		if (!status.online) {
			continue;
		}

		const parentDevice = options.findParentDeviceByHost(status.host);
		if (!parentDevice) {
			continue;
		}

		try {
			const connectResponse = await options.deviceComms.connectPeripheral(options.xapi, parentDevice, peripheralInfo, options.httpClientConfig);
			const heartbeatResponse = await options.deviceComms.sendPeripheralHeartbeat(options.xapi, parentDevice, peripheralInfo.ID, options.initialHeartbeatTimeout, options.httpClientConfig);
			await options.sendParentReadyRequest(parentDevice, companionBoardInformation);
			options.log.info({ Message: 'Companion board peripheral connect HTTP response', Host: parentDevice.host, Response: sanitizeHttpResponse(connectResponse) });
			options.log.info({ Message: 'Companion board initial peripheral heartbeat HTTP response', Host: parentDevice.host, Response: sanitizeHttpResponse(heartbeatResponse), Timeout: options.initialHeartbeatTimeout });
			options.log.info({ Message: 'Companion board peripheral connected to parent', Host: parentDevice.host, PeripheralID: peripheralInfo.ID, Type: peripheralInfo.Type });
		} catch (error) {
			options.log.warn({ Message: 'Companion board peripheral connect failed', Host: parentDevice.host, Error: error.code || error.message || 'Unknown peripheral connect error' });
		}
	}

	return peripheralInfo.ID;
}

async function getRuntimeCompanionBoardInformation(XAPIObject, configuredBoardInformation, log) {
	const boardInformation = configuredBoardInformation || {};
	const productPlatform = await getProductPlatform(XAPIObject, log);
	const serial = await getBoardSerialNumber(XAPIObject, log);
	const macAddress = await getActiveNetworkMacAddress(XAPIObject, log);
	const name = await getBoardName(XAPIObject, log);

	return {
		serial: serial,
		host: boardInformation.host || '',
		username: boardInformation.username || '',
		password: boardInformation.password || '',
		macAddress: macAddress,
		productPlatform: productPlatform,
		name: name
	};
}

async function getProductPlatform(XAPIObject, log) {
	try {
		return await XAPIObject.Status.SystemUnit.ProductPlatform.get();
	} catch (error) {
		log.warn({ Message: 'Failed to fetch ProductPlatform for peripheral name', Error: error.message || error.code || 'Unknown ProductPlatform error' });
		return 'RoomOS Device';
	}
}

async function getBoardSerialNumber(XAPIObject, log) {
	try {
		return await XAPIObject.Status.SystemUnit.Hardware.Module.SerialNumber.get();
	} catch (error) {
		log.warn({ Message: 'Failed to fetch board serial number for peripheral registration', Error: error.message || error.code || 'Unknown serial number error' });
		return '';
	}
}

async function getBoardName(XAPIObject, log) {
	try {
		return await XAPIObject.Status.SystemUnit.BroadcastName.get();
	} catch (error) {
		log.warn({ Message: 'Failed to fetch board name for companion registration', Error: error.message || error.code || 'Unknown board name error' });
		return 'Custom Companion Device 2026';
	}
}

async function getActiveNetworkMacAddress(XAPIObject, log) {
	try {
		const networkStatus = await XAPIObject.Status.Network.get();
		const networkEntries = normalizeNetworkEntries(networkStatus);
		const wifiEntry = networkEntries.find(entry => isWifiConnected(entry) && entry.Wifi && entry.Wifi.MacAddress);

		if (wifiEntry) {
			return wifiEntry.Wifi.MacAddress;
		}

		const ethernetEntry = networkEntries.find(entry => entry.Ethernet && entry.Ethernet.MacAddress);
		if (ethernetEntry) {
			return ethernetEntry.Ethernet.MacAddress;
		}
	} catch (error) {
		log.warn({ Message: 'Failed to fetch network MAC address for peripheral ID', Error: error.message || error.code || 'Unknown network status error' });
	}

	return '';
}

function normalizeNetworkEntries(networkStatus) {
	if (!networkStatus) {
		return [];
	}

	if (Array.isArray(networkStatus)) {
		return networkStatus;
	}

	if (typeof networkStatus === 'object') {
		return Object.keys(networkStatus).map(key => networkStatus[key]);
	}

	return [];
}

function isWifiConnected(networkEntry) {
	if (!networkEntry || !networkEntry.Wifi || !networkEntry.Wifi.Status) {
		return false;
	}

	return networkEntry.Wifi.Status.toLowerCase() !== 'disconnected';
}

function buildCompanionPeripheralInfo(companionBoardInformation, configVersion, peripheralType) {
	return {
		ID: getCompanionPeripheralId(companionBoardInformation),
		Name: companionBoardInformation.name,
		NetworkAddress: companionBoardInformation.host,
		SerialNumber: companionBoardInformation.serial,
		HardwareInfo: companionBoardInformation.productPlatform,
		SoftwareInfo: configVersion,
		Type: peripheralType
	};
}

function getCompanionPeripheralId(companionBoardInformation) {
	return companionBoardInformation.macAddress || companionBoardInformation.serial || companionBoardInformation.host || companionBoardInformation.name;
}

async function ensureStandaloneUiFeatureConfig(options) {
	let hasUpdates = false;
	const standaloneConfig = options.standaloneUiFeatureConfig || {};

	for (let index = 0; index < UI_FEATURE_CONFIGS.length; index++) {
		const feature = UI_FEATURE_CONFIGS[index];

		if (standaloneConfig[feature.key] !== undefined) {
			continue;
		}

		const currentValue = await getUiFeatureConfigValue(options.xapi, feature, options.log);
		if (currentValue !== null) {
			standaloneConfig[feature.key] = currentValue;
			hasUpdates = true;
		}
	}

	if (shouldManageWebWidget(options.userInterfaceConfig) && !shouldRestoreStandaloneWebWidget(options.userInterfaceConfig) && (standaloneConfig.webWidget !== undefined || standaloneConfig.webWidgetUrl !== undefined)) {
		delete standaloneConfig.webWidget;
		delete standaloneConfig.webWidgetUrl;
		hasUpdates = true;
		options.log.info({ Message: 'Removed stale standalone Web Widget restore memory because restoreStandaloneExisting is disabled' });
	}

	if (shouldManageWebWidget(options.userInterfaceConfig) && shouldRestoreStandaloneWebWidget(options.userInterfaceConfig) && options.mode === 'StandAlone' && standaloneConfig.webWidgetUrl === undefined) {
		try {
			const currentWebWidget = await options.companionUi.getCurrentWebWidget(options.xapi);
			standaloneConfig.webWidget = currentWebWidget && !options.companionUi.isCompanionWebWidget(currentWebWidget) ? currentWebWidget : null;
			standaloneConfig.webWidgetUrl = standaloneConfig.webWidget ? standaloneConfig.webWidget.url : '';
			hasUpdates = true;
		} catch (error) {
			options.log.warn({ Message: 'Failed to save original standalone Web Widget URL', Error: error.message || error.code || 'Unknown Web Widget status error' });
		}
	}

	if (hasUpdates) {
		await options.mem.write(options.storageKey, standaloneConfig);
	}

	return standaloneConfig;
}

async function ensureStandaloneStandbyConfig(options) {
	let hasUpdates = false;
	const standaloneConfig = options.standaloneStandbyConfig || {};

	for (let index = 0; index < STANDBY_CONFIGS.length; index++) {
		const standbyConfig = STANDBY_CONFIGS[index];

		if (standaloneConfig[standbyConfig.key] !== undefined) {
			continue;
		}

		const currentValue = await getUiFeatureConfigValue(options.xapi, standbyConfig, options.log);
		if (currentValue !== null) {
			standaloneConfig[standbyConfig.key] = currentValue;
			hasUpdates = true;
		}
	}

	if (hasUpdates) {
		await options.mem.write(options.storageKey, standaloneConfig);
	}

	return standaloneConfig;
}

function registerStandaloneUiFeatureSubscriptions(options) {
	for (let index = 0; index < UI_FEATURE_CONFIGS.length; index++) {
		const feature = UI_FEATURE_CONFIGS[index];
		const node = getXapiConfigNode(options.xapi, feature.path);

		if (!node || typeof node.on !== 'function') {
			options.log.debug({ Message: 'UI feature config subscription unavailable', Feature: feature.key, Path: feature.path.join('.') });
			continue;
		}

		node.on(value => {
			options.onChange(feature, normalizeConfigEventValue(value)).catch(error => {
				options.utils.softError({ Context: 'Failed to save standalone UI feature config change', Feature: feature.key, Error: error });
			});
		});
	}
}

function registerStandaloneStandbySubscriptions(options) {
	for (let index = 0; index < STANDBY_CONFIGS.length; index++) {
		const standbyConfig = STANDBY_CONFIGS[index];
		const node = getXapiConfigNode(options.xapi, standbyConfig.path);

		if (!node || typeof node.on !== 'function') {
			options.log.debug({ Message: 'Standby config subscription unavailable', Feature: standbyConfig.key, Path: standbyConfig.path.join('.') });
			continue;
		}

		node.on(value => {
			options.onChange(standbyConfig, normalizeConfigEventValue(value)).catch(error => {
				options.utils.softError({ Context: 'Failed to save standalone standby config change', Feature: standbyConfig.key, Error: error });
			});
		});
	}
}

async function applyUiFeatureMode(options) {
	for (let index = 0; index < UI_FEATURE_CONFIGS.length; index++) {
		const feature = UI_FEATURE_CONFIGS[index];
		const value = options.mode === 'StandAlone' ? options.standaloneUiFeatureConfig[feature.key] : feature.pairedValue;

		if (value === undefined || value === null) {
			continue;
		}

		await setUiFeatureConfigValue(options.xapi, feature, value, options.log);
	}

	await applyWebWidgetMode(options);
}

async function applyStandbyMode(options) {
	for (let index = 0; index < STANDBY_CONFIGS.length; index++) {
		const standbyConfig = STANDBY_CONFIGS[index];
		const value = options.mode === 'StandAlone' ? options.standaloneStandbyConfig[standbyConfig.key] : standbyConfig.pairedValue;

		if (value === undefined || value === null) {
			continue;
		}

		await setUiFeatureConfigValue(options.xapi, standbyConfig, value, options.log);
	}
}

async function applyStandbySyncState(options) {
	const state = options.state;

	switch (state) {
		case 'Off':
			await options.xapi.Command.Standby.Deactivate();
			break;
		case 'Standby':
			await options.xapi.Command.Standby.Activate();
			break;
		case 'Halfwake':
			await options.xapi.Command.Standby.Halfwake();
			break;
		case 'EnteringStandby':
			options.log.debug({ Message: 'Ignored parent standby transition state', State: state });
			break;
		default:
			options.log.warn({ Message: 'Unknown parent standby state ignored', State: state });
	}
}

async function joinParentCall(options) {
	const payload = options.payload || {};
	const remoteNumber = payload.RemoteNumber || '';
	const meetingPlatform = String(payload.MeetingPlatform || '').toLowerCase();
	const protocol = String(payload.Protocol || '').toLowerCase();

	if (!remoteNumber) {
		throw new Error('Cannot join parent call without RemoteNumber');
	}

	const zoomMeetingInfo = parseZoomJoinTarget(remoteNumber);
	if (zoomMeetingInfo) {
		try {
			return await options.xapi.Command.Zoom.Join(zoomMeetingInfo);
		} catch (error) {
			if (isZoomMeetingIdTooShortError(error)) {
				options.log.warn({ Message: 'Zoom MeetingID too short; falling back to Dial', RemoteNumber: remoteNumber, Error: error.message || error.code || 'Unknown Zoom join error' });
				return dialParentCall(options, remoteNumber, 'sip');
			}

			throw error;
		}
	}

	if (meetingPlatform.indexOf('zoom') >= 0) {
		throw new Error(`Zoom call sync missing a parsable Zoom SIP address: ${remoteNumber}`);
	}

	if (meetingPlatform.indexOf('webex') >= 0 || protocol === 'spark') {
		return options.xapi.Command.Webex.Join({ Number: remoteNumber, TrackingData: 'CustomCompanion2026' });
	}

	if (meetingPlatform.indexOf('google') >= 0) {
		return options.xapi.Command.WebRTC.Join({ Type: 'GoogleMeet', Url: remoteNumber, TrackingData: 'CustomCompanion2026' });
	}

	if (meetingPlatform.indexOf('microsoft') >= 0 || meetingPlatform.indexOf('teams') >= 0) {
		return options.xapi.Command.MicrosoftTeams.Join({ Url: remoteNumber, TrackingData: 'CustomCompanion2026' });
	}

	return dialParentCall(options, remoteNumber, protocol);
}

async function disconnectAllCalls(options) {
	try {
		const calls = normalizeCallStatusList(await options.xapi.Status.Call.get());
		if (calls.length < 1) {
			options.log.info({ Message: 'Companion board has no active calls to disconnect' });
			return;
		}

		for (let index = 0; index < calls.length; index++) {
			const callId = calls[index].CallId || calls[index].id;
			if (callId === undefined || callId === '') {
				await options.xapi.Command.Call.Disconnect();
			} else {
				await options.xapi.Command.Call.Disconnect({ CallId: Number(callId) });
			}
		}

		options.log.info({ Message: 'Companion board disconnected all calls', CallCount: calls.length });
	} catch (error) {
		options.log.warn({ Message: 'Companion board call disconnect failed', Error: error.message || error.code || 'Unknown disconnect error' });
		await options.xapi.Command.Call.Disconnect();
	}
}

function normalizeCallStatusList(callStatus) {
	if (!callStatus) {
		return [];
	}
	if (Array.isArray(callStatus)) {
		return callStatus;
	}
	if (Array.isArray(callStatus.Call)) {
		return callStatus.Call;
	}
	if (callStatus.CallId !== undefined || callStatus.id !== undefined) {
		return [callStatus];
	}

	const calls = [];
	const keys = Object.keys(callStatus);
	for (let index = 0; index < keys.length; index++) {
		if (callStatus[keys[index]] && typeof callStatus[keys[index]] === 'object') {
			calls.push(callStatus[keys[index]]);
		}
	}

	return calls;
}

function dialParentCall(options, remoteNumber, protocol) {
	const normalizedProtocol = String(protocol || '').toLowerCase();
	const dialParameters = { Number: remoteNumber, CallType: 'Video', TrackingData: 'CustomCompanion2026' };
	if (normalizedProtocol === 'sip') {
		dialParameters.Protocol = 'Sip';
	} else if (normalizedProtocol === 'h323') {
		dialParameters.Protocol = 'H323';
	} else if (normalizedProtocol === 'spark') {
		dialParameters.Protocol = 'Spark';
	}

	return options.xapi.Command.Dial(dialParameters);
}

function isZoomMeetingIdTooShortError(error) {
	const message = String((error && error.message) || '').toLowerCase();
	return message.indexOf('meetingid') >= 0 && message.indexOf('too short') >= 0;
}

function parseZoomJoinTarget(remoteNumber) {
	return parseZoomMeetingUrl(remoteNumber) || parseZoomSipAddress(remoteNumber);
}

function parseZoomMeetingUrl(remoteNumber) {
	const value = String(remoteNumber || '').trim();
	const lowerValue = value.toLowerCase();
	if (lowerValue.indexOf('zoom.') < 0 || lowerValue.indexOf('/j/') < 0) {
		return null;
	}

	const meetingIdMatch = value.match(/\/j\/([0-9]{1,40})/i);
	if (!meetingIdMatch || !meetingIdMatch[1]) {
		throw new Error(`Zoom Meeting ID failed parsing from ${remoteNumber}`);
	}

	return {
		MeetingID: meetingIdMatch[1],
		TrackingData: 'CustomCompanion2026'
	};
}

function parseZoomSipAddress(remoteNumber) {
	const splitNumber = String(remoteNumber || '').split('@');
	const meetingInfo = splitNumber[0] || '';
	const domain = splitNumber[1] || '';

	if (domain.toLowerCase().indexOf('zoom') < 0) {
		return null;
	}
	if (meetingInfo.indexOf('.') < 0) {
		if (!/^[0-9]{1,40}$/.test(meetingInfo)) {
			throw new Error(`Zoom Meeting ID failed parsing from ${remoteNumber}`);
		}

		return {
			MeetingID: meetingInfo,
			Domain: domain,
			TrackingData: 'CustomCompanion2026'
		};
	}

	const splitMeeting = meetingInfo.split('.');
	const parsedMeetingInfo = {
		meetingID: splitMeeting[0] || '',
		passcode: splitMeeting[1] || '',
		command: splitMeeting[2] || '',
		hostKey: splitMeeting[3] || '',
		reserved: splitMeeting[4] || '',
		dialCode: splitMeeting[5] || ''
	};
	const zoomValidators = {
		meetingID: /^[0-9]{1,40}$/,
		passcode: /^[0-9a-zA-Z].*\b/,
		command: /^[0-9].*\b/,
		hostKey: /^[0-9]{6}\b/,
		reserved: /^[0-9a-zA-Z].*\b/,
		dialCode: /^[0-9a-zA-Z].*\b/
	};

	if (!zoomValidators.meetingID.test(parsedMeetingInfo.meetingID)) {
		throw new Error(`Zoom Meeting ID failed parsing from ${remoteNumber}`);
	}
	if (parsedMeetingInfo.passcode && !zoomValidators.passcode.test(parsedMeetingInfo.passcode)) {
		throw new Error(`Zoom passcode failed parsing from ${remoteNumber}`);
	}
	if (parsedMeetingInfo.command && !zoomValidators.command.test(parsedMeetingInfo.command)) {
		throw new Error(`Zoom command failed parsing from ${remoteNumber}`);
	}
	if (parsedMeetingInfo.hostKey && !zoomValidators.hostKey.test(parsedMeetingInfo.hostKey)) {
		throw new Error(`Zoom host key failed parsing from ${remoteNumber}`);
	}
	if (parsedMeetingInfo.reserved && !zoomValidators.reserved.test(parsedMeetingInfo.reserved)) {
		throw new Error(`Zoom reserved code failed parsing from ${remoteNumber}`);
	}
	if (parsedMeetingInfo.dialCode && !zoomValidators.dialCode.test(parsedMeetingInfo.dialCode)) {
		throw new Error(`Zoom dial code failed parsing from ${remoteNumber}`);
	}

	const zoomJoinParameters = {
		MeetingID: parsedMeetingInfo.meetingID,
		Domain: domain,
		TrackingData: 'CustomCompanion2026'
	};
	if (parsedMeetingInfo.passcode) {
		zoomJoinParameters.MeetingPasscode = parsedMeetingInfo.passcode;
	}
	if (parsedMeetingInfo.hostKey) {
		zoomJoinParameters.HostKey = parsedMeetingInfo.hostKey;
	}
	if (parsedMeetingInfo.dialCode) {
		zoomJoinParameters.DialCode = parsedMeetingInfo.dialCode;
	}

	return zoomJoinParameters;
}

async function applyWebWidgetMode(options) {
	if (!shouldManageWebWidget(options.userInterfaceConfig)) {
		return;
	}

	const webWidgetConfig = options.userInterfaceConfig.WebWidget || {};
	const companionWidgetConfig = webWidgetConfig.CompanionWidget || {};
	const standaloneWebWidget = getStandaloneWebWidget(options.standaloneUiFeatureConfig);
	const shouldRestoreExistingWebWidget = !!(companionWidgetConfig.restoreStandaloneExisting && options.mode === 'StandAlone' && standaloneWebWidget && standaloneWebWidget.url);
	const url = shouldRestoreExistingWebWidget ? standaloneWebWidget.url : options.companionUi.buildCompanionWebWidgetUrl({
		mode: options.mode,
		roomName: options.activeParentName,
		themeName: options.themeName,
		urlOverride: webWidgetConfig.urlOverride,
		runtimeInfo3: options.runtimeInfo3,
		webWidgetConfig: companionWidgetConfig
	});

	try {
		options.log.info({ Message: 'Companion Web Widget URL computed', Mode: options.mode, RestoreExistingWebWidget: !!shouldRestoreExistingWebWidget, UrlOverrideUsed: !!webWidgetConfig.urlOverride, Url: url });
		if (shouldRestoreExistingWebWidget) {
			await options.companionUi.removeCompanionWebWidget(options.xapi);
			await options.companionUi.saveWebWidget(options.xapi, standaloneWebWidget);
		} else {
			await options.companionUi.saveCompanionWebWidget(options.xapi, url);
		}
		options.log.info({ Message: 'Companion Web Widget mode applied', Mode: options.mode, RestoredStandaloneWidget: !!shouldRestoreExistingWebWidget, UrlLength: url.length });
	} catch (error) {
		options.log.warn({ Message: 'Failed to apply Companion Web Widget mode', Mode: options.mode, Error: error.message || error.code || 'Unknown Web Widget error' });
	}
}

function shouldRestoreStandaloneWebWidget(userInterfaceConfig) {
	return !!(userInterfaceConfig && userInterfaceConfig.WebWidget && userInterfaceConfig.WebWidget.CompanionWidget && userInterfaceConfig.WebWidget.CompanionWidget.restoreStandaloneExisting);
}

function getStandaloneWebWidget(standaloneUiFeatureConfig) {
	const config = standaloneUiFeatureConfig || {};
	if (config.webWidget && config.webWidget.url) {
		return config.webWidget;
	}

	if (config.webWidgetUrl) {
		return {
			url: config.webWidgetUrl,
			name: 'Web Widget',
			panelId: 'cc26OriginalWebWidget',
			refreshInterval: 0
		};
	}

	return null;
}

function shouldManageWebWidget(userInterfaceConfig) {
	return !!(userInterfaceConfig && userInterfaceConfig.WebWidget && userInterfaceConfig.WebWidget.CompanionWidget && userInterfaceConfig.WebWidget.CompanionWidget.enabled);
}

async function getUserInterfaceThemeName(options) {
	try {
		return await options.xapi.Config.UserInterface.Theme.Name.get();
	} catch (error) {
		options.log.warn({ Message: 'Failed to fetch UserInterface Theme Name', Error: error.message || error.code || 'Unknown theme get error' });
		return 'EveningFjord';
	}
}

function registerUserInterfaceThemeSubscription(options) {
	const node = getXapiConfigNode(options.xapi, ['UserInterface', 'Theme', 'Name']);
	if (!node || typeof node.on !== 'function') {
		options.log.debug({ Message: 'UserInterface Theme Name subscription unavailable' });
		return;
	}

	node.on(value => {
		options.onChange(normalizeConfigEventValue(value)).catch(error => {
			options.utils.softError({ Context: 'Failed to apply UserInterface theme change', Error: error });
		});
	});
}

async function getUiFeatureConfigValue(XAPIObject, feature, log) {
	const node = getXapiConfigNode(XAPIObject, feature.path);

	if (!node || typeof node.get !== 'function') {
		log.debug({ Message: 'UI feature config get unavailable', Feature: feature.key, Path: feature.path.join('.') });
		return null;
	}

	try {
		return await node.get();
	} catch (error) {
		log.debug({ Message: 'UI feature config get failed', Feature: feature.key, Path: feature.path.join('.'), Error: error.message || error.code || 'Unknown get error' });
		return null;
	}
}

async function setUiFeatureConfigValue(XAPIObject, feature, value, log) {
	const node = getXapiConfigNode(XAPIObject, feature.path);

	if (!node || typeof node.set !== 'function') {
		log.debug({ Message: 'UI feature config set unavailable', Feature: feature.key, Path: feature.path.join('.') });
		return;
	}

	try {
		await node.set(value);
	} catch (error) {
		log.warn({ Message: 'UI feature config set failed', Feature: feature.key, Path: feature.path.join('.'), Value: value, Error: error.message || error.code || 'Unknown set error' });
	}
}

function getXapiConfigNode(XAPIObject, path) {
	let node = XAPIObject.Config;

	for (let index = 0; index < path.length; index++) {
		if (!node || node[path[index]] === undefined) {
			return null;
		}
		node = node[path[index]];
	}

	return node;
}

function normalizeConfigEventValue(value) {
	if (value && typeof value === 'object' && value.Value !== undefined) {
		return value.Value;
	}

	return value;
}

function sanitizeHttpResponse(response) {
	if (!response || typeof response !== 'object') {
		return response;
	}

	return {
		StatusCode: response.StatusCode,
		ReasonPhrase: response.ReasonPhrase,
		Body: response.Body
	};
}

const boardServices = {
	installParentMacrosOnOnlineParents,
	connectPeripheralToOnlineParents,
	getRuntimeCompanionBoardInformation,
	getCompanionPeripheralId,
	ensureStandaloneUiFeatureConfig,
	ensureStandaloneStandbyConfig,
	registerStandaloneUiFeatureSubscriptions,
	registerStandaloneStandbySubscriptions,
	getUserInterfaceThemeName,
	registerUserInterfaceThemeSubscription,
	applyUiFeatureMode,
	applyStandbyMode,
	applyStandbySyncState,
	disconnectAllCalls,
	joinParentCall,
	sanitizeHttpResponse
};

export { boardServices };
