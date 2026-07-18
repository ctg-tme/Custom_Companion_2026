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
 * Version:                 0.1.2.25
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
const STANDBY_SYNC_DEBOUNCE_MS = 250;
const ADMISSION_CHECK_DEBOUNCE_MS = 1500;
const ADMISSION_POLL_INTERVAL_MS = 3000;
const ADMISSION_POLL_TIMEOUT_MS = 2 * 60 * 1000;

const mem = new MemoryStorage(xapi, { StorageMacroName: STORAGE_MACRO_NAME });

let registeredBoards = [];
let boardConfigs = {};
let standbySyncTimeout = null;
let lastStandbyState = '';
let admissionCheckTimeout = null;
let admissionPollInterval = null;
let admissionPollDeadline = 0;
let admissionPollSawWaiting = false;
let admittedParticipantIds = {};
let admissionNoticeSerials = {};
let activeParentCallDetails = null;
let isCallDetectionReady = false;
let pendingCallRemoteNumber = '';
let callDetectionToken = 0;
let parentActiveCallCount = 0;
let nativeByodActive = false;
let hdmiByodActive = false;
let isByodSessionActive = false;

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
		registerMessageHandler();
		registerStandbyStateHandler();
		registerCallLifecycleHandlers();
		registerActiveCallCountHandler();
		registerParticipantListHandlers();
		registerByodHandlers();
		prepareCallDetection();
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

function prepareCallDetection() {
	if (isCallDetectionReady) {
		return;
	}

	isCallDetectionReady = true;
	callDetectionToken++;
	const detectionToken = callDetectionToken;
	pendingCallRemoteNumber = '';

	xapi.Status.Call.RemoteNumber.once(remoteNumber => {
		if (!isCallDetectionReady || detectionToken !== callDetectionToken) {
			return;
		}

		const capturedRemoteNumber = normalizeEventValue(remoteNumber) || '';
		if (!capturedRemoteNumber) {
			return;
		}

		pendingCallRemoteNumber = capturedRemoteNumber;
		log.info({ Message: 'Captured parent call remote number', RemoteNumber: pendingCallRemoteNumber });
		if (parentActiveCallCount > 0) {
			sendPendingCallSync(detectionToken, { Trigger: 'ActiveCallCount', ActiveCallCount: parentActiveCallCount });
			return;
		}

		xapi.Event.CallSuccessful.once(call => {
			sendPendingCallSync(detectionToken, call);
		});
	});
}

function sendPendingCallSync(detectionToken, call) {
	if (!isCallDetectionReady || detectionToken !== callDetectionToken || !pendingCallRemoteNumber) {
		return;
	}

	const remoteNumber = pendingCallRemoteNumber;
	isCallDetectionReady = false;
	sendCallSync(remoteNumber, call || {}).catch(error => {
		utils.softError({ Context: 'Failed to send call sync', RemoteNumber: remoteNumber, Call: call, Error: error });
	});
	queueCompanionAdmissionCheck('CallSync');
}

function registerCallLifecycleHandlers() {
	xapi.Event.CallDisconnect.on(() => {
		callDetectionToken++;
		pendingCallRemoteNumber = '';
		activeParentCallDetails = null;
		isCallDetectionReady = false;
		admittedParticipantIds = {};
		admissionNoticeSerials = {};
		clearAdmissionCheckTimeout();
		stopAdmissionPolling('CallDisconnect');
		prepareCallDetection();
	});

	xapi.Event.CallFailed.on(() => {
		callDetectionToken++;
		isCallDetectionReady = false;
		pendingCallRemoteNumber = '';
		activeParentCallDetails = null;
		prepareCallDetection();
	});
}

