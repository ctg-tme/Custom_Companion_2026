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
 * Date Created:            July 10, 2026
 * Revised:                 July 27, 2026
 * Version:                 1.0.30
 *
 * Description:             Companion Device provisioning payloads, peripheral identity, and runtime device-identity services.
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
			await options.deviceComms.installParentMacros(options.xapi, parentDevice, macroPayloads, options.installConfig);
			options.log.info({ Message: 'Parent Room Device macro installation completed', Host: parentDevice.host, MacroName: options.installConfig.roomReferenceTargetMacroName });
		} catch (error) {
			options.log.warn({ Message: 'Parent Room Device macro installation failed', Host: parentDevice.host, Error: error.code || error.message || 'Unknown Parent Room Device macro installation error', ErrorContext: error.Context || {} });
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
	const companionDeviceInformation = await getRuntimeCompanionDeviceInformation(options.xapi, options.companionDeviceInformation, options.log);
	const peripheralInfo = buildCompanionPeripheralInfo(companionDeviceInformation, options.configVersion, options.peripheralType);

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
			const connectResponse = await options.deviceComms.connectPeripheral(options.xapi, parentDevice, peripheralInfo);
			const heartbeatResponse = await options.deviceComms.sendPeripheralHeartbeat(options.xapi, parentDevice, peripheralInfo.ID, options.initialHeartbeatTimeout);
			await options.sendParentReadyRequest(parentDevice, companionDeviceInformation);
			options.log.debug({ Message: 'Companion Device peripheral connect HTTP response', Host: parentDevice.host, Response: sanitizeHttpResponse(connectResponse) });
			options.log.debug({ Message: 'Companion Device initial peripheral heartbeat HTTP response', Host: parentDevice.host, Response: sanitizeHttpResponse(heartbeatResponse), Timeout: options.initialHeartbeatTimeout });
			options.log.info({ Message: 'Companion Device peripheral connected to Parent Room Device', Host: parentDevice.host, PeripheralID: peripheralInfo.ID, Type: peripheralInfo.Type });
		} catch (error) {
			options.log.warn({ Message: 'Companion Device peripheral connect failed', Host: parentDevice.host, Error: error.code || error.message || 'Unknown peripheral connect error', ErrorContext: error.Context || {} });
		}
	}

	return peripheralInfo.ID;
}

async function getRuntimeCompanionDeviceInformation(XAPIObject, configuredCompanionDeviceInformation, log) {
	const companionDeviceInformation = configuredCompanionDeviceInformation || {};
	const identityValues = await Promise.all([
		getProductPlatform(XAPIObject, log),
		getCompanionDeviceSerialNumber(XAPIObject, log),
		getActiveNetworkMacAddress(XAPIObject, log),
		getCompanionDeviceName(XAPIObject, log)
	]);
	const productPlatform = identityValues[0];
	const serial = identityValues[1];
	const macAddress = identityValues[2];
	const name = identityValues[3];

	return {
		serial: serial,
		host: companionDeviceInformation.host || '',
		username: companionDeviceInformation.username || '',
		password: companionDeviceInformation.password || '',
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

async function getCompanionDeviceSerialNumber(XAPIObject, log) {
	try {
		return await XAPIObject.Status.SystemUnit.Hardware.Module.SerialNumber.get();
	} catch (error) {
		log.warn({ Message: 'Failed to fetch Companion Device serial number for peripheral registration', Error: error.message || error.code || 'Unknown serial number error' });
		return '';
	}
}

async function getCompanionDeviceName(XAPIObject, log) {
	try {
		return await XAPIObject.Status.SystemUnit.BroadcastName.get();
	} catch (error) {
		log.warn({ Message: 'Failed to fetch Companion Device name for registration', Error: error.message || error.code || 'Unknown Companion Device name error' });
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

function buildCompanionPeripheralInfo(companionDeviceInformation, configVersion, peripheralType) {
	return {
		ID: getCompanionPeripheralId(companionDeviceInformation),
		Name: companionDeviceInformation.name,
		NetworkAddress: companionDeviceInformation.host,
		SerialNumber: companionDeviceInformation.serial,
		HardwareInfo: companionDeviceInformation.productPlatform,
		SoftwareInfo: configVersion,
		Type: peripheralType
	};
}

function getCompanionPeripheralId(companionDeviceInformation) {
	return companionDeviceInformation.macAddress || companionDeviceInformation.serial || companionDeviceInformation.host || companionDeviceInformation.name;
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

const companionDeviceServices = {
	installParentMacrosOnOnlineParents,
	getParentInstallMacroPayloads,
	connectPeripheralToOnlineParents,
	getRuntimeCompanionDeviceInformation,
	buildCompanionPeripheralInfo,
	getCompanionPeripheralId
};

export { companionDeviceServices };
