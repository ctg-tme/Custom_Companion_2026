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
 * Version:                 1.0.20
 *
 * Description:             Companion access/hidden panels, PIN/registration/status prompts, and WebWidget adapter.
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

const LEGACY_PANEL_ID = 'cc26';
const ACCESS_PANEL_ID = 'cc26_access';
const PANEL_ID = 'cc26_hidden';
const ERROR_PANEL_ID = 'cc26_error';
const ERROR_PROMPT_ID = 'cc26_error_prompt';
const SELECT_DEVICE_PAGE_ID = `${PANEL_ID}~SelectDevice`;
const CONFIG_PAGE_ID = `${PANEL_ID}~Config`;
const RELEASE_DEVICE_WIDGET_ID = `${SELECT_DEVICE_PAGE_ID}~ReleaseDevice`;
const RELEASE_INFO_WIDGET_ID = `${SELECT_DEVICE_PAGE_ID}~ReleaseInfo`;
const NO_PARENTS_FOUND_WIDGET_ID = `${SELECT_DEVICE_PAGE_ID}~NoParentsFound`;
const PIN_OFF_WIDGET_ID = `${CONFIG_PAGE_ID}~PinOff`;
const PIN_ON_WIDGET_ID = `${CONFIG_PAGE_ID}~PinOn`;
const PIN_EDIT_WIDGET_ID = `${CONFIG_PAGE_ID}~PinEdit`;
const PIN_INFO_WIDGET_ID = `${CONFIG_PAGE_ID}~PinInfo`;
const PAIR_NEW_ROOM_WIDGET_ID = `${CONFIG_PAGE_ID}~PairNewDevice`;
const PAIRING_INFO_WIDGET_ID = `${CONFIG_PAGE_ID}~PairingInfo`;
const RELEASE_INFO_TEXT = 'Select a room to pair this companion board to that room system. Use Stand Alone to unpair and restore normal local use.';
const WEB_WIDGET_PANEL_ID = 'cc26WebWidget';
const WEB_WIDGET_NAME = 'Custom Companion 2026';
const WEB_WIDGET_REFRESH_INTERVAL = 0;
const WEB_WIDGET_DEFAULT_URL = 'https://ctg-tme.github.io/Simple-WebWidget/';

/*
 * UI xAPI surface:
 * - Commands: UserInterface.Extensions.Panel.Save/Remove/Open/Close, Widget.SetValue,
 *   UserInterface.Message.TextInput.Display/Clear, UserInterface.Message.Prompt.Display/Clear,
 *   and Extensions.WebWidget.Save/Remove.
 * - Read: Status.UserInterface.WebView.
 * Event subscriptions remain explicit in the board entry macro because it owns event routing.
 */

function buildErrorPanelXml() {
	return `<Extensions>
	<Version>1.11</Version>
	<Panel>
		<Order>4</Order>
		<PanelId>${ERROR_PANEL_ID}</PanelId>
		<Origin>local</Origin>
		<Location>HomeScreen</Location>
		<Icon>Input</Icon>
		<Color>#6B7280</Color>
		<Name>Companion Unavailable</Name>
		<ActivityType>Custom</ActivityType>
	</Panel>
</Extensions>`;
}

function buildAccessPanelXml() {
	return `<Extensions>
	<Version>1.11</Version>
	<Panel>
		<Order>4</Order>
		<PanelId>${ACCESS_PANEL_ID}</PanelId>
		<Origin>local</Origin>
		<Location>HomeScreenAndCallControls</Location>
		<Icon>Input</Icon>
		<Color>#875AE0</Color>
		<Name>Companion Device Select</Name>
		<ActivityType>Custom</ActivityType>
	</Panel>
</Extensions>`;
}