function registerActiveCallCountHandler() {
	xapi.Status.SystemUnit.State.NumberOfActiveCalls.on(callCount => {
		const activeCallCount = Number(normalizeEventValue(callCount));
		parentActiveCallCount = activeCallCount;
		log.debug({ Message: 'Parent active call count updated', ActiveCallCount: activeCallCount });

		if (activeCallCount > 0) {
			sendPendingCallSync(callDetectionToken, { Trigger: 'ActiveCallCount', ActiveCallCount: activeCallCount });
			queueCompanionAdmissionCheck('ActiveCallCount');
			startAdmissionPolling('ActiveCallCount');
			return;
		}

		if (activeCallCount < 1) {
			activeParentCallDetails = null;
			admittedParticipantIds = {};
			admissionNoticeSerials = {};
			clearAdmissionCheckTimeout();
			stopAdmissionPolling('ParentCallCountZero');
			sendCallDisconnectSync().catch(error => {
				utils.softError({ Context: 'Failed to send call disconnect sync', ActiveCallCount: activeCallCount, Error: error });
			});
		}
	});
}

function registerParticipantListHandlers() {
	if (xapi.Event.Conference && xapi.Event.Conference.ParticipantList && xapi.Event.Conference.ParticipantList.ParticipantUpdated && typeof xapi.Event.Conference.ParticipantList.ParticipantUpdated.on === 'function') {
		xapi.Event.Conference.ParticipantList.ParticipantUpdated.on(event => {
			log.debug({ Message: 'Conference participant list updated', Event: event });
			queueCompanionAdmissionCheck('Conference.ParticipantList.ParticipantUpdated');
			startAdmissionPolling('Conference.ParticipantList.ParticipantUpdated');
		});
		return;
	}

	const eventPaths = [
		['Conference', 'ParticipantList', 'Changed'],
		['Conference', 'ParticipantListUpdated'],
		['Conference', 'ParticipantUpdated']
	];
	let registered = false;

	for (let index = 0; index < eventPaths.length; index++) {
		const node = getXapiNode(xapi.Event, eventPaths[index]);
		if (!node || typeof node.on !== 'function') {
			continue;
		}

		node.on(event => {
			queueCompanionAdmissionCheck(eventPaths[index].join('.'));
			startAdmissionPolling(eventPaths[index].join('.'));
		});
		registered = true;
	}

	if (!registered) {
		log.debug({ Message: 'Participant list event subscription unavailable' });
	}
}

function startAdmissionPolling(reason) {
	if (parentActiveCallCount < 1 || admissionPollInterval) {
		return;
	}

	admissionPollSawWaiting = false;
	admissionPollDeadline = Date.now() + ADMISSION_POLL_TIMEOUT_MS;
	admissionPollInterval = setInterval(() => {
		runAdmissionPoll(reason).catch(error => {
			utils.softError({ Context: 'Failed to poll companion admission', Reason: reason, Error: error });
		});
	}, ADMISSION_POLL_INTERVAL_MS);
	log.info({ Message: 'Companion admission polling started', Reason: reason, IntervalMs: ADMISSION_POLL_INTERVAL_MS, TimeoutMs: ADMISSION_POLL_TIMEOUT_MS });
}

function stopAdmissionPolling(reason) {
	if (admissionPollInterval) {
		clearInterval(admissionPollInterval);
		admissionPollInterval = null;
		log.info({ Message: 'Companion admission polling stopped', Reason: reason, SawWaiting: admissionPollSawWaiting });
	}
	admissionPollDeadline = 0;
	admissionPollSawWaiting = false;
}

async function runAdmissionPoll(reason) {
	if (parentActiveCallCount < 1) {
		stopAdmissionPolling('ParentCallEnded');
		return;
	}

	const result = await processCompanionAdmission(`Poll:${reason}`);
	if (result.waitingCount > 0) {
		admissionPollSawWaiting = true;
		return;
	}

	if (admissionPollSawWaiting) {
		stopAdmissionPolling('CompanionBoardNoLongerWaiting');
		return;
	}

	if (Date.now() > admissionPollDeadline) {
		stopAdmissionPolling('AdmissionPollTimeout');
	}
}

