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
 * Revised:                 July 21, 2026
 * Version:                 0.1.2.28
 *
 * Description:             Parent room entry and registration macro used as the install source.
 *                          The numbered source remains inactive on the board; parent installation renames
 *                          and activates it as Custom-Campanion_Room_2026.
 *
 * Documentation:           N/A
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro Series
 *
 * Code Dependencies:       Memory-Storage-Functions-V2, Custom-Campanion_3_Utils_2026, Custom-Campanion_6_DeviceComms_2026, Custom-Campanion_12_ParentCallCoordination_2026
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
import { parentCallCoordination } from './Custom-Campanion_12_ParentCallCoordination_2026';

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
const STANDBY_SYNC_DEBOUNCE_MS = 250;

const mem = new MemoryStorage(xapi, { StorageMacroName: STORAGE_MACRO_NAME });

let registeredBoards = [];
let boardConfigs = {};
let standbySyncTimeout = null;
let lastStandbyState = '';

const parentCallCoordinationController = parentCallCoordination.create({
	xapi: xapi,
	log: log,
	utils: utils,
	deviceComms: deviceComms,
	httpClientConfig: HTTP_CLIENT_CONFIG,
	sendRegistrationResponse: sendRegistrationResponse,
	normalizeBoardRecord: normalizeBoardRecord
});

async function init() {
	try {
		try {
			await deviceComms.initializeHttpClient(xapi, HTTP_CLIENT_CONFIG);
		} catch (error) {
			utils.hardError({
				Code: 'CC26-INIT-HTTPCLIENT',
				Component: 'RoomReference',
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
				Component: 'RoomReference',
				Context: 'Failed to initialize Memory-Storage-Functions-V2',
				Remediation: 'Verify the Memory-Storage-Functions-V2 dependency and storage macro, then restart the Macro Runtime.',
				Error: error
			});
		}

		registeredBoards = await readMemoryOrDefault(REGISTERED_BOARDS_STORAGE_KEY, []);
		boardConfigs = await readMemoryOrDefault(BOARD_CONFIGS_STORAGE_KEY, {});
		parentCallCoordinationController.setRegisteredBoards(registeredBoards);
		registerMessageHandler();
		registerStandbyStateHandler();
		parentCallCoordinationController.start();
		log.info({ Message: 'Custom Campanion Room Reference initialized', RegisteredBoardCount: registeredBoards.length });
	} catch (error) {
		const diagnostic = error.Diagnostic || {};
		log.error({
			Message: 'Custom Campanion Room Reference initialization stopped',
			Code: diagnostic.Code || error.code || 'CC26-INIT-UNKNOWN',
			Component: diagnostic.Component || 'RoomReference',
			Context: diagnostic.Context || 'Unhandled initialization failure',
			Remediation: diagnostic.Remediation || 'Diagnose the logged xAPI failure, then restart the Macro Runtime.',
			Error: error
		});
	}
}

async function readMemoryOrDefault(key, defaultValue) {
	try {
		return await mem.read(key);
	} catch (error) {
		if (error.code === 'msfv2.r.3') {
			return defaultValue;
		}

		utils.hardError({
			Code: 'CC26-INIT-MEMORY',
			Component: 'MemoryStorage',
			Context: `Failed to fetch memory key [${key}]`,
			Remediation: 'Verify Memory-Storage-Functions-V2 and the generated storage macro, then restart the Macro Runtime.',
			Error: error
		});
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

function registerStandbyStateHandler() {
	xapi.Status.Standby.State.on(state => {
		queueStandbySync(normalizeEventValue(state));
	});
}

function queueStandbySync(state) {
	lastStandbyState = state;

	if (standbySyncTimeout) {
		clearTimeout(standbySyncTimeout);
	}

	standbySyncTimeout = setTimeout(() => {
		standbySyncTimeout = null;
		sendStandbySync(lastStandbyState).catch(error => {
			utils.softError({ Context: 'Failed to send standby sync', State: lastStandbyState, Error: error });
		});
	}, STANDBY_SYNC_DEBOUNCE_MS);
}

async function sendStandbySync(state) {
	for (let index = 0; index < registeredBoards.length; index++) {
		await sendRegistrationResponse('StandbySync', { MessageId: '' }, registeredBoards[index], { State: state }, true);
	}

	log.info({ Message: 'Parent standby sync sent', State: state, RegisteredBoardCount: registeredBoards.length });
}

function normalizeEventValue(value) {
	if (value && typeof value === 'object' && value.Value !== undefined) {
		return value.Value;
	}

	return value;
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

	if (message.Action === 'ActiveCallDetailsRequest') {
		await parentCallCoordinationController.handleActiveCallDetailsRequest(message);
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
	parentCallCoordinationController.setRegisteredBoards(registeredBoards);

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
	const serial = board.Serial || message.Serial;
	const existingBoard = registeredBoards.find(item => item.Serial === serial) || {};
	const now = new Date().toISOString();

	return {
		Serial: serial,
		Name: board.Name || source.Name || message.Serial,
		Host: board.Host || source.Host || existingBoard.Host || '',
		Username: board.Username || existingBoard.Username || '',
		Password: board.Password || existingBoard.Password || '',
		MacAddress: board.MacAddress || source.MacAddress || '',
		ProductPlatform: board.ProductPlatform || '',
		Capabilities: payload.Capabilities || {},
		RegisteredAt: getRegisteredAt(serial) || now,
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
		log.warn({ Message: 'Failed to send registration response to board', Action: action, Serial: boardRecord.Serial, Error: error.code || error.message || 'Unknown response error', ErrorContext: error.Context || {} });
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