function buildPanelXml(parentDevices, parentDeviceStatus, activeParentSerial) {
	const parentRowsXml = buildParentRowsXml(parentDevices, parentDeviceStatus);

	return `<Extensions>
	<Version>1.11</Version>
	<Panel>
		<Order>4</Order>
		<PanelId>${PANEL_ID}</PanelId>
		<Origin>local</Origin>
		<Location>Hidden</Location>
		<Icon>Input</Icon>
		<Color>#875AE0</Color>
		<Name>Companion Device Select</Name>
		<ActivityType>Custom</ActivityType>
		<Page>
			<Name>Select Device</Name>
			<Row>
				<Name>Run as Stand Alone Device</Name>
				<Widget>
					<WidgetId>${RELEASE_DEVICE_WIDGET_ID}</WidgetId>
					<Name>Run Stand Alone</Name>
					<Type>Button</Type>
					<Options>size=3</Options>
				</Widget>
				<Widget>
					<WidgetId>${RELEASE_INFO_WIDGET_ID}</WidgetId>
					<Type>Button</Type>
					<Options>size=1;icon=help</Options>
				</Widget>
			</Row>
			${parentRowsXml}
			<PageId>${SELECT_DEVICE_PAGE_ID}</PageId>
			<Options/>
		</Page>
		<Page>
			<Name>Config</Name>
			<Row>
				<Name>Pin Mode</Name>
				<Widget>
					<WidgetId>${PIN_OFF_WIDGET_ID}</WidgetId>
					<Name>Off</Name>
					<Type>Button</Type>
					<Options>size=1</Options>
				</Widget>
				<Widget>
					<WidgetId>${PIN_ON_WIDGET_ID}</WidgetId>
					<Name>On</Name>
					<Type>Button</Type>
					<Options>size=1</Options>
				</Widget>
				<Widget>
					<WidgetId>${PIN_EDIT_WIDGET_ID}</WidgetId>
					<Name>Edit</Name>
					<Type>Button</Type>
					<Options>size=1</Options>
				</Widget>
				<Widget>
					<WidgetId>${PIN_INFO_WIDGET_ID}</WidgetId>
					<Type>Button</Type>
					<Options>size=1;icon=help</Options>
				</Widget>
			</Row>
			<Row>
				<Name>Pair New Room</Name>
				<Widget>
					<WidgetId>${PAIR_NEW_ROOM_WIDGET_ID}</WidgetId>
					<Name>Start Room Pairing Process</Name>
					<Type>Button</Type>
					<Options>size=3</Options>
				</Widget>
				<Widget>
					<WidgetId>${PAIRING_INFO_WIDGET_ID}</WidgetId>
					<Type>Button</Type>
					<Options>size=1;icon=help</Options>
				</Widget>
			</Row>
			<PageId>${CONFIG_PAGE_ID}</PageId>
			<Options/>
		</Page>
	</Panel>
</Extensions>`;
}

function buildParentRowsXml(parentDevices, parentDeviceStatus) {
	if (!parentDevices.length) {
		return `<Row>
				<Name>Select a Room</Name>
				<Widget>
					<WidgetId>${NO_PARENTS_FOUND_WIDGET_ID}</WidgetId>
					<Name>Rooms are not configured for this Companion device. Navigate to the Config page to setup a new Room</Name>
					<Type>Text</Type>
					<Options>size=4;fontSize=normal;align=center</Options>
				</Widget>
			</Row>`;
	}

	return `<Row>
				<Name>Select a Room</Name>
				${parentDevices.map((parentDevice, index) => buildParentWidgetXml(parentDevice, getParentStatus(parentDevice, parentDeviceStatus), index)).join('')}
			</Row>`;
}

function buildParentWidgetXml(parentDevice, parentStatus, index) {
	const parentName = parentDevice.name || parentDevice.host || `Parent ${index + 1}`;
	const offlineWidgetId = `${SELECT_DEVICE_PAGE_ID}~ParentOffline~${index}`;
	const selectWidgetId = `${SELECT_DEVICE_PAGE_ID}~ParentSelect~${index}`;

	if (!parentStatus || !parentStatus.online) {
		return `<Widget>
					<WidgetId>${offlineWidgetId}</WidgetId>
					<Name>${escapeXml(parentName)} Offline</Name>
					<Type>Button</Type>
					<Options>size=4</Options>
				</Widget>`;
	}

	return `<Widget>
					<WidgetId>${selectWidgetId}</WidgetId>
					<Name>${escapeXml(parentName)}</Name>
					<Type>Button</Type>
					<Options>size=4</Options>
				</Widget>`;
}

async function savePanel(XAPIObject, parentDevices, parentDeviceStatus, activeParentSerial, pinModeEnabled) {
	await removePanel(XAPIObject, ERROR_PANEL_ID);
	await removePanel(XAPIObject, LEGACY_PANEL_ID);
	await XAPIObject.Command.UserInterface.Extensions.Panel.Save({ PanelId: ACCESS_PANEL_ID }, buildAccessPanelXml());
	await XAPIObject.Command.UserInterface.Extensions.Panel.Save({ PanelId: PANEL_ID }, buildPanelXml(parentDevices, parentDeviceStatus, activeParentSerial));
	await setSelectedParent(XAPIObject, parentDevices, activeParentSerial);
	await setPinModeFeedback(XAPIObject, pinModeEnabled);
}

