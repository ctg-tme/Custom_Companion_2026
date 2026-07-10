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
 * Version:                 1.0.6
 *
 * Description:             A macro module that facilitates device-to-device communication for a custom Companion Solution for Board Series endpoints with Wheel Kits.
 *                          This module will provide HTTPClient, Message API, and putxml routing helpers. The xapi object must be passed in from the calling macro.
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

let activeRequestCount = 0;
let maxConcurrentRequests = 3;
const queuedRequests = [];

/**
 * Sets RoomOS HTTPClient configuration used by this solution.
 * @param {object} XAPIObject The RoomOS xapi object.
 * @param {object} httpClientConfig HTTPClient configuration values.
 * @returns {Promise<object>} HTTPClient initialization status.
 * @roomosxapi [xConfiguration HttpClient Mode](https://roomos.cisco.com/xapi/Configuration.HttpClient.Mode/)
 * @roomosxapi [xConfiguration HttpClient AllowInsecureHTTPS](https://roomos.cisco.com/xapi/Configuration.HttpClient.AllowInsecureHTTPS/)
 */
async function initializeHttpClient(XAPIObject, httpClientConfig) {
	const config = httpClientConfig || {};
	maxConcurrentRequests = Number(config.maxConcurrentRequests) || 3;

	await XAPIObject.Config.HttpClient.Mode.set(config.mode || 'On');
	await XAPIObject.Config.HttpClient.AllowInsecureHTTPS.set(config.allowInsecureHTTPS ? 'True' : 'False');

	return { Status: 'OK', Message: 'HTTPClient initialized' };
}

/**
 * Gets identifying data from a parent device and validates that HTTP credentials work.
 * @param {object} XAPIObject The RoomOS xapi object.
 * @param {object} parentDevice Parent device connection details.
 * @param {number} timeoutSeconds Peripheral heartbeat timeout in seconds.
 * @param {object} httpClientConfig HTTPClient request configuration.
 * @returns {Promise<object>} Parent device identity with serial and BroadcastName.
 * @roomosxapi [xCommand HttpClient Get](https://roomos.cisco.com/xapi/Command.HttpClient.Get/)
 */
async function parentInitializationRequest(XAPIObject, parentDevice, httpClientConfig) {
	validateParentDevice(parentDevice);

	const url = `https://${parentDevice.host}/getxml?location=/Status/SystemUnit`;
	const response = await queuedHttpRequest(() => XAPIObject.Command.HttpClient.Get({
		Url: url,
		Header: buildHeaders(parentDevice),
		AllowInsecureHTTPS: getAllowInsecureHTTPS(httpClientConfig)
	}));

	const body = response.Body || '';
	const serial = getXmlPathValue(body, ['SystemUnit', 'Hardware', 'Module', 'SerialNumber']) || getXmlPathValue(body, ['SerialNumber']);
	const broadcastName = getXmlPathValue(body, ['SystemUnit', 'BroadcastName']) || getXmlPathValue(body, ['BroadcastName']);

	if (!serial || !broadcastName) {
		throw buildError('Parent initialization response did not include both SerialNumber and BroadcastName', {
			Code: 'cc.parent-init.1',
			Host: parentDevice.host,
			ResponseStatusCode: response.StatusCode
		});
	}

	return {
		serial: serial,
		name: broadcastName,
		host: parentDevice.host,
		username: parentDevice.username,
		password: parentDevice.password
	};
}

/**
 * Installs the room-reference runtime, shared config, and MemoryStorage library on a parent device.
 * @param {object} XAPIObject The RoomOS xapi object.
 * @param {object} parentDevice Parent device connection details.
 * @param {object} macroPayloads Macro content keyed by target purpose.
 * @param {object} installConfig Macro name configuration.
 * @param {object} httpClientConfig HTTPClient request configuration.
 * @returns {Promise<object>} Parent install status.
 * @roomosxapi [xCommand HttpClient Post](https://roomos.cisco.com/xapi/Command.HttpClient.Post/)
 */
