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
 * Revised:                 July 22, 2026
 * Version:                 1.0.27
 *
 * Description:             Board provisioning payloads, peripheral identity, and runtime device-identity services.
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
			options.log.warn({ Message: 'Parent macro installation failed', Host: parentDevice.host, Error: error.code || error.message || 'Unknown parent macro installation error', ErrorContext: error.Context || {} });
		}
	}
}

async function getParentInstallMacroPayloads(XAPIObject, installConfig) {
	return {
		roomReference: await getLocalMacroContent(XAPIObject, installConfig.roomReferenceSourceMacroName),
		parentCallCoordination: await getLocalMacroContent(XAPIObject, installConfig.parentCallCoordinationSourceMacroName),
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
			options.log.warn({ Message: 'Companion board peripheral connect failed', Host: parentDevice.host, Error: error.code || error.message || 'Unknown peripheral connect error', ErrorContext: error.Context || {} });
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
	getParentInstallMacroPayloads,
	connectPeripheralToOnlineParents,
	getRuntimeCompanionBoardInformation,
	buildCompanionPeripheralInfo,
	getCompanionPeripheralId
};

export { boardServices };