async function saveErrorPanel(XAPIObject) {
	await removePanel(XAPIObject, LEGACY_PANEL_ID);
	await removePanel(XAPIObject, ACCESS_PANEL_ID);
	await removePanel(XAPIObject, PANEL_ID);
	await XAPIObject.Command.UserInterface.Extensions.Panel.Save({ PanelId: ERROR_PANEL_ID }, buildErrorPanelXml());
}

async function removeErrorPanel(XAPIObject) {
	await removePanel(XAPIObject, ERROR_PANEL_ID);
}

async function removePanel(XAPIObject, panelId) {
	try {
		await XAPIObject.Command.UserInterface.Extensions.Panel.Remove({ PanelId: panelId });
	} catch (error) {
		// Removing an absent panel is an expected idempotent operation.
	}
}

function isErrorPanel(panelId) {
	return String(panelId || '') === ERROR_PANEL_ID;
}

function isAccessPanel(panelId) {
	return String(panelId || '') === ACCESS_PANEL_ID;
}

async function openProtectedPanel(XAPIObject) {
	await XAPIObject.Command.UserInterface.Extensions.Panel.Open({ PanelId: PANEL_ID });
}

async function closeProtectedPanel(XAPIObject) {
	await XAPIObject.Command.UserInterface.Extensions.Panel.Close();
}

async function showPinTextInput(XAPIObject, options) {
	await XAPIObject.Command.UserInterface.Message.TextInput.Display({
		Title: options.title,
		Text: options.text,
		FeedbackId: options.feedbackId,
		InputType: 'PIN',
		Placeholder: 'Enter a 4-8 digit PIN',
		SubmitText: options.submitText,
		Duration: options.duration
	});
}

async function clearPinTextInput(XAPIObject, feedbackId) {
	try {
		await XAPIObject.Command.UserInterface.Message.TextInput.Clear({ FeedbackId: feedbackId });
	} catch (error) {
		// Clearing an already dismissed or expired TextInput is an expected idempotent operation.
	}
}

async function showPinNotice(XAPIObject, options) {
	await XAPIObject.Command.UserInterface.Message.Prompt.Display({
		Title: options.title,
		Text: options.text,
		FeedbackId: options.feedbackId,
		'Option.1': 'Dismiss',
		Duration: options.duration
	});
}

async function showCompanionTextInput(XAPIObject, options) {
	await XAPIObject.Command.UserInterface.Message.TextInput.Display({
		Title: options.title,
		Text: options.text,
		FeedbackId: options.feedbackId,
		InputType: options.inputType || 'SingleLine',
		Placeholder: options.placeholder || '',
		SubmitText: options.submitText || 'Next',
		Duration: options.duration
	});
}

async function clearCompanionTextInput(XAPIObject, feedbackId) {
	try {
		await XAPIObject.Command.UserInterface.Message.TextInput.Clear({ FeedbackId: feedbackId });
	} catch (error) {
		// Clearing an absent or expired TextInput is an expected idempotent operation.
	}
}

async function showCompanionPrompt(XAPIObject, options) {
	const command = {
		Title: options.title,
		Text: options.text,
		FeedbackId: options.feedbackId,
		Duration: options.duration
	};
	const promptOptions = options.options || [];
	for (let index = 0; index < promptOptions.length; index++) {
		command[`Option.${index + 1}`] = promptOptions[index];
	}
	await XAPIObject.Command.UserInterface.Message.Prompt.Display(command);
}

async function showErrorPrompt(XAPIObject) {
	await XAPIObject.Command.UserInterface.Message.Prompt.Display({
		Title: 'Companion Unavailable',
		Text: 'Contact a Device Administrator.',
		FeedbackId: ERROR_PROMPT_ID,
		'Option.1': 'Dismiss',
		Duration: 30
	});
}

async function setSelectedParent(XAPIObject, parentDevices, activeParentSerial) {
	await setWidgetValue(XAPIObject, RELEASE_DEVICE_WIDGET_ID, activeParentSerial === 'StandAlone' ? 'active' : 'inactive');

	for (let index = 0; index < parentDevices.length; index++) {
		const widgetId = `${SELECT_DEVICE_PAGE_ID}~ParentSelect~${index}`;
		const isActive = parentDevices[index].serial === activeParentSerial;
		await setWidgetValue(XAPIObject, widgetId, isActive ? 'active' : 'inactive');
	}
}

async function setPinModeFeedback(XAPIObject, enabled) {
	await setWidgetValue(XAPIObject, PIN_OFF_WIDGET_ID, enabled ? 'inactive' : 'active');
	await setWidgetValue(XAPIObject, PIN_ON_WIDGET_ID, enabled ? 'active' : 'inactive');
}