async function installParentMacros(XAPIObject, parentDevice, macroPayloads, installConfig, httpClientConfig) {
	validateParentDevice(parentDevice);

	const config = installConfig || {};
	const macros = [
		{ Name: config.roomReferenceTargetMacroName || 'Custom-Campanion_Room_2026', Content: macroPayloads.roomReference },
		{ Name: config.configMacroName || 'Custom-Campanion_Config_2026', Content: macroPayloads.config },
		{ Name: config.memoryStorageMacroName || 'Memory-Storage-Functions-V2', Content: macroPayloads.memoryStorage }
	];

	for (let index = 0; index < macros.length; index++) {
		await sendPutXml(XAPIObject, parentDevice, buildMacroSaveXml(macros[index].Name, macros[index].Content), httpClientConfig);
	}

	await sendPutXml(XAPIObject, parentDevice, buildMacroActivateXml(config.roomReferenceTargetMacroName || 'Custom-Campanion_Room_2026'), httpClientConfig);

	return { Status: 'OK', Message: 'Parent macros installed', Host: parentDevice.host };
}

/**
 * Sends a routed Custom Companion message to another RoomOS device.
 * @param {object} XAPIObject The RoomOS xapi object.
 * @param {object} parentDevice Parent device connection details.
 * @param {string} route Custom Companion route name.
 * @param {object} payload Route payload.
 * @param {object} messageConfig Message service configuration.
 * @param {object} httpClientConfig HTTPClient request configuration.
 * @returns {Promise<object>} HTTPClient response.
 * @roomosxapi [xCommand Message Send](https://roomos.cisco.com/xapi/Command.Message.Send/)
 */
async function sendMessageCommand(XAPIObject, parentDevice, route, payload, messageConfig, httpClientConfig) {
	validateParentDevice(parentDevice);

	const config = messageConfig || {};
	const message = {
		Service: config.service || 'CustomCampanion',
		Version: config.version || 'Unknown',
		Route: route,
		Timestamp: new Date().toISOString(),
		Payload: payload || {}
	};

	return sendPutXml(XAPIObject, parentDevice, buildMessageSendXml(message), httpClientConfig);
}

/**
 * Registers the companion board as a peripheral on a parent device.
 * @param {object} XAPIObject The RoomOS xapi object.
 * @param {object} parentDevice Parent device connection details.
 * @param {object} peripheralInfo Companion board peripheral registration details.
 * @param {object} httpClientConfig HTTPClient request configuration.
 * @returns {Promise<object>} HTTPClient response.
 * @roomosxapi [xCommand Peripherals Connect](https://roomos.cisco.com/xapi/Command.Peripherals.Connect/)
 */
async function connectPeripheral(XAPIObject, parentDevice, peripheralInfo, httpClientConfig) {
	validateParentDevice(parentDevice);
	validatePeripheralInfo(peripheralInfo);

	return sendPutXml(XAPIObject, parentDevice, buildPeripheralConnectXml(peripheralInfo), httpClientConfig);
}

/**
 * Sends a peripheral heartbeat for the companion board to a parent device.
 * @param {object} XAPIObject The RoomOS xapi object.
 * @param {object} parentDevice Parent device connection details.
 * @param {string} peripheralId Unique peripheral ID.
 * @param {object} httpClientConfig HTTPClient request configuration.
 * @returns {Promise<object>} HTTPClient response.
 * @roomosxapi [xCommand Peripherals HeartBeat](https://roomos.cisco.com/xapi/Command.Peripherals.HeartBeat/)
 */
async function sendPeripheralHeartbeat(XAPIObject, parentDevice, peripheralId, timeoutSeconds, httpClientConfig) {
	validateParentDevice(parentDevice);

	if (!peripheralId) {
		throw buildError('Peripheral heartbeat requires a peripheral ID', { Code: 'cc.peripheral-heartbeat.1', Host: parentDevice.host });
	}

	return sendPutXml(XAPIObject, parentDevice, buildPeripheralHeartbeatXml(peripheralId, timeoutSeconds), httpClientConfig);
}

function queuedHttpRequest(task) {
	return new Promise((resolve, reject) => {
		queuedRequests.push({ Task: task, Resolve: resolve, Reject: reject });
		runNextQueuedRequest();
	});
}

