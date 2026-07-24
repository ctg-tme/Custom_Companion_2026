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
 * Revised:                 July 24, 2026
 * Version:                 1.0.15
 *
 * Description:             Device-to-device transport, queue policy, Message envelopes, putxml
 *                          builders, response validation, and dependency-free XML parsing.
 *
 * Documentation:           https://github.com/ctg-tme/Custom_Companion_2026/blob/main/docs/technical-reference.md
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro, Board Pro G2, Board Pro G3, Desk Pro, Desk, Desk Mini, Desk Pro G2;
 *                          compatible RoomOS Parent Room Devices
 *
 * Code Dependencies:       None
 *
 * AI Generation:           Percentage: 95% (estimated)
 *                          Model(s): OpenAI Codex (GPT-5 family)
 *                          Instruction File(s): AGENTS.md,
 *                          https://github.com/ctg-tme/Bobbys_Macro_AI_Agents/blob/main/AGENTS.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

let activeRequestCount = 0;
let maxConcurrentRequests = 3;
const queuedRequests = [];
const coalescedRequestPromises = {};
const COMPANION_APP = 'Companion Board 2026';
const HTTP_TRANSPORT_POLICY = {
	timeoutSeconds: 3,
	maxPendingRequests: 50,
	responseExcerptLength: 256
};

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
 * Gets identifying data from a Parent Room Device and validates that HTTP credentials work.
 * @param {object} XAPIObject The RoomOS xapi object.
 * @param {object} parentDevice Parent Room Device connection details.
 * @param {number} timeoutSeconds Peripheral heartbeat timeout in seconds.
 * @param {object} httpClientConfig HTTPClient request configuration.
 * @returns {Promise<object>} Parent Room Device identity with serial and BroadcastName.
 * @roomosxapi [xCommand HttpClient Get](https://roomos.cisco.com/xapi/Command.HttpClient.Get/)
 */
async function parentInitializationRequest(XAPIObject, parentDevice, httpClientConfig) {
	validateParentDevice(parentDevice);

	const url = `https://${parentDevice.host}/getxml?location=/Status/SystemUnit`;
	const response = await queuedHttpRequest(() => XAPIObject.Command.HttpClient.Get({
		Url: url,
		Header: buildHeaders(parentDevice),
		AllowInsecureHTTPS: getAllowInsecureHTTPS(httpClientConfig),
		ResultBody: 'PlainText',
		Timeout: HTTP_TRANSPORT_POLICY.timeoutSeconds
	}), buildHttpRequestContext('GET', parentDevice.host, '/getxml?location=/Status/SystemUnit', `parent-identity:${parentDevice.host}`));

	const body = response.Body || '';
	const document = parseXml(body);
	const serial = getXmlPathValue(document, ['SystemUnit', 'Hardware', 'Module', 'SerialNumber']) || getXmlPathValue(document, ['SerialNumber']);
	const broadcastName = getXmlPathValue(document, ['SystemUnit', 'BroadcastName']) || getXmlPathValue(document, ['BroadcastName']);

	if (!serial || !broadcastName) {
		throw buildError('Parent Room Device initialization response did not include both SerialNumber and BroadcastName', {
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

async function parentStandbyStateRequest(XAPIObject, parentDevice, httpClientConfig) {
	validateParentDevice(parentDevice);

	const url = `https://${parentDevice.host}/getxml?location=/Status/Standby/State`;
	const response = await queuedHttpRequest(() => XAPIObject.Command.HttpClient.Get({
		Url: url,
		Header: buildHeaders(parentDevice),
		AllowInsecureHTTPS: getAllowInsecureHTTPS(httpClientConfig),
		ResultBody: 'PlainText',
		Timeout: HTTP_TRANSPORT_POLICY.timeoutSeconds
	}), buildHttpRequestContext('GET', parentDevice.host, '/getxml?location=/Status/Standby/State', `parent-standby:${parentDevice.host}`));

	const body = response.Body || '';
	const document = parseXml(body);
	const standbyState = getXmlPathValue(document, ['Standby', 'State']) || getXmlPathValue(document, ['State']);

	if (!standbyState) {
		throw buildError('Parent Room Device standby state response did not include State', {
			Code: 'cc.parent-standby.1',
			Host: parentDevice.host,
			ResponseStatusCode: response.StatusCode
		});
	}

	return standbyState;
}

/**
 * Installs the room-reference runtime and its dependencies on a Parent Room Device.
 * @param {object} XAPIObject The RoomOS xapi object.
 * @param {object} parentDevice Parent Room Device connection details.
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
		{ Name: config.parentCallCoordinationTargetMacroName || 'Custom-Campanion_12_ParentCallCoordination_2026', Content: macroPayloads.parentCallCoordination },
		{ Name: config.utilsMacroName || 'Custom-Campanion_3_Utils_2026', Content: macroPayloads.utils },
		{ Name: config.deviceCommsMacroName || 'Custom-Campanion_6_DeviceComms_2026', Content: macroPayloads.deviceComms },
		{ Name: config.memoryStorageMacroName || 'Memory-Storage-Functions-V2', Content: macroPayloads.memoryStorage }
	];

	await sendPutXml(XAPIObject, parentDevice, buildParentMacroInstallXml(macros, config.roomReferenceTargetMacroName || 'Custom-Campanion_Room_2026'), httpClientConfig);

	return { Status: 'OK', Message: 'Parent Room macros installed', Host: parentDevice.host };
}

/**
 * Sends a routed Custom Companion message to another RoomOS device.
 * @param {object} XAPIObject The RoomOS xapi object.
 * @param {object} parentDevice Parent Room Device connection details.
 * @param {string} route Custom Companion route name.
 * @param {object} payload Route payload.
 * @param {object} messageConfig Message service configuration.
 * @param {object} httpClientConfig HTTPClient request configuration.
 * @returns {Promise<object>} HTTPClient response.
 * @roomosxapi [xCommand Message Send](https://roomos.cisco.com/xapi/Command.Message.Send/)
 */
async function sendMessageCommand(XAPIObject, parentDevice, route, payload, messageConfig, httpClientConfig) {
	validateParentDevice(parentDevice);

	const message = buildCompanionMessage(route, payload, messageConfig || {});

	return sendPutXml(XAPIObject, parentDevice, buildMessageSendXml(message), httpClientConfig);
}

function buildCompanionMessage(action, payload, options = {}) {
	const source = options.source || {};

	return {
		App: options.app || COMPANION_APP,
		Action: action,
		Serial: options.serial || '',
		Source: buildMessageSource(source),
		Payload: payload || {}
	};
}

function buildMessageSource(source) {
	const messageSource = {};
	const sourceFields = ['Role', 'Name', 'Host', 'MacAddress'];

	for (let index = 0; index < sourceFields.length; index++) {
		const field = sourceFields[index];
		if (source[field]) {
			messageSource[field] = source[field];
		}
	}

	return messageSource;
}

function parseCompanionMessage(text) {
	let message;

	try {
		message = JSON.parse(text);
	} catch (error) {
		return null;
	}

	if (!message || message.App !== COMPANION_APP || !message.Action || !message.Serial) {
		return null;
	}

	return message;
}

/**
 * Registers the Companion Device as a peripheral on a Parent Room Device.
 * @param {object} XAPIObject The RoomOS xapi object.
 * @param {object} parentDevice Parent Room Device connection details.
 * @param {object} peripheralInfo Companion Device peripheral registration details.
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
 * Sends a peripheral heartbeat for the Companion Device to a Parent Room Device.
 * @param {object} XAPIObject The RoomOS xapi object.
 * @param {object} parentDevice Parent Room Device connection details.
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

	return sendPutXml(XAPIObject, parentDevice, buildPeripheralHeartbeatXml(peripheralId, timeoutSeconds), httpClientConfig, {
		coalesceKey: `peripheral-heartbeat:${parentDevice.host}:${peripheralId}`
	});
}

async function getCallStatus(XAPIObject, device, httpClientConfig) {
	validateParentDevice(device);

	const response = await queuedHttpRequest(() => XAPIObject.Command.HttpClient.Get({
		Url: `https://${device.host}/getxml?location=/Status/Call`,
		Header: buildHeaders(device),
		AllowInsecureHTTPS: getAllowInsecureHTTPS(httpClientConfig),
		ResultBody: 'PlainText',
		Timeout: HTTP_TRANSPORT_POLICY.timeoutSeconds
	}), buildHttpRequestContext('GET', device.host, '/getxml?location=/Status/Call', `call-status:${device.host}`));

	return parseCallStatusXml(response.Body || '');
}

function queuedHttpRequest(task, requestContext = {}) {
	const coalesceKey = requestContext.CoalesceKey || '';
	if (coalesceKey && coalescedRequestPromises[coalesceKey]) {
		return coalescedRequestPromises[coalesceKey];
	}

	if (queuedRequests.length >= HTTP_TRANSPORT_POLICY.maxPendingRequests) {
		return Promise.reject(buildError('RoomOS HTTP request queue is full', {
			Code: 'CC26-HTTP-QUEUE-FULL',
			Method: requestContext.Method || '',
			Host: requestContext.Host || '',
			Path: requestContext.Path || '',
			PendingRequestCount: queuedRequests.length,
			MaxPendingRequests: HTTP_TRANSPORT_POLICY.maxPendingRequests
		}));
	}

	const promise = new Promise((resolve, reject) => {
		queuedRequests.push({
			Task: task,
			Resolve: resolve,
			Reject: reject,
			Context: requestContext,
			CoalesceKey: coalesceKey
		});
		runNextQueuedRequest();
	});

	if (coalesceKey) {
		coalescedRequestPromises[coalesceKey] = promise;
	}

	return promise;
}

function runNextQueuedRequest() {
	while (activeRequestCount < maxConcurrentRequests && queuedRequests.length > 0) {
		const request = queuedRequests.shift();
		activeRequestCount++;

		Promise.resolve()
			.then(request.Task)
			.then(response => validateHttpResponse(response, request.Context))
			.then(response => settleQueuedRequest(request, null, response))
			.catch(error => settleQueuedRequest(request, normalizeHttpRequestError(error, request.Context)));
	}
}

function normalizeHttpRequestError(error, requestContext) {
	if (error && String(error.code || '').indexOf('CC26-') === 0) {
		return error;
	}

	const context = requestContext || {};
	return buildError('RoomOS HTTP request failed before a valid response was received', {
		Code: 'CC26-HTTP-REQUEST',
		Method: context.Method || '',
		Host: context.Host || '',
		Path: context.Path || '',
		CauseCode: error && error.code,
		Cause: error && error.message ? error.message : 'Unknown HTTPClient request error'
	});
}

function settleQueuedRequest(request, error, response) {
	activeRequestCount--;
	if (request.CoalesceKey) {
		delete coalescedRequestPromises[request.CoalesceKey];
	}

	if (error) {
		request.Reject(error);
	} else {
		request.Resolve(response);
	}

	runNextQueuedRequest();
}

function validateHttpResponse(response, requestContext) {
	const context = requestContext || {};
	const statusCode = Number(response && response.StatusCode);
	const body = response && response.Body ? String(response.Body) : '';

	if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode > 299) {
		throw buildError('RoomOS HTTP request returned a non-success status', {
			Code: 'CC26-HTTP-STATUS',
			Method: context.Method || '',
			Host: context.Host || '',
			Path: context.Path || '',
			StatusCode: response && response.StatusCode,
			ReasonPhrase: response && response.ReasonPhrase,
			ResponseExcerpt: getResponseExcerpt(body)
		});
	}

	if (context.ValidatePutXml && body) {
		validatePutXmlResponse(body, context);
	}

	return response;
}

function validatePutXmlResponse(body, requestContext) {
	let document;

	try {
		document = parseXml(body);
	} catch (error) {
		throw buildError('RoomOS putxml response contained malformed or unsupported XML', {
			Code: 'CC26-PUTXML-MALFORMED',
			Method: requestContext.Method,
			Host: requestContext.Host,
			Path: requestContext.Path,
			ResponseExcerpt: getResponseExcerpt(body),
			ParserError: error.message || error.code || 'Unknown XML parser error'
		});
	}

	const nodes = findXmlNodes(document, () => true);
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index];
		const status = getXmlAttributeValue(node, 'status');
		if (String(node.name || '').toLowerCase() === 'error' || String(status || '').toLowerCase() === 'error') {
			throw buildError('RoomOS putxml response reported an xAPI error', {
				Code: 'CC26-PUTXML-ERROR',
				Method: requestContext.Method,
				Host: requestContext.Host,
				Path: requestContext.Path,
				ResponseExcerpt: getResponseExcerpt(body)
			});
		}
	}
}

function buildHttpRequestContext(method, host, path, coalesceKey, validatePutXml) {
	return {
		Method: method,
		Host: host,
		Path: path,
		CoalesceKey: coalesceKey || '',
		ValidatePutXml: !!validatePutXml
	};
}

function getResponseExcerpt(body) {
	return String(body || '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, HTTP_TRANSPORT_POLICY.responseExcerptLength);
}

function validateParentDevice(parentDevice) {
	if (!parentDevice || !parentDevice.host || !parentDevice.username || !parentDevice.password) {
		throw buildError('Parent Room Device must include host, username, and password', { Code: 'cc.parent-device.1' });
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

function sendPutXml(XAPIObject, parentDevice, xmlBody, httpClientConfig, requestOptions = {}) {
	return queuedHttpRequest(() => XAPIObject.Command.HttpClient.Post({
		Url: `https://${parentDevice.host}/putxml`,
		Header: buildHeaders(parentDevice),
		AllowInsecureHTTPS: getAllowInsecureHTTPS(httpClientConfig),
		ResultBody: 'PlainText',
		Timeout: HTTP_TRANSPORT_POLICY.timeoutSeconds
	}, xmlBody), buildHttpRequestContext('POST', parentDevice.host, '/putxml', requestOptions.coalesceKey, true));
}

function buildParentMacroInstallXml(macros, activeMacroName) {
	let macroXml = '';

	for (let index = 0; index < macros.length; index++) {
		macroXml += buildMacroSaveNode(macros[index].Name, macros[index].Content);
	}

	macroXml += buildMacroActivateNode(activeMacroName);
	macroXml += buildMacroRuntimeRestartNode();

	return `<Command><Macros>${macroXml}</Macros></Command>`;
}

function buildMacroSaveNode(name, content) {
	if (!content) {
		throw buildError(`Missing macro content for ${name}`, { Code: 'cc.parent-install.1', MacroName: name });
	}

	return `<Macro><Save><Name>${escapeXml(name)}</Name><body>${escapeXml(content)}</body></Save></Macro>`;
}

function buildMacroActivateNode(name) {
	return `<Macro><Activate><Name>${escapeXml(name)}</Name></Activate></Macro>`;
}

function buildMacroRuntimeRestartNode() {
	return '<Runtime><Restart></Restart></Runtime>';
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

function parseCallStatusXml(xml) {
	const document = parseXml(xml);
	const callNodes = findXmlNodes(document, node => String(node.name || '').toLowerCase() === 'call');
	const calls = [];

	for (let index = 0; index < callNodes.length; index++) {
		const callNode = callNodes[index];
		const hasCallFields = !!(findDirectChild(callNode, 'CallId') || findDirectChild(callNode, 'CallbackNumber') || findDirectChild(callNode, 'RemoteNumber'));
		if (!hasCallFields && !getXmlAttributeValue(callNode, 'id')) {
			continue;
		}

		calls.push({
			CallId: getXmlPathValue(callNode, ['CallId']),
			RemoteNumber: getXmlPathValue(callNode, ['RemoteNumber']),
			CallbackNumber: getXmlPathValue(callNode, ['CallbackNumber']),
			RemoteURI: getXmlPathValue(callNode, ['RemoteURI']),
			Protocol: getXmlPathValue(callNode, ['Protocol']),
			Status: getXmlPathValue(callNode, ['Status']),
			id: getXmlAttributeValue(callNode, 'id')
		});
	}

	return calls;
}

function parseXml(xml) {
	const source = String(xml || '');
	const stack = [];
	let root = null;
	let index = 0;

	while (index < source.length) {
		if (source[index] !== '<') {
			const nextTag = source.indexOf('<', index);
			const textEnd = nextTag < 0 ? source.length : nextTag;
			const text = source.slice(index, textEnd);
			if (stack.length > 0) {
				stack[stack.length - 1].text += decodeXmlEntities(text);
			} else if (text.trim()) {
				throw buildError('XML text exists outside the document element', { Code: 'CC26-XML-MALFORMED' });
			}
			index = textEnd;
			continue;
		}

		if (source.slice(index, index + 4) === '<!--') {
			const commentEnd = source.indexOf('-->', index + 4);
			if (commentEnd < 0) {
				throw buildError('XML comment was not closed', { Code: 'CC26-XML-MALFORMED' });
			}
			index = commentEnd + 3;
			continue;
		}

		if (source.slice(index, index + 9) === '<![CDATA[') {
			if (stack.length === 0) {
				throw buildError('XML CDATA exists outside the document element', { Code: 'CC26-XML-MALFORMED' });
			}
			const cdataEnd = source.indexOf(']]>', index + 9);
			if (cdataEnd < 0) {
				throw buildError('XML CDATA was not closed', { Code: 'CC26-XML-MALFORMED' });
			}
			stack[stack.length - 1].text += source.slice(index + 9, cdataEnd);
			index = cdataEnd + 3;
			continue;
		}

		if (source.slice(index, index + 2) === '<?') {
			const instructionEnd = source.indexOf('?>', index + 2);
			if (instructionEnd < 0) {
				throw buildError('XML processing instruction was not closed', { Code: 'CC26-XML-MALFORMED' });
			}
			index = instructionEnd + 2;
			continue;
		}

		if (source.slice(index, index + 2) === '<!') {
			throw buildError('XML document type and entity declarations are unsupported', { Code: 'CC26-XML-UNSUPPORTED' });
		}

		if (source.slice(index, index + 2) === '</') {
			const closeEnd = source.indexOf('>', index + 2);
			if (closeEnd < 0) {
				throw buildError('XML closing tag was not closed', { Code: 'CC26-XML-MALFORMED' });
			}
			const closingName = source.slice(index + 2, closeEnd).trim();
			const openNode = stack.pop();
			if (!openNode || openNode.name !== closingName) {
				throw buildError('XML closing tag did not match its opening tag', { Code: 'CC26-XML-MALFORMED', ClosingTag: closingName, OpeningTag: openNode && openNode.name });
			}
			index = closeEnd + 1;
			continue;
		}

		const tagEnd = findXmlTagEnd(source, index + 1);
		const parsedTag = parseXmlOpeningTag(source.slice(index + 1, tagEnd));
		const node = {
			name: parsedTag.name,
			attributes: parsedTag.attributes,
			children: [],
			text: ''
		};

		if (stack.length > 0) {
			stack[stack.length - 1].children.push(node);
		} else if (root) {
			throw buildError('XML contained more than one document element', { Code: 'CC26-XML-MALFORMED' });
		} else {
			root = node;
		}

		if (!parsedTag.selfClosing) {
			stack.push(node);
		}
		index = tagEnd + 1;
	}

	if (stack.length > 0) {
		throw buildError('XML document ended before all elements were closed', { Code: 'CC26-XML-MALFORMED', OpeningTag: stack[stack.length - 1].name });
	}
	if (!root) {
		throw buildError('XML response did not contain a document element', { Code: 'CC26-XML-MALFORMED' });
	}

	return root;
}

function findXmlTagEnd(source, startIndex) {
	let quote = '';

	for (let index = startIndex; index < source.length; index++) {
		const character = source[index];
		if (quote) {
			if (character === quote) {
				quote = '';
			}
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === '>') {
			return index;
		}
	}

	throw buildError('XML opening tag was not closed', { Code: 'CC26-XML-MALFORMED' });
}

function parseXmlOpeningTag(tagSource) {
	let content = String(tagSource || '').trim();
	let selfClosing = false;
	if (content[content.length - 1] === '/') {
		selfClosing = true;
		content = content.slice(0, -1).trim();
	}

	let index = 0;
	const name = readXmlName(content, index);
	if (!name) {
		throw buildError('XML opening tag did not include a valid name', { Code: 'CC26-XML-MALFORMED' });
	}
	index += name.length;
	const attributes = {};

	while (index < content.length) {
		while (/\s/.test(content[index])) {
			index++;
		}
		if (index >= content.length) {
			break;
		}

		const attributeName = readXmlName(content, index);
		if (!attributeName) {
			throw buildError('XML attribute did not include a valid name', { Code: 'CC26-XML-MALFORMED', Element: name });
		}
		index += attributeName.length;
		while (/\s/.test(content[index])) {
			index++;
		}
		if (content[index] !== '=') {
			throw buildError('XML attribute did not include an equals sign', { Code: 'CC26-XML-MALFORMED', Element: name, Attribute: attributeName });
		}
		index++;
		while (/\s/.test(content[index])) {
			index++;
		}
		const quote = content[index];
		if (quote !== '"' && quote !== "'") {
			throw buildError('XML attribute value was not quoted', { Code: 'CC26-XML-MALFORMED', Element: name, Attribute: attributeName });
		}
		const valueEnd = content.indexOf(quote, index + 1);
		if (valueEnd < 0) {
			throw buildError('XML attribute value was not closed', { Code: 'CC26-XML-MALFORMED', Element: name, Attribute: attributeName });
		}
		attributes[attributeName] = decodeXmlEntities(content.slice(index + 1, valueEnd));
		index = valueEnd + 1;
	}

	return { name: name, attributes: attributes, selfClosing: selfClosing };
}

function readXmlName(source, startIndex) {
	const match = String(source || '').slice(startIndex).match(/^[A-Za-z_][A-Za-z0-9_.:-]*/);
	return match ? match[0] : '';
}

function decodeXmlEntities(value) {
	return String(value || '').replace(/&([^;]+);/g, (match, entity) => {
		switch (entity) {
			case 'amp': return '&';
			case 'lt': return '<';
			case 'gt': return '>';
			case 'quot': return '"';
			case 'apos': return "'";
		}

		let codePoint = null;
		if (/^#x[0-9a-f]+$/i.test(entity)) {
			codePoint = parseInt(entity.slice(2), 16);
		} else if (/^#[0-9]+$/.test(entity)) {
			codePoint = parseInt(entity.slice(1), 10);
		}
		if (codePoint === null || !Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
			throw buildError('XML contained an unsupported entity', { Code: 'CC26-XML-UNSUPPORTED', Entity: entity });
		}
		return String.fromCodePoint(codePoint);
	});
}

function getXmlPathValue(node, path) {
	const pathNode = getXmlPathNode(node, path);
	return pathNode ? getXmlNodeText(pathNode).trim() : '';
}

function getXmlPathNode(node, path) {
	if (!node || !path || path.length === 0) {
		return null;
	}

	let currentNode = String(node.name || '').toLowerCase() === String(path[0]).toLowerCase()
		? node
		: findXmlNodes(node, candidate => String(candidate.name || '').toLowerCase() === String(path[0]).toLowerCase())[0];

	for (let index = 1; currentNode && index < path.length; index++) {
		currentNode = findDirectChild(currentNode, path[index]);
	}

	return currentNode || null;
}

function findDirectChild(node, name) {
	const expectedName = String(name || '').toLowerCase();
	for (let index = 0; node && index < node.children.length; index++) {
		if (String(node.children[index].name || '').toLowerCase() === expectedName) {
			return node.children[index];
		}
	}
	return null;
}

function findXmlNodes(node, predicate) {
	const matches = [];
	if (!node) {
		return matches;
	}
	if (predicate(node)) {
		matches.push(node);
	}
	for (let index = 0; index < node.children.length; index++) {
		const childMatches = findXmlNodes(node.children[index], predicate);
		for (let childIndex = 0; childIndex < childMatches.length; childIndex++) {
			matches.push(childMatches[childIndex]);
		}
	}
	return matches;
}

function getXmlNodeText(node) {
	let value = node && node.text ? node.text : '';
	for (let index = 0; node && index < node.children.length; index++) {
		value += getXmlNodeText(node.children[index]);
	}
	return value;
}

function getXmlAttributeValue(node, attributeName) {
	const expectedName = String(attributeName || '').toLowerCase();
	const attributeNames = Object.keys(node && node.attributes ? node.attributes : {});
	for (let index = 0; index < attributeNames.length; index++) {
		if (attributeNames[index].toLowerCase() === expectedName) {
			return node.attributes[attributeNames[index]];
		}
	}
	return '';
}

function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
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
	parentStandbyStateRequest,
	installParentMacros,
	sendMessageCommand,
	buildCompanionMessage,
	parseCompanionMessage,
	connectPeripheral,
	sendPeripheralHeartbeat,
	getCallStatus,
	parseXml
};

export { deviceComms };