async function setWidgetValue(XAPIObject, widgetId, value) {
	try {
		await XAPIObject.Command.UserInterface.Extensions.Widget.SetValue({ WidgetId: widgetId, Value: value });
	} catch (error) {
		// Widgets for offline parents are intentionally absent from the active panel.
	}
}

async function showReleaseInfo(XAPIObject) {
	await XAPIObject.Command.UserInterface.Message.Prompt.Display({
		Title: 'Companion Device Select',
		Text: RELEASE_INFO_TEXT,
		Duration: 10
	});
}

async function getCurrentWebWidget(XAPIObject) {
	const webViews = normalizeWebViews(await XAPIObject.Status.UserInterface.WebView.get());
	const webWidget = webViews.find(view => String(view.Type || view.Mode || '').toLowerCase() === 'webwidget');

	return webWidget ? normalizeWebWidget(webWidget) : null;
}

async function saveWebWidget(XAPIObject, webWidget) {
	if (!webWidget || !webWidget.url) {
		return;
	}

	await XAPIObject.Command.UserInterface.Extensions.WebWidget.Save({
		Name: webWidget.name || WEB_WIDGET_NAME,
		PanelId: webWidget.panelId || WEB_WIDGET_PANEL_ID,
		RefreshInterval: webWidget.refreshInterval === undefined ? WEB_WIDGET_REFRESH_INTERVAL : webWidget.refreshInterval,
		URL: webWidget.url
	});
}

async function saveCompanionWebWidget(XAPIObject, url) {
	await saveWebWidget(XAPIObject, {
		panelId: WEB_WIDGET_PANEL_ID,
		name: WEB_WIDGET_NAME,
		refreshInterval: WEB_WIDGET_REFRESH_INTERVAL,
		url: url
	});
}

async function removeWebWidget(XAPIObject, panelId) {
	if (!panelId) {
		return;
	}

	try {
		await XAPIObject.Command.UserInterface.Extensions.WebWidget.Remove({ PanelId: panelId });
	} catch (error) {
		return;
	}
}

async function removeCompanionWebWidget(XAPIObject) {
	await removeWebWidget(XAPIObject, WEB_WIDGET_PANEL_ID);
}

function isCompanionWebWidget(webWidget) {
	return !!(webWidget && webWidget.panelId === WEB_WIDGET_PANEL_ID);
}

function buildCompanionWebWidgetUrl(options) {
	const webWidgetConfig = options.webWidgetConfig || {};
	const contextConfig = options.mode === 'StandAlone' ? webWidgetConfig.standalone || {} : webWidgetConfig.paired || {};
	const params = {
		theme: options.themeName || 'EveningFjord',
		heading: 'Custom Companion 2026',
		info1: options.mode === 'StandAlone' ? 'Operating in Standalone' : `Paired to Room:\n${options.roomName || 'Unknown Room'}`,
		info2: contextConfig.info2 || '',
		info3: options.runtimeInfo3 || '',
		iconUrl: contextConfig.iconUrl || ''
	};

	const weatherConfig = webWidgetConfig.weather || {};
	const timeConfig = webWidgetConfig.time || {};

	if (weatherConfig.mode) {
		params.weather = 'true';
		params.latitude = weatherConfig.latitude || '';
		params.longitude = weatherConfig.longitude || '';
		params.temperatureUnit = weatherConfig.temperatureUnit || '';
	}

	if (timeConfig.mode) {
		params.time = 'true';
	}

	if (timeConfig.timeZone) {
		params.timeZone = timeConfig.timeZone;
	}

	params.hideSettings = 'true';

	return `${getWebWidgetBaseUrl(options.urlOverride)}#${buildHashParams(params)}`;
}

async function showStandbySyncPrompt(XAPIObject, options) {
	await XAPIObject.Command.UserInterface.Message.Prompt.Display({
		Title: 'Room Standby Sync',
		Text: `The room is currently in ${options.state}. This board will match it in ${options.remainingSeconds} seconds.`,
		FeedbackId: options.feedbackId,
		'Option.1': 'Bypass 5 min',
		'Option.2': 'Bypass 30 min',
		'Option.3': 'Dismiss',
		Duration: 0
	});
}

async function clearPrompt(XAPIObject, feedbackId) {
	try {
		await XAPIObject.Command.UserInterface.Message.Prompt.Clear({ FeedbackId: feedbackId });
	} catch (error) {
		return;
	}
}

function getWebWidgetBaseUrl(configuredUrl) {
	return String(configuredUrl || WEB_WIDGET_DEFAULT_URL).split('#')[0];
}

