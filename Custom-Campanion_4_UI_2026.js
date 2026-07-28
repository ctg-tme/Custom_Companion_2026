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
 * Version:                 0.1.0.33
 *
 * Description:             Companion Device access and hidden panels, custom access-panel icon,
 *                          PIN/registration/status prompts, shared Companion Alert ownership,
 *                          and Companion WebWidget adapter.
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

const LEGACY_PANEL_ID = 'cc26';
const ACCESS_PANEL_ID = 'cc26_access';
const PANEL_ID = 'cc26_hidden';
const ERROR_PANEL_ID = 'cc26_error';
const ERROR_PROMPT_ID = 'cc26_error_prompt';
const ACCESS_PANEL_ICON_URL = 'https://ctg-tme.github.io/Custom_Companion_2026/icons/custom-companion-512.png';
const PARENT_ROOM_DEVICE_SELECTION_PAGE_ID = `${PANEL_ID}~SelectParentRoomDevice`;
const CONFIG_PAGE_ID = `${PANEL_ID}~Config`;
const STANDALONE_MODE_WIDGET_ID = `${PARENT_ROOM_DEVICE_SELECTION_PAGE_ID}~Standalone`;
const STANDALONE_INFO_WIDGET_ID = `${PARENT_ROOM_DEVICE_SELECTION_PAGE_ID}~StandaloneInfo`;
const NO_PARENT_ROOM_DEVICES_WIDGET_ID = `${PARENT_ROOM_DEVICE_SELECTION_PAGE_ID}~NoParentRoomDevices`;
const PIN_OFF_WIDGET_ID = `${CONFIG_PAGE_ID}~PinOff`;
const PIN_ON_WIDGET_ID = `${CONFIG_PAGE_ID}~PinOn`;
const PIN_EDIT_WIDGET_ID = `${CONFIG_PAGE_ID}~PinEdit`;
const PIN_INFO_WIDGET_ID = `${CONFIG_PAGE_ID}~PinInfo`;
const REGISTER_PARENT_ROOM_DEVICE_WIDGET_ID = `${CONFIG_PAGE_ID}~RegisterParentRoomDevice`;
const REGISTRATION_INFO_WIDGET_ID = `${CONFIG_PAGE_ID}~RegistrationInfo`;
const STANDALONE_INFO_TEXT = 'Select a registered Parent Room Device to run this Companion Device in Paired mode. Use Standalone to restore normal local use.';
const WEB_WIDGET_PANEL_ID = 'cc26WebWidget';
const WEB_WIDGET_NAME = 'Custom Companion 2026';
const WEB_WIDGET_REFRESH_INTERVAL = 0;
const WEB_WIDGET_DEFAULT_URL = 'https://ctg-tme.github.io/Simple-WebWidget/';
const WEB_WIDGET_INFO3_MAX_CHARACTERS = 90;
let alertOwnershipSequence = 0;
let currentAlertOwnership = null;
let alertOwnershipExpiryTimer = null;
let downloadedIconUrl = '';
let downloadedIconId = '';
let pendingIconDownloadUrl = '';
let pendingIconDownload = null;

