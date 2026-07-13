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
 * Version:                 0.1.1.18
 *
 * Description:             A macro that facilitates a custom Companion Solution for Board Series endpoints with Wheel Kits
 *                          This is the Room Reference Macro, used as reference to install against parent Room Systems.
 *                          This macro will not be enabled if its name is Custom-Campanion_7_RoomReference_2026. On a proper install, it will be named Custom-Campanion_Room_2026
 *
 * Documentation:           N/A
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro Series
 *
 * Code Dependencies:       Memory-Storage-Functions-V2, Custom-Campanion_3_Utils_2026, Custom-Campanion_6_DeviceComms_2026
 *
 * AI Generation:           Percentage: 95%
 *                          Model(s): GPT-5.3-Codex
 *                          Instruction File(s): /Users/bomcgoni/.claude/rules/Bobby_McGonigles_Macro_Rule_Set_for_AI.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

import xapi from 'xapi';
import { MemoryStorage } from './Memory-Storage-Functions-V2';
import { utils } from './Custom-Campanion_3_Utils_2026';
import { deviceComms } from './Custom-Campanion_6_DeviceComms_2026';

const log = new utils.Logger('Custom-Campanion_RoomReference');

const STORAGE_MACRO_NAME = 'Custom-Campanion';
const REGISTERED_BOARDS_STORAGE_KEY = 'registeredBoards';
const BOARD_CONFIGS_STORAGE_KEY = 'boardConfigs';
const MAX_REGISTERED_BOARDS = 3;
const HTTP_CLIENT_CONFIG = {
	mode: 'On',
	allowInsecureHTTPS: true,
	maxConcurrentRequests: 3
};

const mem = new MemoryStorage(xapi, { StorageMacroName: STORAGE_MACRO_NAME });

let registeredBoards = [];
let boardConfigs = {};

async function init() {
	try { await deviceComms.initializeHttpClient(xapi, HTTP_CLIENT_CONFIG) } catch (error) { utils.hardError({ Context: 'Failed to initialize HTTPClient', Error: error }) };
	try { await mem.init() } catch (error) { utils.hardError({ Context: 'Failed to initialize memory', Error: error }) };

	registeredBoards = await readMemoryOrDefault(REGISTERED_BOARDS_STORAGE_KEY, []);
	boardConfigs = await readMemoryOrDefault(BOARD_CONFIGS_STORAGE_KEY, {});
	registerMessageHandler();
	log.info({ Message: 'Custom Campanion Room Reference initialized', RegisteredBoardCount: registeredBoards.length });
}

async function readMemoryOrDefault(key, defaultValue) {
	try {
		return await mem.read(key);
	} catch (error) {
		if (error.code === 'msfv2.r.3') {
			return defaultValue;
		}

		utils.hardError({ Context: `Failed to fetch memory key [${key}]`, Error: error });
		return defaultValue;
	}
}

function registerMessageHandler() {
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
	if (message.Action === 'ParentReadyRequest') {
		await handleParentReadyRequest(message);
		return;
	}

	if (message.Action === 'ConfigSync') {
		await handleConfigSync(message);
		return;
	}

	if (!isRegisteredBoard(message.Serial)) {
		await sendConfigRequired(message);
		return;
	}

	log.debug({ Message: 'Companion message received', Action: message.Action, Serial: message.Serial });
}

async function handleParentReadyRequest(message) {
	const boardRecord = normalizeBoardRecord(message);
	await sendRegistrationResponse('ParentReady', message, boardRecord, { Status: 'Ready' }, true);
}