function queueCompanionAdmissionCheck(reason) {
	if (parentActiveCallCount < 1) {
		return;
	}

	clearAdmissionCheckTimeout();
	admissionCheckTimeout = setTimeout(() => {
		admissionCheckTimeout = null;
		processCompanionAdmission(reason).catch(error => {
			utils.softError({ Context: 'Failed to process companion admission', Reason: reason, Error: error });
		});
	}, ADMISSION_CHECK_DEBOUNCE_MS);
}

function clearAdmissionCheckTimeout() {
	if (admissionCheckTimeout) {
		clearTimeout(admissionCheckTimeout);
		admissionCheckTimeout = null;
	}
}

async function processCompanionAdmission(reason) {
	const roster = await getParticipantRoster();
	if (!roster || roster.participants.length < 1) {
		log.debug({ Message: 'Companion admission skipped; participant roster unavailable', Reason: reason });
		return { waitingCount: 0 };
	}

	const hostCheck = getSelfHostStatus(roster);
	const waitingMatches = getWaitingCompanionParticipants(roster.participants);
	if (waitingMatches.length < 1) {
		log.debug({ Message: 'Companion admission skipped; no waiting companion boards found', Reason: reason, IsHost: hostCheck.isHost });
		return { waitingCount: 0, isHost: hostCheck.isHost };
	}

	if (!hostCheck.isHost) {
		await sendAdmissionRequired(waitingMatches, hostCheck);
		log.info({ Message: 'Companion admission requires meeting host', Reason: reason, WaitingBoardCount: waitingMatches.length, ParentSelfParticipantId: roster.participantSelf });
		return { waitingCount: waitingMatches.length, isHost: false };
	}

	const callId = await getActiveCallId();
	if (callId === null) {
		log.warn({ Message: 'Companion admission skipped; active CallId unavailable', Reason: reason, WaitingBoardCount: waitingMatches.length });
		return { waitingCount: waitingMatches.length, isHost: true };
	}

	for (let index = 0; index < waitingMatches.length; index++) {
		await admitCompanionParticipant(callId, waitingMatches[index]);
	}

	return { waitingCount: waitingMatches.length, isHost: true };
}

async function getParticipantRoster() {
	try {
		const response = await xapi.Command.Conference.ParticipantList.Search({ Limit: 1000 });
		const result = getParticipantListResult(response);
		return {
			participants: normalizeParticipants(result.Participant),
			participantSelf: getValue(result.ParticipantSelf),
			provider: getValue(result.Provider)
		};
	} catch (error) {
		log.warn({ Message: 'Failed to search conference participant list', Error: error.message || error.code || 'Unknown participant search error' });
		return null;
	}
}

function getParticipantListResult(response) {
	if (response && response.CommandResponse && response.CommandResponse.ParticipantListSearchResult) {
		return response.CommandResponse.ParticipantListSearchResult;
	}
	if (response && response.ParticipantListSearchResult) {
		return response.ParticipantListSearchResult;
	}
	return response || {};
}

function normalizeParticipants(participants) {
	if (!participants) {
		return [];
	}
	if (Array.isArray(participants)) {
		return participants;
	}
	return [participants];
}

function getSelfHostStatus(roster) {
	const selfParticipant = roster.participants.find(participant => getValue(participant.ParticipantId) === roster.participantSelf);
	return {
		isHost: !!(selfParticipant && getValue(selfParticipant.IsHost) === 'True'),
		participant: selfParticipant || null
	};
}

function getWaitingCompanionParticipants(participants) {
	const matches = [];

	for (let boardIndex = 0; boardIndex < registeredBoards.length; boardIndex++) {
		const board = registeredBoards[boardIndex];
		const boardName = normalizeName(board.Name);
		if (!boardName) {
			continue;
		}

		for (let participantIndex = 0; participantIndex < participants.length; participantIndex++) {
			const participant = participants[participantIndex];
			if (normalizeName(getValue(participant.DisplayName)) === boardName && normalizeName(getValue(participant.Status)) === 'waiting') {
				matches.push({ board: board, participant: participant });
			}
		}
	}

	return matches;
}