/*
 * UI xAPI surface:
 * - Commands: UserInterface.Extensions.List, Icon.Download, Panel.Save/Update/Remove/Open/Close, Widget.SetValue,
 *   UserInterface.Message.TextInput.Display/Clear, UserInterface.Message.Prompt.Display/Clear,
 *   and Extensions.WebWidget.Save/Remove.
 * Event subscriptions remain explicit in the Companion Device entry macro because it owns event routing.
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
		<Name>Companion Device Unavailable</Name>
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
			<Name>Select Parent Room Device</Name>
			<Row>
				<Name>Run Companion Device as Standalone</Name>
				<Widget>
					<WidgetId>${STANDALONE_MODE_WIDGET_ID}</WidgetId>
					<Name>Run as Standalone</Name>
					<Type>Button</Type>
					<Options>size=3</Options>
				</Widget>
				<Widget>
					<WidgetId>${STANDALONE_INFO_WIDGET_ID}</WidgetId>
					<Type>Button</Type>
					<Options>size=1;icon=help</Options>
				</Widget>
			</Row>
			${parentRowsXml}
			<PageId>${PARENT_ROOM_DEVICE_SELECTION_PAGE_ID}</PageId>
			<Options/>
		</Page>
		<Page>
			<Name>Config</Name>
			<Row>
				<Name>PIN Mode</Name>
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
				<Name>Register Parent Room Device</Name>
				<Widget>
					<WidgetId>${REGISTER_PARENT_ROOM_DEVICE_WIDGET_ID}</WidgetId>
					<Name>Start Registration</Name>
					<Type>Button</Type>
					<Options>size=3</Options>
				</Widget>
				<Widget>
					<WidgetId>${REGISTRATION_INFO_WIDGET_ID}</WidgetId>
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
				<Name>Select a Parent Room Device</Name>
				<Widget>
					<WidgetId>${NO_PARENT_ROOM_DEVICES_WIDGET_ID}</WidgetId>
					<Name>No Parent Room Devices are registered. Open Config to register a Parent Room Device.</Name>
					<Type>Text</Type>
					<Options>size=4;fontSize=normal;align=center</Options>
				</Widget>
			</Row>`;
	}

	return `<Row>
				<Name>Select a Parent Room Device</Name>
				${parentDevices.map((parentDevice, index) => buildParentWidgetXml(parentDevice, getParentStatus(parentDevice, parentDeviceStatus), index)).join('')}
			</Row>`;
}

function buildParentWidgetXml(parentDevice, parentStatus, index) {
	const parentName = parentDevice.name || parentDevice.host || `Parent Room Device ${index + 1}`;
	const selectWidgetId = `${PARENT_ROOM_DEVICE_SELECTION_PAGE_ID}~ParentRoomDeviceSelect~${index}`;

	if (!parentStatus || !parentStatus.online) {
		return `<Widget>
					<WidgetId>${selectWidgetId}</WidgetId>
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
	await Promise.all([
		removePanel(XAPIObject, ERROR_PANEL_ID),
		removePanel(XAPIObject, LEGACY_PANEL_ID)
	]);
	await Promise.all([
		XAPIObject.Command.UserInterface.Extensions.Panel.Save({ PanelId: ACCESS_PANEL_ID }, buildAccessPanelXml()),
		XAPIObject.Command.UserInterface.Extensions.Panel.Save({ PanelId: PANEL_ID }, buildPanelXml(parentDevices, parentDeviceStatus, activeParentSerial))
	]);
	const panelUpdates = [
		fetchIconByUrl(XAPIObject, ACCESS_PANEL_ICON_URL, ACCESS_PANEL_ID),
		setSelectedParent(XAPIObject, parentDevices, activeParentSerial),
		setPinModeFeedback(XAPIObject, pinModeEnabled)
	];
	await Promise.all(panelUpdates);
}

async function saveErrorPanel(XAPIObject) {
	await Promise.all([
		removePanel(XAPIObject, LEGACY_PANEL_ID),
		removePanel(XAPIObject, ACCESS_PANEL_ID),
		removePanel(XAPIObject, PANEL_ID)
	]);
	await XAPIObject.Command.UserInterface.Extensions.Panel.Save({ PanelId: ERROR_PANEL_ID }, buildErrorPanelXml());
}

async function fetchIconByUrl(XAPIObject, iconUrl, panelId) {
	const normalizedIconUrl = String(iconUrl || '').trim();
	const normalizedPanelId = String(panelId || '').trim();
	if (!normalizedIconUrl) {
		throw { Context: 'iconUrl parameter is undefined', IconUrl: iconUrl };
	}
	if (!normalizedPanelId) {
		throw { Context: 'panelId parameter is undefined', PanelId: panelId };
	}
	if (!/^https?:\/\/[^\s]+$/i.test(normalizedIconUrl)) {
		throw { Context: 'iconUrl parameter must contain a valid HTTP(S) URL', IconUrl: normalizedIconUrl };
	}

	try {
		const iconId = await downloadIconByUrl(XAPIObject, normalizedIconUrl);
		await XAPIObject.Command.UserInterface.Extensions.Panel.Update({
			Icon: 'Custom',
			IconId: iconId,
			PanelId: normalizedPanelId
		});
		return { Message: 'Icon Applied', PanelId: normalizedPanelId, IconId: iconId };
	} catch (error) {
		throw {
			Context: 'Failed to fetch or apply custom panel icon',
			IconUrl: normalizedIconUrl,
			PanelId: normalizedPanelId,
			Error: error
		};
	}
}

async function downloadIconByUrl(XAPIObject, iconUrl) {
	if (downloadedIconUrl === iconUrl && downloadedIconId) {
		return downloadedIconId;
	}
	if (pendingIconDownloadUrl === iconUrl && pendingIconDownload) {
		return pendingIconDownload;
	}

	pendingIconDownloadUrl = iconUrl;
	pendingIconDownload = requestIconDownload(XAPIObject, iconUrl);
	const currentDownload = pendingIconDownload;
	try {
		const iconId = await currentDownload;
		downloadedIconUrl = iconUrl;
		downloadedIconId = iconId;
		return iconId;
	} finally {
		if (pendingIconDownload === currentDownload) {
			pendingIconDownloadUrl = '';
			pendingIconDownload = null;
		}
	}
}

async function requestIconDownload(XAPIObject, iconUrl) {
	const response = await XAPIObject.Command.UserInterface.Extensions.Icon.Download({ Url: iconUrl });
	const iconId = String(response && (response.IconId || response.Id) || '').trim();
	if (!iconId) {
		throw { Context: 'Icon download response did not contain an IconId', Response: response };
	}
	return iconId;
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

async function showOwnedAlert(XAPIObject, options) {
	const ownerId = String(options && options.ownerId || '').trim();
	if (!ownerId) {
		throw new Error('Companion Device alert ownerId is required');
	}

	const ownershipToken = options.ownershipToken === undefined
		? ++alertOwnershipSequence
		: options.ownershipToken;
	clearAlertOwnershipExpiryTimer();
	currentAlertOwnership = {
		ownerId: ownerId,
		ownershipToken: ownershipToken
	};
	const durationSeconds = Number(options.duration);
	if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
		alertOwnershipExpiryTimer = setTimeout(() => {
			relinquishOwnedAlert(ownerId, ownershipToken);
		}, durationSeconds * 1000);
	}

	try {
		await XAPIObject.Command.UserInterface.Message.Alert.Display({
			Title: options.title,
			Text: options.text,
			Duration: options.duration
		});
	} catch (error) {
		relinquishOwnedAlert(ownerId, ownershipToken);
		throw error;
	}

	return ownershipToken;
}

async function clearOwnedAlert(XAPIObject, ownerId, ownershipToken) {
	if (!isCurrentAlertOwner(ownerId, ownershipToken)) {
		return false;
	}

	relinquishOwnedAlert(ownerId, ownershipToken);
	await XAPIObject.Command.UserInterface.Message.Alert.Clear();
	return true;
}

function relinquishOwnedAlert(ownerId, ownershipToken) {
	if (!isCurrentAlertOwner(ownerId, ownershipToken)) {
		return false;
	}

	clearAlertOwnershipExpiryTimer();
	currentAlertOwnership = null;
	return true;
}

function isCurrentAlertOwner(ownerId, ownershipToken) {
	if (!currentAlertOwnership || currentAlertOwnership.ownerId !== ownerId) {
		return false;
	}
	return ownershipToken === undefined || currentAlertOwnership.ownershipToken === ownershipToken;
}

function clearAlertOwnershipExpiryTimer() {
	if (alertOwnershipExpiryTimer) {
		clearTimeout(alertOwnershipExpiryTimer);
	}
	alertOwnershipExpiryTimer = null;
}

async function showErrorPrompt(XAPIObject) {
	await XAPIObject.Command.UserInterface.Message.Prompt.Display({
		Title: 'Companion Device Unavailable',
		Text: 'Contact a Device Administrator.',
		FeedbackId: ERROR_PROMPT_ID,
		'Option.1': 'Dismiss',
		Duration: 30
	});
}

async function setSelectedParent(XAPIObject, parentDevices, activeParentSerial) {
	const widgetUpdates = [
		setWidgetValue(XAPIObject, STANDALONE_MODE_WIDGET_ID, activeParentSerial === 'Standalone' ? 'active' : 'inactive')
	];

	for (let index = 0; index < parentDevices.length; index++) {
		const widgetId = `${PARENT_ROOM_DEVICE_SELECTION_PAGE_ID}~ParentRoomDeviceSelect~${index}`;
		const isActive = parentDevices[index].serial === activeParentSerial;
		widgetUpdates.push(setWidgetValue(XAPIObject, widgetId, isActive ? 'active' : 'inactive'));
	}

	await Promise.all(widgetUpdates);
}

async function setPinModeFeedback(XAPIObject, enabled) {
	await Promise.all([
		setWidgetValue(XAPIObject, PIN_OFF_WIDGET_ID, enabled ? 'inactive' : 'active'),
		setWidgetValue(XAPIObject, PIN_ON_WIDGET_ID, enabled ? 'active' : 'inactive')
	]);
}

async function setWidgetValue(XAPIObject, widgetId, value) {
	try {
		await XAPIObject.Command.UserInterface.Extensions.Widget.SetValue({ WidgetId: widgetId, Value: value });
	} catch (error) {
		// Widgets for offline parents are intentionally absent from the active panel.
	}
}

async function showStandaloneInfo(XAPIObject) {
	await XAPIObject.Command.UserInterface.Message.Prompt.Display({
		Title: 'Companion Device Select',
		Text: STANDALONE_INFO_TEXT,
		Duration: 10
	});
}

async function getCurrentWebWidget(XAPIObject) {
	const extensions = await XAPIObject.Command.UserInterface.Extensions.List({ ActivityType: 'WebWidget' });
	const webWidget = findWebWidgetExtension(extensions);

	return webWidget ? normalizeWebWidget(webWidget) : null;
}

async function replaceWebWidget(XAPIObject, webWidget) {
	if (!webWidget || !webWidget.url) {
		return;
	}

	const currentWebWidget = await getCurrentWebWidget(XAPIObject);
	if (currentWebWidget && currentWebWidget.panelId && currentWebWidget.panelId !== webWidget.panelId) {
		await XAPIObject.Command.UserInterface.Extensions.WebWidget.Remove({ PanelId: currentWebWidget.panelId });
	}
	await saveWebWidget(XAPIObject, webWidget);
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

async function replaceCompanionWebWidget(XAPIObject, url) {
	await replaceWebWidget(XAPIObject, {
		panelId: WEB_WIDGET_PANEL_ID,
		name: WEB_WIDGET_NAME,
		refreshInterval: WEB_WIDGET_REFRESH_INTERVAL,
		url: url
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
	const contextConfig = options.mode === 'Standalone' ? webWidgetConfig.Standalone || {} : webWidgetConfig.Paired || {};
	const params = {
		theme: options.themeName || 'EveningFjord',
		heading: 'Custom Companion 2026',
		info1: options.mode === 'Standalone' ? 'Operating in Standalone' : `Paired to Parent Room Device:\n${options.parentRoomDeviceName || 'Unknown Parent Room Device'}`,
		info2: contextConfig.userGuidance || '',
		info3: options.preserveRuntimeInfo3
			? String(options.runtimeInfo3 || '').trim()
			: limitWebWidgetInfoText(options.runtimeInfo3),
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

	return `${WEB_WIDGET_DEFAULT_URL}#${buildHashParams(params)}`;
}

async function showStandbySyncPrompt(XAPIObject, options) {
	await XAPIObject.Command.UserInterface.Message.Prompt.Display({
		Title: 'Parent Room Device Standby',
		Text: `The active Parent Room Device is currently in ${options.state}. This Companion Device will match its latest standby state in ${options.remainingSeconds} seconds.`,
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

function limitWebWidgetInfoText(value) {
	const infoText = String(value || '').trim();
	if (infoText.length <= WEB_WIDGET_INFO3_MAX_CHARACTERS) {
		return infoText;
	}

	const clippedText = infoText.slice(0, WEB_WIDGET_INFO3_MAX_CHARACTERS - 1);
	const lastWordBoundary = clippedText.lastIndexOf(' ');
	const minimumWordBoundary = Math.floor(WEB_WIDGET_INFO3_MAX_CHARACTERS * 0.6);
	const visibleText = lastWordBoundary >= minimumWordBoundary ? clippedText.slice(0, lastWordBoundary) : clippedText;
	return `${visibleText.trim()}…`;
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

function findWebWidgetExtension(value) {
	if (!value) {
		return null;
	}

	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++) {
			const webWidget = findWebWidgetExtension(value[index]);
			if (webWidget) {
				return webWidget;
			}
		}
		return null;
	}

	if (typeof value !== 'object') {
		return null;
	}

	if (String(value.ActivityType || '').toLowerCase() === 'webwidget') {
		return value;
	}

	const keys = Object.keys(value);
	for (let index = 0; index < keys.length; index++) {
		const webWidget = findWebWidgetExtension(value[keys[index]]);
		if (webWidget) {
			return webWidget;
		}
	}
	return null;
}

function normalizeWebWidget(webWidget) {
	return {
		panelId: webWidget.PanelId || webWidget.PanelID || webWidget.Id || webWidget.ID || WEB_WIDGET_PANEL_ID,
		name: webWidget.Name || 'Web Widget',
		refreshInterval: Number(webWidget.RefreshInterval) || WEB_WIDGET_REFRESH_INTERVAL,
		url: webWidget.ActivityData || webWidget.Url || webWidget.URL || webWidget.url || ''
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

function isParentRoomDeviceSelectionWidget(widgetId) {
	const parsed = parseWidgetId(widgetId);
	return parsed.panelId === PANEL_ID && parsed.pageId === 'SelectParentRoomDevice';
}

function isProtectedPanelWidget(widgetId) {
	return parseWidgetId(widgetId).panelId === PANEL_ID;
}

function isPinModeWidget(widgetId) {
	const parsed = parseWidgetId(widgetId);
	return parsed.panelId === PANEL_ID && parsed.pageId === 'Config' && ['PinOff', 'PinOn', 'PinEdit', 'PinInfo'].includes(parsed.action);
}

function isParentRegistrationWidget(widgetId) {
	const parsed = parseWidgetId(widgetId);
	return parsed.panelId === PANEL_ID && parsed.pageId === 'Config' && (parsed.action === 'RegisterParentRoomDevice' || parsed.action === 'RegistrationInfo');
}

function isParentDeviceWidget(widgetId) {
	const parsed = parseWidgetId(widgetId);
	return parsed.panelId === PANEL_ID && parsed.pageId === 'SelectParentRoomDevice' && parsed.action === 'ParentRoomDeviceSelect';
}

function isProtectedPanelPage(pageId) {
	return String(pageId || '') === PARENT_ROOM_DEVICE_SELECTION_PAGE_ID || String(pageId || '') === CONFIG_PAGE_ID;
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
	STANDALONE_MODE_WIDGET_ID,
	STANDALONE_INFO_WIDGET_ID,
	REGISTER_PARENT_ROOM_DEVICE_WIDGET_ID,
	REGISTRATION_INFO_WIDGET_ID,
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
	showOwnedAlert,
	clearOwnedAlert,
	relinquishOwnedAlert,
	showErrorPrompt,
	setSelectedParent,
	setPinModeFeedback,
	showStandaloneInfo,
	getCurrentWebWidget,
	replaceWebWidget,
	replaceCompanionWebWidget,
	saveWebWidget,
	saveCompanionWebWidget,
	removeWebWidget,
	removeCompanionWebWidget,
	isCompanionWebWidget,
	buildCompanionWebWidgetUrl,
	showStandbySyncPrompt,
	clearPrompt,
	parseWidgetId,
	isParentRoomDeviceSelectionWidget,
	isProtectedPanelWidget,
	isPinModeWidget,
	isParentRegistrationWidget,
	isParentDeviceWidget,
	isProtectedPanelPage
};

export { companionUi };