async function handleConfigSync(message) {
	const boardRecord = normalizeBoardRecord(message);
	const syncedConfig = message.Payload && message.Payload.Config ? message.Payload.Config : {};
	const existingIndex = registeredBoards.findIndex(board => board.Serial === boardRecord.Serial);

	if (existingIndex === -1 && registeredBoards.length >= MAX_REGISTERED_BOARDS) {
		await sendRegistrationResponse('ConfigDenied', message, boardRecord, {
			Reason: 'MaxBoardsReached',
			MaxBoards: MAX_REGISTERED_BOARDS,
			RegisteredBoardCount: registeredBoards.length
		}, false);
		return;
	}

	if (existingIndex >= 0) {
		registeredBoards[existingIndex] = boardRecord;
	} else {
		registeredBoards.push(boardRecord);
	}

	boardConfigs[boardRecord.Serial] = syncedConfig;
	await mem.write(REGISTERED_BOARDS_STORAGE_KEY, registeredBoards);
	await mem.write(BOARD_CONFIGS_STORAGE_KEY, boardConfigs);
	await applySyncedConfig(syncedConfig);
	await sendRegistrationResponse('ConfigAccepted', message, boardRecord, {
		MaxBoards: MAX_REGISTERED_BOARDS,
		RegisteredBoardCount: registeredBoards.length
	}, true);
	log.info({ Message: 'Companion board configuration synced', Serial: boardRecord.Serial, Name: boardRecord.Name, RegisteredBoardCount: registeredBoards.length });
}

async function applySyncedConfig(syncedConfig) {
	if (syncedConfig && syncedConfig.httpClient) {
		await deviceComms.initializeHttpClient(xapi, {
			mode: 'On',
			allowInsecureHTTPS: syncedConfig.httpClient.allowInsecureHTTPS,
			maxConcurrentRequests: 3
		});
	}
}

function normalizeBoardRecord(message) {
	const source = message.Source || {};
	const payload = message.Payload || {};
	const board = payload.Board || {};
	const now = new Date().toISOString();

	return {
		Serial: board.Serial || message.Serial,
		Name: board.Name || source.Name || message.Serial,
		Host: board.Host || source.Host || '',
		Username: board.Username || '',
		Password: board.Password || '',
		MacAddress: board.MacAddress || source.MacAddress || '',
		ProductPlatform: board.ProductPlatform || '',
		Capabilities: payload.Capabilities || {},
		RegisteredAt: getRegisteredAt(board.Serial || message.Serial) || now,
		LastMessageAt: now
	};
}

function getRegisteredAt(serial) {
	const board = registeredBoards.find(item => item.Serial === serial);
	return board ? board.RegisteredAt : '';
}

function isRegisteredBoard(serial) {
	return registeredBoards.some(board => board.Serial === serial);
}

async function sendConfigRequired(message) {
	const boardRecord = normalizeBoardRecord(message);
	await sendRegistrationResponse('ConfigRequired', message, boardRecord, { Reason: 'BoardConfigNotSynced' }, false);
}

async function sendRegistrationResponse(action, inboundMessage, boardRecord, payload, isAccepted) {
	const parentSource = await getParentSource();
	const boardDevice = {
		host: boardRecord.Host,
		username: boardRecord.Username,
		password: boardRecord.Password
	};

	try {
		await deviceComms.sendMessageCommand(xapi, boardDevice, action, payload, {
			app: 'Companion Board 2026',
			serial: await getParentSerial(),
			source: parentSource
		}, HTTP_CLIENT_CONFIG);
	} catch (error) {
		await xapi.Command.UserInterface.Message.Prompt.Display({
			Title: 'Companion Registration Error',
			Text: `${isAccepted ? 'Accepted' : 'Denied'} ${boardRecord.Name}, but response failed. Check board credentials.`,
			Duration: 10
		});
		log.warn({ Message: 'Failed to send registration response to board', Action: action, Serial: boardRecord.Serial, Error: error.message || error.code || 'Unknown response error' });
	}
}

async function getParentSource() {
	return {
		Role: 'Parent',
		Name: await getParentName(),
		Host: ''
	};
}

async function getParentSerial() {
	try {
		return await xapi.Status.SystemUnit.Hardware.Module.SerialNumber.get();
	} catch (error) {
		return '';
	}
}

async function getParentName() {
	try {
		return await xapi.Status.SystemUnit.BroadcastName.get();
	} catch (error) {
		return '';
	}
}

init();