async function sendAdmissionRequired(waitingMatches, hostCheck) {
	for (let index = 0; index < waitingMatches.length; index++) {
		const match = waitingMatches[index];
		if (admissionNoticeSerials[match.board.Serial]) {
			continue;
		}

		await sendRegistrationResponse('CallSync', { MessageId: '' }, match.board, {
			CallKind: 'AdmissionRequired',
			Reason: 'ParentNotHost',
			DisplayName: getValue(match.participant.DisplayName) || match.board.Name,
			ParentIsHost: false
		}, true);
		admissionNoticeSerials[match.board.Serial] = true;
	}
}

async function admitCompanionParticipant(callId, waitingMatch) {
	const participantId = getValue(waitingMatch.participant.ParticipantId);
	if (!participantId) {
		return;
	}

	const validation = await validateBoardCallbackNumber(waitingMatch.board);
	if (!validation.isValid) {
		log.info({ Message: 'Companion admission skipped; board call callback did not match parent call', BoardName: waitingMatch.board.Name, CallbackNumbers: validation.callbackNumbers, ParentCall: activeParentCallDetails });
		return;
	}

	await xapi.Command.Conference.Participant.Admit({ CallId: Number(callId), ParticipantId: participantId });
	admittedParticipantIds[participantId] = true;
	await sendRegistrationResponse('CallSync', { MessageId: '' }, waitingMatch.board, {
		CallKind: 'AdmissionAdmitted',
		DisplayName: getValue(waitingMatch.participant.DisplayName) || waitingMatch.board.Name,
		ParentIsHost: true
	}, true);
	log.info({ Message: 'Companion board admitted from lobby', DisplayName: getValue(waitingMatch.participant.DisplayName), ParticipantId: participantId, CallId: callId });
}

async function validateBoardCallbackNumber(board) {
	if (!activeParentCallDetails) {
		return { isValid: false, callbackNumbers: [] };
	}

	let boardCalls = [];
	try {
		boardCalls = await getBoardCallStatus(board);
	} catch (error) {
		log.warn({ Message: 'Failed to read companion board call status before admission', BoardName: board.Name, Host: board.Host, Error: error.code || error.message || 'Unknown board call status error', ErrorContext: error.Context || {} });
		return { isValid: false, callbackNumbers: [] };
	}

	const callbackNumbers = [];
	for (let index = 0; index < boardCalls.length; index++) {
		const callbackNumber = getValue(boardCalls[index].CallbackNumber);
		if (callbackNumber) {
			callbackNumbers.push(callbackNumber);
		}
	}

	return {
		isValid: callbackNumbers.some(callbackNumber => doesCallbackMatchParentCall(callbackNumber)),
		callbackNumbers: callbackNumbers
	};
}

async function getBoardCallStatus(board) {
	return deviceComms.getCallStatus(xapi, {
		host: board.Host,
		username: board.Username,
		password: board.Password
	}, HTTP_CLIENT_CONFIG);
}

function doesCallbackMatchParentCall(callbackNumber) {
	const normalizedCallbackNumber = normalizeCallIdentity(callbackNumber);
	const parentCallValues = [
		activeParentCallDetails.DialedRemoteNumber,
		activeParentCallDetails.RemoteNumber,
		activeParentCallDetails.RemoteURI
	];

	for (let index = 0; index < parentCallValues.length; index++) {
		const normalizedParentValue = normalizeCallIdentity(parentCallValues[index]);
		if (normalizedParentValue && normalizedCallbackNumber === normalizedParentValue) {
			return true;
		}
	}

	return false;
}