function buildHashParams(params) {
	const hashParts = [];
	const keys = Object.keys(params);

	for (let index = 0; index < keys.length; index++) {
		const key = keys[index];
		if (params[key] === undefined || params[key] === null || params[key] === '') {
			continue;
		}
		hashParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
	}

	return hashParts.join('&');
}

function normalizeWebViews(webViewStatus) {
	if (!webViewStatus) {
		return [];
	}

	if (Array.isArray(webViewStatus)) {
		return webViewStatus;
	}

	if (Array.isArray(webViewStatus.WebView)) {
		return webViewStatus.WebView;
	}

	if (typeof webViewStatus === 'object') {
		return Object.keys(webViewStatus).map(key => webViewStatus[key]);
	}

	return [];
}

function normalizeWebWidget(webWidget) {
	return {
		panelId: webWidget.PanelId || webWidget.PanelID || webWidget.Id || webWidget.ID || WEB_WIDGET_PANEL_ID,
		name: webWidget.Name || 'Web Widget',
		refreshInterval: Number(webWidget.RefreshInterval) || WEB_WIDGET_REFRESH_INTERVAL,
		url: webWidget.Url || webWidget.URL || webWidget.url || ''
	};
}

function sanitizeDataText(value, maxLength) {
	return String(value || '')
		.replace(/[^a-z0-9 .,_()-]/gi, '')
		.slice(0, maxLength);
}

function parseWidgetId(widgetId) {
	const parts = String(widgetId || '').split('~');
	return {
		panelId: parts[0] || '',
		pageId: parts[1] || '',
		action: parts[2] || '',
		index: parts[3] !== undefined ? Number(parts[3]) : null,
		parts: parts
	};
}

function isSelectDeviceWidget(widgetId) {
	const parsed = parseWidgetId(widgetId);
	return parsed.panelId === PANEL_ID && parsed.pageId === 'SelectDevice';
}

function isProtectedPanelWidget(widgetId) {
	return parseWidgetId(widgetId).panelId === PANEL_ID;
}

function isPinModeWidget(widgetId) {
	const parsed = parseWidgetId(widgetId);
	return parsed.panelId === PANEL_ID && parsed.pageId === 'Config' && ['PinOff', 'PinOn', 'PinEdit', 'PinInfo'].includes(parsed.action);
}

function isPairNewRoomWidget(widgetId) {
	const parsed = parseWidgetId(widgetId);
	return parsed.panelId === PANEL_ID && parsed.pageId === 'Config' && (parsed.action === 'PairNewDevice' || parsed.action === 'PairingInfo');
}

function isParentDeviceWidget(widgetId) {
	const parsed = parseWidgetId(widgetId);
	return parsed.panelId === PANEL_ID && parsed.pageId === 'SelectDevice' && (parsed.action === 'ParentSelect' || parsed.action === 'ParentOffline');
}

function isProtectedPanelPage(pageId) {
	return String(pageId || '') === SELECT_DEVICE_PAGE_ID || String(pageId || '') === CONFIG_PAGE_ID;
}

function getParentStatus(parentDevice, parentDeviceStatus) {
	return parentDeviceStatus.find(status => status.host === parentDevice.host || status.serial === parentDevice.serial) || null;
}

function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

const companionUi = {
	PANEL_ID,
	ACCESS_PANEL_ID,
	ERROR_PANEL_ID,
	RELEASE_DEVICE_WIDGET_ID,
	RELEASE_INFO_WIDGET_ID,
	PAIR_NEW_ROOM_WIDGET_ID,
	PAIRING_INFO_WIDGET_ID,
	savePanel,
	saveErrorPanel,
	removeErrorPanel,
	isErrorPanel,
	isAccessPanel,
	openProtectedPanel,
	closeProtectedPanel,
	showPinTextInput,
	clearPinTextInput,
	showPinNotice,
	showCompanionTextInput,
	clearCompanionTextInput,
	showCompanionPrompt,
	showErrorPrompt,
	setSelectedParent,
	setPinModeFeedback,
	showReleaseInfo,
	getCurrentWebWidget,
	saveWebWidget,
	saveCompanionWebWidget,
	removeWebWidget,
	removeCompanionWebWidget,
	isCompanionWebWidget,
	buildCompanionWebWidgetUrl,
	showStandbySyncPrompt,
	clearPrompt,
	parseWidgetId,
	isSelectDeviceWidget,
	isProtectedPanelWidget,
	isPinModeWidget,
	isPairNewRoomWidget,
	isParentDeviceWidget,
	isProtectedPanelPage
};

export { companionUi };
