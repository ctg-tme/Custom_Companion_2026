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
 * Revised:                 July 09, 2026
 * Version:                 1.0.3
 *
 * Description:             A macro module that facilitates the custom Companion Solution user interface for Board Series endpoints with Wheel Kits.
 *                          This module will provide PIN-protected parent-device management UI helpers. The xapi object must be passed in from the calling macro.
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

const PANEL_ID = 'cc26';
const SELECT_DEVICE_PAGE_ID = `${PANEL_ID}~SelectDevice`;
const CONFIG_PAGE_ID = `${PANEL_ID}~Config`;
const RELEASE_DEVICE_WIDGET_ID = `${SELECT_DEVICE_PAGE_ID}~ReleaseDevice`;
const RELEASE_INFO_WIDGET_ID = `${SELECT_DEVICE_PAGE_ID}~ReleaseInfo`;
const NO_PARENTS_FOUND_WIDGET_ID = `${SELECT_DEVICE_PAGE_ID}~NoParentsFound`;
const RELEASE_INFO_TEXT = 'Select a room to pair this companion board to that room system. Use Stand Alone to unpair and restore normal local use.';

function buildPanelXml(parentDevices, parentDeviceStatus, activeParentSerial) {
	const parentRowsXml = buildParentRowsXml(parentDevices, parentDeviceStatus);

	return `<Extensions>
	<Version>1.11</Version>
	<Panel>
		<Order>4</Order>
		<PanelId>${PANEL_ID}</PanelId>
		<Origin>local</Origin>
		<Location>HomeScreen</Location>
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
					<WidgetId>${PANEL_ID}~Config~PinOff</WidgetId>
					<Name>Off</Name>
					<Type>Button</Type>
					<Options>size=1</Options>
				</Widget>
				<Widget>
					<WidgetId>${PANEL_ID}~Config~PinOn</WidgetId>
					<Name>On</Name>
					<Type>Button</Type>
					<Options>size=1</Options>
				</Widget>
				<Widget>
					<WidgetId>${PANEL_ID}~Config~PinEdit</WidgetId>
					<Name>Edit</Name>
					<Type>Button</Type>
					<Options>size=1</Options>
				</Widget>
				<Widget>
					<WidgetId>${PANEL_ID}~Config~PinInfo</WidgetId>
					<Type>Button</Type>
					<Options>size=1;icon=help</Options>
				</Widget>
			</Row>
			<Row>
				<Name>Pair New Room</Name>
				<Widget>
					<WidgetId>${PANEL_ID}~Config~PairNewDevice</WidgetId>
					<Name>Start Room Pairing Process</Name>
					<Type>Button</Type>
					<Options>size=3</Options>
				</Widget>
				<Widget>
					<WidgetId>${PANEL_ID}~Config~PairingInfo</WidgetId>
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
					<Type>Text</Type>
					<Options>size=2;fontSize=small;align=center</Options>
				</Widget>`;
	}

	return `<Widget>
					<WidgetId>${selectWidgetId}</WidgetId>
					<Name>${escapeXml(parentName)}</Name>
					<Type>Button</Type>
					<Options>size=2</Options>
				</Widget>`;
}

async function savePanel(XAPIObject, parentDevices, parentDeviceStatus, activeParentSerial) {
	await XAPIObject.Command.UserInterface.Extensions.Panel.Save({ PanelId: PANEL_ID }, buildPanelXml(parentDevices, parentDeviceStatus, activeParentSerial));
	await setSelectedParent(XAPIObject, parentDevices, activeParentSerial);
}

async function setSelectedParent(XAPIObject, parentDevices, activeParentSerial) {
	await setWidgetValue(XAPIObject, RELEASE_DEVICE_WIDGET_ID, activeParentSerial === 'StandAlone' ? 'active' : 'inactive');

	for (let index = 0; index < parentDevices.length; index++) {
		const widgetId = `${SELECT_DEVICE_PAGE_ID}~ParentSelect~${index}`;
		const isActive = parentDevices[index].serial === activeParentSerial;
		await setWidgetValue(XAPIObject, widgetId, isActive ? 'active' : 'inactive');
	}
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
	RELEASE_DEVICE_WIDGET_ID,
	RELEASE_INFO_WIDGET_ID,
	savePanel,
	setSelectedParent,
	showReleaseInfo,
	parseWidgetId,
	isSelectDeviceWidget
};

export { companionUi };