async function getActiveCallId() {
	try {
		const callId = await xapi.Status.Call[1].CallId.get();
		if (callId !== undefined && callId !== '') {
			return Number(callId);
		}
	} catch (error) {
		// Fall through to aggregate call status.
	}

	try {
		const calls = normalizeCallStatus(await xapi.Status.Call.get());
		if (calls.length > 0) {
			const callId = calls[0].CallId || calls[0].id;
			return callId === undefined || callId === '' ? null : Number(callId);
		}
	} catch (error) {
		return null;
	}

	return null;
}

function normalizeCallStatus(callStatus) {
	if (!callStatus) {
		return [];
	}
	if (Array.isArray(callStatus)) {
		return callStatus;
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

function getValue(value) {
	if (value && typeof value === 'object' && value.Value !== undefined) {
		return value.Value;
	}
	return value;
}

function normalizeName(value) {
	return String(value || '').trim().toLowerCase();
}

function getXapiNode(root, path) {
	let node = root;
	for (let index = 0; index < path.length; index++) {
		if (!node || node[path[index]] === undefined) {
			return null;
		}
		node = node[path[index]];
	}
	return node;
}

function registerByodHandlers() {
	const webcamModeNode = getStatusNode(['Video', 'Output', 'Webcam', 'Mode']);
	if (webcamModeNode && typeof webcamModeNode.on === 'function') {
		webcamModeNode.on(value => {
			nativeByodActive = normalizeEventValue(value) !== 'Disconnected';
			updateByodState('NativeUsbC', normalizeEventValue(value));
		});
	}

	const hdmiPassthroughNode = getStatusNode(['Video', 'Output', 'HDMI', 'Passthrough', 'Status']);
	if (hdmiPassthroughNode && typeof hdmiPassthroughNode.on === 'function') {
		hdmiPassthroughNode.on(value => {
			hdmiByodActive = normalizeEventValue(value) === 'Active';
			updateByodState('HdmiPassthrough', normalizeEventValue(value));
		});
	}
}

function getStatusNode(path) {
	let node = xapi.Status;

	for (let index = 0; index < path.length; index++) {
		if (!node || node[path[index]] === undefined) {
			return null;
		}
		node = node[path[index]];
	}

	return node;
}

function updateByodState(source, state) {
	const nextByodState = nativeByodActive || hdmiByodActive;
	if (nextByodState === isByodSessionActive) {
		return;
	}

	isByodSessionActive = nextByodState;
	if (isByodSessionActive) {
		sendByodSync(source, state).catch(error => {
			utils.softError({ Context: 'Failed to send BYOD call sync', Source: source, State: state, Error: error });
		});
	}
}

async function sendByodSync(source, state) {
	for (let index = 0; index < registeredBoards.length; index++) {
		await sendRegistrationResponse('CallSync', { MessageId: '' }, registeredBoards[index], {
			CallKind: 'BYOD',
			ByodSource: source,
			ByodState: state
		}, true);
	}

	log.info({ Message: 'Parent BYOD call sync sent', Source: source, State: state, RegisteredBoardCount: registeredBoards.length });
}

async function sendCallSync(remoteNumber, call) {
	const callDetails = await getParentCallDetails();
	activeParentCallDetails = await getActiveParentCallDetails(remoteNumber, call || {});

	for (let index = 0; index < registeredBoards.length; index++) {
		await sendRegistrationResponse('CallSync', { MessageId: '' }, registeredBoards[index], {
			CallKind: 'Network',
			RemoteNumber: remoteNumber || '',
			MeetingPlatform: callDetails.meetingPlatform,
			Protocol: callDetails.protocol,
			ParentCall: activeParentCallDetails || call || {}
		}, true);
	}

	log.info({ Message: 'Parent call sync sent', RemoteNumber: remoteNumber || '', MeetingPlatform: callDetails.meetingPlatform, Protocol: callDetails.protocol, ParentCall: activeParentCallDetails, RegisteredBoardCount: registeredBoards.length });
	startAdmissionPolling('CallSync');
}

async function getActiveParentCallDetails(remoteNumber, call) {
	const calls = await getCurrentCallStatus();
	const matchedCall = findMatchingCallStatus(calls, remoteNumber, call || {});
	const sourceCall = matchedCall || call || {};

	return {
		CallId: getValue(sourceCall.CallId) || getValue(call.CallId) || '',
		DialedRemoteNumber: remoteNumber || '',
		RemoteNumber: getValue(sourceCall.RemoteNumber) || remoteNumber || getValue(call.RemoteNumber) || '',
		RemoteURI: getValue(sourceCall.RemoteURI) || getValue(call.RemoteURI) || '',
		Protocol: getValue(sourceCall.Protocol) || getValue(call.Protocol) || '',
		Direction: getValue(sourceCall.Direction) || getValue(call.Direction) || '',
		Status: getValue(sourceCall.Status) || getValue(call.Status) || '',
		id: getValue(sourceCall.id) || getValue(call.id) || ''
	};
}

async function getCurrentCallStatus() {
	try {
		return normalizeCallStatus(await xapi.Status.Call.get());
	} catch (error) {
		log.debug({ Message: 'Failed to read current parent call status', Error: error.message || error.code || 'Unknown call status error' });
		return [];
	}
}

function findMatchingCallStatus(calls, remoteNumber, call) {
	const expectedCallId = normalizeCallIdentity(getValue(call.CallId));
	const expectedRemoteUri = normalizeCallIdentity(getValue(call.RemoteURI));
	const expectedRemoteNumber = normalizeCallIdentity(remoteNumber || getValue(call.RemoteNumber));

	for (let index = 0; index < calls.length; index++) {
		const currentCall = calls[index];
		if (expectedCallId && normalizeCallIdentity(getValue(currentCall.CallId)) === expectedCallId) {
			return currentCall;
		}
		if (expectedRemoteUri && normalizeCallIdentity(getValue(currentCall.RemoteURI)) === expectedRemoteUri) {
			return currentCall;
		}
		if (expectedRemoteNumber && normalizeCallIdentity(getValue(currentCall.RemoteNumber)) === expectedRemoteNumber) {
			return currentCall;
		}
	}

	return calls.length === 1 ? calls[0] : null;
}

function normalizeCallIdentity(value) {
	return String(value || '').trim().toLowerCase();
}

async function sendCallDisconnectSync() {
	for (let index = 0; index < registeredBoards.length; index++) {
		await sendRegistrationResponse('CallSync', { MessageId: '' }, registeredBoards[index], {
			CallKind: 'Disconnect',
			Reason: 'ParentCallCountZero'
		}, true);
	}

	log.info({ Message: 'Parent call disconnect sync sent', RegisteredBoardCount: registeredBoards.length });
}

async function getParentCallDetails() {
	return {
		meetingPlatform: await getMeetingPlatform(),
		protocol: await getCallProtocol()
	};
}

async function getMeetingPlatform() {
	try {
		return await xapi.Status.Conference.Call.MeetingPlatform.get();
	} catch (error) {
		return '';
	}
}

async function getCallProtocol() {
	try {
		return await xapi.Status.Call[1].Protocol.get();
	} catch (error) {
		return '';
	}
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
		await handleActiveCallDetailsRequest(message);
		return;
	}

	log.debug({ Message: 'Companion message received', Action: message.Action, Serial: message.Serial });
}

async function handleActiveCallDetailsRequest(message) {
	const boardRecord = registeredBoards.find(board => board.Serial === message.Serial) || normalizeBoardRecord(message);
	await sendRegistrationResponse('CallSync', message, boardRecord, {
		CallKind: 'ActiveCallDetails',
		ParentHasActiveCall: !!activeParentCallDetails,
		ParentCall: activeParentCallDetails || {},
		Request: message.Payload || {}
	}, true);
	startAdmissionPolling('ActiveCallDetailsRequest');
	log.info({ Message: 'Parent active call details sent to board', Serial: message.Serial, ParentHasActiveCall: !!activeParentCallDetails, ParentCall: activeParentCallDetails });
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