function runNextQueuedRequest() {
	if (activeRequestCount >= maxConcurrentRequests || queuedRequests.length === 0) {
		return;
	}

	const request = queuedRequests.shift();
	activeRequestCount++;

	request.Task()
		.then(request.Resolve)
		.catch(request.Reject)
		.then(() => {
			activeRequestCount--;
			runNextQueuedRequest();
		});
}

function validateParentDevice(parentDevice) {
	if (!parentDevice || !parentDevice.host || !parentDevice.username || !parentDevice.password) {
		throw buildError('Parent device must include host, username, and password', { Code: 'cc.parent-device.1' });
	}
}

function validatePeripheralInfo(peripheralInfo) {
	if (!peripheralInfo || !peripheralInfo.ID || !peripheralInfo.Name || !peripheralInfo.Type) {
		throw buildError('Peripheral information must include ID, Name, and Type', { Code: 'cc.peripheral-connect.1' });
	}
}

function buildHeaders(parentDevice) {
	return [
		'Content-Type: text/xml',
		`Authorization: Basic ${btoa(`${parentDevice.username}:${parentDevice.password}`)}`
	];
}

function getAllowInsecureHTTPS(httpClientConfig) {
	return httpClientConfig && httpClientConfig.allowInsecureHTTPS ? 'True' : 'False';
}

function sendPutXml(XAPIObject, parentDevice, xmlBody, httpClientConfig) {
	return queuedHttpRequest(() => XAPIObject.Command.HttpClient.Post({
		Url: `https://${parentDevice.host}/putxml`,
		Header: buildHeaders(parentDevice),
		AllowInsecureHTTPS: getAllowInsecureHTTPS(httpClientConfig)
	}, xmlBody));
}

function buildMacroSaveXml(name, content) {
	if (!content) {
		throw buildError(`Missing macro content for ${name}`, { Code: 'cc.parent-install.1', MacroName: name });
	}

	return `<Command><Macros><Macro><Save><Name>${escapeXml(name)}</Name><body>${escapeXml(content)}</body></Save></Macro></Macros></Command>`;
}

function buildMacroActivateXml(name) {
	return `<Command><Macros><Macro><Activate><Name>${escapeXml(name)}</Name></Activate></Macro></Macros></Command>`;
}

function buildMessageSendXml(message) {
	return `<Command><Message><Send><Text>${escapeXml(JSON.stringify(message))}</Text></Send></Message></Command>`;
}

function buildPeripheralConnectXml(peripheralInfo) {
	return `<Command><Peripherals><Connect><ID>${escapeXml(peripheralInfo.ID)}</ID><Name>${escapeXml(peripheralInfo.Name)}</Name><NetworkAddress>${escapeXml(peripheralInfo.NetworkAddress || '')}</NetworkAddress><SerialNumber>${escapeXml(peripheralInfo.SerialNumber || '')}</SerialNumber><HardwareInfo>${escapeXml(peripheralInfo.HardwareInfo || '')}</HardwareInfo><SoftwareInfo>${escapeXml(peripheralInfo.SoftwareInfo || '')}</SoftwareInfo><Type>${escapeXml(peripheralInfo.Type)}</Type></Connect></Peripherals></Command>`;
}

function buildPeripheralHeartbeatXml(peripheralId, timeoutSeconds) {
	return `<Command><Peripherals><HeartBeat><ID>${escapeXml(peripheralId)}</ID><Timeout>${escapeXml(timeoutSeconds)}</Timeout></HeartBeat></Peripherals></Command>`;
}

function getXmlPathValue(xml, path) {
	let currentXml = xml;

	for (let index = 0; index < path.length; index++) {
		const match = currentXml.match(new RegExp(`<${path[index]}(?:\\s[^>]*)?>([\\s\\S]*?)</${path[index]}>`, 'i'));
		if (!match) {
			return '';
		}
		currentXml = match[1];
	}

	return unescapeXml(currentXml.trim());
}

function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function unescapeXml(value) {
	return String(value)
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/&amp;/g, '&');
}

function buildError(message, context) {
	const error = new Error(message);
	error.Context = context || {};
	error.code = error.Context.Code;
	return error;
}

const deviceComms = {
	initializeHttpClient,
	parentInitializationRequest,
	installParentMacros,
	sendMessageCommand,
	connectPeripheral,
	sendPeripheralHeartbeat
};

export { deviceComms };
