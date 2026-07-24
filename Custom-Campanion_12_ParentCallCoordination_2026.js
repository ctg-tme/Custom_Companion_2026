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
 * Date Created:            July 20, 2026
 * Revised:                 July 24, 2026
 * Version:                 1.0.6
 *
 * Description:             Parent Call Coordination controller for the Custom Companion solution.
 *                          Owns Parent Room Device call and BYOD detection, participant admission,
 *                          current-booking Meeting Password lookup, call-detail responses, and call
 *                          synchronization sent to registered Companion Devices.
 *
 * Documentation:           https://github.com/ctg-tme/Custom_Companion_2026/blob/main/docs/technical-reference.md
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Compatible RoomOS Parent Room Devices
 *
 * Code Dependencies:       None
 *
 * AI Generation:           Percentage: 95% (estimated)
 *                          Model(s): OpenAI Codex (GPT-5 family)
 *                          Instruction File(s): AGENTS.md,
 *                          https://github.com/ctg-tme/Bobbys_Macro_AI_Agents/blob/main/AGENTS.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

/*
 * Parent Call Coordination xAPI surface:
 * - Subscriptions/events: Status.Call.RemoteNumber (once), Event.CallSuccessful,
 *   Event.CallDisconnect, Event.CallFailed, Status.SystemUnit.State.NumberOfActiveCalls,
 *   Conference participant-list events, Status.Video.Output.Webcam.Mode, and
 *   Status.Video.Output.HDMI.Passthrough.Status.
 * - Reads: Command.Conference.ParticipantList.Search, Status.SystemUnit.State.NumberOfActiveCalls,
 *   Status.Call[1].CallId, Status.Call, Status.Conference.Call.MeetingPlatform,
 *   Status.Conference.Call.Webex.MeetingInviteLink, Status.Call[1].Protocol, and
 *   Command.Bookings.List with ScheduleType Current.
 * - Command: Command.Conference.Participant.Admit.
 * - Network read: DeviceComms getCallStatus for a registered Companion Device.
 */

const ADMISSION_CHECK_DEBOUNCE_MS = 1500;
const ADMISSION_POLL_INTERVAL_MS = 3000;
const ADMISSION_POLL_TIMEOUT_MS = 2 * 60 * 1000;

function createParentCallCoordination(options) {
	const dependencies = options || {};
	const xapi = dependencies.xapi;
	const log = dependencies.log;
	const utils = dependencies.utils;
	const deviceComms = dependencies.deviceComms;
	const HTTP_CLIENT_CONFIG = dependencies.httpClientConfig;
	const sendRegistrationResponse = dependencies.sendRegistrationResponse;
	const normalizeCompanionDeviceRecord = dependencies.normalizeCompanionDeviceRecord;
	const now = typeof dependencies.now === 'function' ? dependencies.now : Date.now;
	let registeredCompanionDevices = [];
	let admissionCheckTimeout = null;
	let admissionPollInterval = null;
	let admissionPollDeadline = 0;
	let admissionPollSawWaiting = false;
	let admissionInFlightParticipantIds = {};
	let admissionNoticeSerials = {};
	let activeParentCallDetails = null;
	let isCallDetectionReady = false;
	let pendingCallRemoteNumber = '';
	let callDetectionToken = 0;
	let parentActiveCallCount = 0;
	let nativeByodActive = false;
	let hdmiByodActive = false;
	let isByodSessionActive = false;
	let callStateReconciliationPromise = null;

	function setRegisteredCompanionDevices(value) {
		registeredCompanionDevices = Array.isArray(value) ? value : [];
	}

	async function start() {
		registerCallLifecycleHandlers();
		registerActiveCallCountHandler();
		registerParticipantListHandlers();
		registerByodHandlers();
		await reconcileCurrentCallState('ParentRuntimeInitialization', true);
		if (parentActiveCallCount < 1) {
			prepareCallDetection();
		}
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
			log.debug({ Message: 'Captured Parent Room Device call remote number', RemoteNumber: pendingCallRemoteNumber });
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
			admissionInFlightParticipantIds = {};
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
			log.debug({ Message: 'Parent Room Device active call count updated', ActiveCallCount: activeCallCount });

			if (activeCallCount > 0) {
				sendPendingCallSync(callDetectionToken, { Trigger: 'ActiveCallCount', ActiveCallCount: activeCallCount });
				if (!activeParentCallDetails && !pendingCallRemoteNumber) {
					reconcileCurrentCallState('ActiveCallCount', true).catch(error => {
						utils.softError({ Context: 'Failed to reconcile active Parent Room Device call from call count', ActiveCallCount: activeCallCount, Error: error });
					});
				}
				queueCompanionAdmissionCheck('ActiveCallCount');
				startAdmissionPolling('ActiveCallCount');
				return;
			}

			if (activeCallCount < 1) {
				activeParentCallDetails = null;
				admissionInFlightParticipantIds = {};
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
				log.debug({ Message: 'Failed to poll Companion Device admission', Reason: reason, Error: error.code || error.message || 'Unknown Companion Device admission polling error' });
			});
		}, ADMISSION_POLL_INTERVAL_MS);
		log.debug({ Message: 'Companion Device admission polling started', Reason: reason, IntervalMs: ADMISSION_POLL_INTERVAL_MS, TimeoutMs: ADMISSION_POLL_TIMEOUT_MS });
	}

	function stopAdmissionPolling(reason) {
		if (admissionPollInterval) {
			clearInterval(admissionPollInterval);
			admissionPollInterval = null;
			log.debug({ Message: 'Companion Device admission polling stopped', Reason: reason, SawWaiting: admissionPollSawWaiting });
		}
		admissionPollDeadline = 0;
		admissionPollSawWaiting = false;
	}

	async function runAdmissionPoll(reason) {
		if (parentActiveCallCount < 1) {
			stopAdmissionPolling('ParentCallEnded');
			return;
		}
		if (Date.now() > admissionPollDeadline) {
			stopAdmissionPolling('AdmissionPollTimeout');
			return;
		}

		const result = await processCompanionAdmission(`Poll:${reason}`);
		if (result.waitingCount > 0) {
			admissionPollSawWaiting = true;
			return;
		}

		if (admissionPollSawWaiting) {
			stopAdmissionPolling('CompanionDeviceNoLongerWaiting');
			return;
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
				log.debug({ Message: 'Failed to process debounced Companion Device admission check', Reason: reason, Error: error.code || error.message || 'Unknown Companion Device admission error' });
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
			log.debug({ Message: 'Companion Device admission skipped; participant roster unavailable', Reason: reason });
			return { waitingCount: 0 };
		}

		const hostCheck = getSelfHostStatus(roster);
		const waitingMatches = getWaitingCompanionParticipants(roster.participants);
		if (waitingMatches.length < 1) {
			log.debug({ Message: 'Companion Device admission skipped; no waiting Companion Devices found', Reason: reason, CanAdmit: hostCheck.canAdmit, IsHost: hostCheck.isHost, IsCohost: hostCheck.isCohost });
			return { waitingCount: 0, canAdmit: hostCheck.canAdmit };
		}

		if (!hostCheck.canAdmit) {
			await sendAdmissionRequired(waitingMatches, hostCheck);
			log.debug({ Message: 'Companion Device admission requires meeting host or cohost', Reason: reason, WaitingCompanionDeviceCount: waitingMatches.length, ParentSelfParticipantId: roster.participantSelf });
			return { waitingCount: waitingMatches.length, canAdmit: false };
		}

		const callId = await getActiveCallId();
		if (callId === null) {
			log.debug({ Message: 'Companion Device admission skipped; active CallId unavailable', Reason: reason, WaitingCompanionDeviceCount: waitingMatches.length });
			return { waitingCount: waitingMatches.length, canAdmit: true };
		}

		await Promise.all(waitingMatches.map(waitingMatch => admitCompanionParticipant(callId, waitingMatch)));

		return { waitingCount: waitingMatches.length, canAdmit: true };
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
		const isHost = !!(selfParticipant && isTrueValue(selfParticipant.IsHost));
		const isCohost = !!(selfParticipant && (isTrueValue(selfParticipant.CoHost) || isTrueValue(selfParticipant.IsCoHost) || isTrueValue(selfParticipant.IsCohost)));
		return {
			isHost: isHost,
			isCohost: isCohost,
			canAdmit: isHost || isCohost,
			participant: selfParticipant || null
		};
	}

	function isTrueValue(value) {
		const normalizedValue = getValue(value);
		return normalizedValue === true || normalizedValue === 1 || String(normalizedValue || '').toLowerCase() === 'true';
	}

	function getWaitingCompanionParticipants(participants) {
		const matches = [];

		for (let companionDeviceIndex = 0; companionDeviceIndex < registeredCompanionDevices.length; companionDeviceIndex++) {
			const companionDevice = registeredCompanionDevices[companionDeviceIndex];
			const companionDeviceName = normalizeName(companionDevice.Name);
			if (!companionDeviceName) {
				continue;
			}

			for (let participantIndex = 0; participantIndex < participants.length; participantIndex++) {
				const participant = participants[participantIndex];
				if (normalizeName(getValue(participant.DisplayName)) === companionDeviceName && normalizeName(getValue(participant.Status)) === 'waiting') {
					matches.push({ companionDevice: companionDevice, participant: participant });
				}
			}
		}

		return matches;
	}

	async function sendAdmissionRequired(waitingMatches, hostCheck) {
		const noticeRequests = [];
		for (let index = 0; index < waitingMatches.length; index++) {
			const match = waitingMatches[index];
			if (admissionNoticeSerials[match.companionDevice.Serial]) {
				continue;
			}

			noticeRequests.push((async () => {
				await sendRegistrationResponse('CallSync', { MessageId: '' }, match.companionDevice, {
					CallKind: 'AdmissionRequired',
					Reason: 'ParentNotHostOrCohost',
					DisplayName: getValue(match.participant.DisplayName) || match.companionDevice.Name,
					ParentIsHost: hostCheck.isHost,
					ParentIsCohost: hostCheck.isCohost
				}, true);
				admissionNoticeSerials[match.companionDevice.Serial] = true;
			})());
		}
		await Promise.all(noticeRequests);
	}

	async function admitCompanionParticipant(callId, waitingMatch) {
		const participantId = getValue(waitingMatch.participant.ParticipantId);
		if (!participantId || admissionInFlightParticipantIds[participantId]) {
			return;
		}

		admissionInFlightParticipantIds[participantId] = true;
		try {
			const validation = await validateCompanionDeviceCallIdentity(waitingMatch.companionDevice);
			if (!validation.isValid) {
				log.debug({ Message: 'Companion Device admission skipped; Companion Device call did not match Parent Room Device call', CompanionDeviceName: waitingMatch.companionDevice.Name, CompanionDeviceCallIdentities: validation.callIdentities, ParentCall: activeParentCallDetails });
				return;
			}

			await xapi.Command.Conference.Participant.Admit({ CallId: Number(callId), ParticipantId: participantId });
			delete admissionNoticeSerials[waitingMatch.companionDevice.Serial];
			await sendRegistrationResponse('CallSync', { MessageId: '' }, waitingMatch.companionDevice, {
				CallKind: 'AdmissionAdmitted',
				DisplayName: getValue(waitingMatch.participant.DisplayName) || waitingMatch.companionDevice.Name,
				ParentCanAdmit: true
			}, true);
			log.info({ Message: 'Companion Device admitted from lobby', DisplayName: getValue(waitingMatch.participant.DisplayName), ParticipantId: participantId, CallId: callId, MatchStrategy: validation.matchStrategy });
		} finally {
			delete admissionInFlightParticipantIds[participantId];
		}
	}

	async function validateCompanionDeviceCallIdentity(companionDevice) {
		if (!activeParentCallDetails) {
			return { isValid: false, callIdentities: [], matchStrategy: 'NoActiveParentCall' };
		}

		let companionDeviceCalls = [];
		try {
			companionDeviceCalls = await getCompanionDeviceCallStatus(companionDevice);
		} catch (error) {
			log.warn({ Message: 'Failed to read Companion Device call status before admission', CompanionDeviceName: companionDevice.Name, Host: companionDevice.Host, Error: error.code || error.message || 'Unknown Companion Device call status error', ErrorContext: error.Context || {} });
			return { isValid: false, callIdentities: [], matchStrategy: 'CompanionDeviceStatusUnavailable' };
		}

		const callIdentities = [];
		for (let index = 0; index < companionDeviceCalls.length; index++) {
			const values = [companionDeviceCalls[index].CallbackNumber, companionDeviceCalls[index].RemoteNumber, companionDeviceCalls[index].RemoteURI];
			for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
				const value = getValue(values[valueIndex]);
				if (value && callIdentities.indexOf(value) < 0) {
					callIdentities.push(value);
				}
			}
		}
		const hasExactIdentityMatch = callIdentities.some(identity => doesCompanionDeviceIdentityMatchParentCall(identity));
		const hasWebexCallMatch = !hasExactIdentityMatch && isWebexParentCall() && companionDeviceCalls.some(isWebexCompanionDeviceCall);

		return {
			isValid: hasExactIdentityMatch || hasWebexCallMatch,
			callIdentities: callIdentities,
			matchStrategy: hasExactIdentityMatch ? 'ExactCallIdentity' : hasWebexCallMatch ? 'RegisteredWaitingCompanionDeviceWebexCall' : 'NoMatch'
		};
	}

	async function getCompanionDeviceCallStatus(companionDevice) {
		return deviceComms.getCallStatus(xapi, {
			host: companionDevice.Host,
			username: companionDevice.Username,
			password: companionDevice.Password
		}, HTTP_CLIENT_CONFIG);
	}

	function doesCompanionDeviceIdentityMatchParentCall(companionDeviceIdentity) {
		const normalizedCompanionDeviceIdentity = normalizeCallIdentity(companionDeviceIdentity);
		const parentCallValues = [
			activeParentCallDetails.JoinTarget,
			activeParentCallDetails.MeetingInviteLink,
			activeParentCallDetails.DialedRemoteNumber,
			activeParentCallDetails.CallbackNumber,
			activeParentCallDetails.RemoteNumber,
			activeParentCallDetails.RemoteURI
		];

		for (let index = 0; index < parentCallValues.length; index++) {
			const normalizedParentValue = normalizeCallIdentity(parentCallValues[index]);
			if (normalizedParentValue && normalizedCompanionDeviceIdentity === normalizedParentValue) {
				return true;
			}
		}

		return false;
	}

	function isWebexParentCall() {
		if (!activeParentCallDetails) {
			return false;
		}
		const values = [activeParentCallDetails.MeetingPlatform, activeParentCallDetails.Protocol, activeParentCallDetails.JoinTarget, activeParentCallDetails.RemoteNumber, activeParentCallDetails.RemoteURI].join(' ').toLowerCase();
		return values.indexOf('webex') >= 0 || String(activeParentCallDetails.Protocol || '').toLowerCase() === 'spark';
	}

	function isWebexCompanionDeviceCall(call) {
		const values = [getValue(call.Protocol), getValue(call.CallbackNumber), getValue(call.RemoteNumber), getValue(call.RemoteURI)].join(' ').toLowerCase();
		return values.indexOf('webex') >= 0 || String(getValue(call.Protocol) || '').toLowerCase() === 'spark';
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
		await broadcastCallSync({
			CallKind: 'BYOD',
			ByodSource: source,
			ByodState: state
		});

		log.debug({ Message: 'Parent Room Device BYOD call sync sent', Source: source, State: state, RegisteredCompanionDeviceCount: registeredCompanionDevices.length });
	}

	async function sendCallSync(remoteNumber, call) {
		const callDetails = await getParentCallDetails(call || {});
		activeParentCallDetails = await getActiveParentCallDetails(remoteNumber, call || {}, callDetails);
		await sendNetworkCallSync(remoteNumber, callDetails, 'CallDetection');
		startAdmissionPolling('CallSync');
	}

	async function sendNetworkCallSync(remoteNumber, callDetails, reason) {
		await broadcastCallSync({
			CallKind: 'Network',
			RemoteNumber: remoteNumber || '',
			JoinTarget: activeParentCallDetails && activeParentCallDetails.JoinTarget || remoteNumber || '',
			MeetingPlatform: callDetails.meetingPlatform,
			Protocol: callDetails.protocol,
			ParentCall: activeParentCallDetails || {}
		});

		log.debug({ Message: 'Parent Room Device call sync sent', Reason: reason, RemoteNumber: remoteNumber || '', JoinTarget: activeParentCallDetails && activeParentCallDetails.JoinTarget || '', MeetingPlatform: callDetails.meetingPlatform, Protocol: callDetails.protocol, ParentCall: activeParentCallDetails, RegisteredCompanionDeviceCount: registeredCompanionDevices.length });
	}

	async function getActiveParentCallDetails(remoteNumber, call, callDetails) {
		const calls = await getCurrentCallStatus();
		const matchedCall = findMatchingCallStatus(calls, remoteNumber, call || {});
		const sourceCall = matchedCall || call || {};
		const meetingInviteLink = callDetails && callDetails.meetingInviteLink || '';
		const callbackNumber = getValue(sourceCall.CallbackNumber) || getValue(call.CallbackNumber) || '';

		return {
			CallId: getValue(sourceCall.CallId) || getValue(call.CallId) || '',
			DialedRemoteNumber: remoteNumber || '',
			JoinTarget: meetingInviteLink || callbackNumber || remoteNumber || getValue(sourceCall.RemoteNumber) || getValue(sourceCall.RemoteURI) || '',
			MeetingInviteLink: meetingInviteLink,
			MeetingPlatform: callDetails && callDetails.meetingPlatform || '',
			CallbackNumber: callbackNumber,
			RemoteNumber: getValue(sourceCall.RemoteNumber) || remoteNumber || getValue(call.RemoteNumber) || '',
			RemoteURI: getValue(sourceCall.RemoteURI) || getValue(call.RemoteURI) || '',
			Protocol: getValue(sourceCall.Protocol) || getValue(call.Protocol) || callDetails && callDetails.protocol || '',
			Direction: getValue(sourceCall.Direction) || getValue(call.Direction) || '',
			Status: getValue(sourceCall.Status) || getValue(call.Status) || '',
			id: getValue(sourceCall.id) || getValue(call.id) || ''
		};
	}

	async function reconcileCurrentCallState(reason, shouldBroadcast) {
		if (callStateReconciliationPromise) {
			return callStateReconciliationPromise;
		}

		callStateReconciliationPromise = (async () => {
			const reconciliationReads = await Promise.all([
				getCurrentCallStatus(),
				getCurrentActiveCallCount(reason)
			]);
			const calls = reconciliationReads[0];
			let activeCallCount = calls.length;
			const statusCount = reconciliationReads[1];
			if (statusCount !== null) {
				activeCallCount = statusCount;
			}
			parentActiveCallCount = activeCallCount;

			if (activeCallCount < 1) {
				activeParentCallDetails = null;
				if (shouldBroadcast) {
					await sendCallDisconnectSync(reason);
				}
				log.debug({ Message: 'Parent Room Device call-state reconciliation found no active call', Reason: reason });
				return null;
			}

			if (calls.length < 1) {
				log.debug({ Message: 'Parent Room Device call-state reconciliation found an active count without Status.Call details', Reason: reason, ActiveCallCount: activeCallCount });
				prepareCallDetection();
				return activeParentCallDetails;
			}

			const currentCall = calls[0];
			const remoteNumber = getValue(currentCall.CallbackNumber) || getValue(currentCall.RemoteNumber) || getValue(currentCall.RemoteURI) || '';
			const callDetails = await getParentCallDetails(currentCall);
			activeParentCallDetails = await getActiveParentCallDetails(remoteNumber, currentCall, callDetails);
			isCallDetectionReady = false;
			pendingCallRemoteNumber = '';
			if (shouldBroadcast) {
				await sendNetworkCallSync(remoteNumber, callDetails, reason);
			}
			queueCompanionAdmissionCheck(reason);
			startAdmissionPolling(reason);
			log.debug({ Message: 'Parent Room Device active call state reconciled', Reason: reason, ParentCall: activeParentCallDetails, Broadcast: !!shouldBroadcast });
			return activeParentCallDetails;
		})();

		try {
			return await callStateReconciliationPromise;
		} finally {
			callStateReconciliationPromise = null;
		}
	}

	async function getCurrentCallStatus() {
		try {
			return normalizeCallStatus(await xapi.Status.Call.get());
		} catch (error) {
			log.debug({ Message: 'Failed to read current Parent Room Device call status', Error: error.message || error.code || 'Unknown call status error' });
			return [];
		}
	}

	async function getCurrentActiveCallCount(reason) {
		try {
			const statusCount = Number(normalizeEventValue(await xapi.Status.SystemUnit.State.NumberOfActiveCalls.get()));
			return Number.isFinite(statusCount) ? statusCount : null;
		} catch (error) {
			log.debug({ Message: 'Failed to read Parent Room Device active call count during reconciliation; using Status.Call count', Reason: reason, Error: error.message || error.code || 'Unknown active call count error' });
			return null;
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
		const normalizedValue = String(value || '').trim().toLowerCase();
		const schemeSeparatorIndex = normalizedValue.indexOf(':');
		if (schemeSeparatorIndex < 0) {
			return normalizedValue;
		}

		return normalizedValue.slice(schemeSeparatorIndex + 1).trim();
	}

	async function sendCallDisconnectSync(reason) {
		await broadcastCallSync({
			CallKind: 'Disconnect',
			Reason: reason || 'ParentCallCountZero'
		});

		log.debug({ Message: 'Parent Room Device call disconnect sync sent', RegisteredCompanionDeviceCount: registeredCompanionDevices.length });
	}

	async function broadcastCallSync(payload) {
		const syncRequests = [];
		for (let index = 0; index < registeredCompanionDevices.length; index++) {
			syncRequests.push(sendRegistrationResponse('CallSync', { MessageId: '' }, registeredCompanionDevices[index], payload, true));
		}
		await Promise.all(syncRequests);
	}

	async function getParentCallDetails(call) {
		const detailValues = await Promise.all([
			getMeetingPlatform(call || {}),
			getCallProtocol(call || {}),
			getMeetingInviteLink()
		]);
		return {
			meetingPlatform: detailValues[0],
			protocol: detailValues[1],
			meetingInviteLink: detailValues[2]
		};
	}

	async function getMeetingPlatform(call) {
		if (getValue(call.MeetingPlatform)) {
			return getValue(call.MeetingPlatform);
		}
		try {
			return normalizeEventValue(await xapi.Status.Conference.Call.MeetingPlatform.get());
		} catch (error) {
			return '';
		}
	}

	async function getCallProtocol(call) {
		if (getValue(call.Protocol)) {
			return getValue(call.Protocol);
		}
		try {
			return normalizeEventValue(await xapi.Status.Call[1].Protocol.get());
		} catch (error) {
			return '';
		}
	}

	async function getMeetingInviteLink() {
		try {
			return normalizeEventValue(await xapi.Status.Conference.Call.Webex.MeetingInviteLink.get());
		} catch (error) {
			return '';
		}
	}

	async function handleMeetingPasswordRequest(message) {
		const payload = message && message.Payload || {};
		const requestId = String(payload.RequestId || '');
		const companionDeviceRecord = registeredCompanionDevices.find(companionDevice => companionDevice.Serial === message.Serial) || normalizeCompanionDeviceRecord(message);
		let resolution = {
			passwordAvailable: false,
			meetingPassword: '',
			reason: requestId ? 'NoMatchingCurrentBooking' : 'InvalidMeetingPasswordRequest'
		};

		if (requestId) {
			await reconcileCurrentCallState('MeetingPasswordRequest', false);
			if (!activeParentCallDetails) {
				resolution.reason = 'NoActiveParentCall';
			} else if (!isWebexParentCall()) {
				resolution.reason = 'ActiveParentCallIsNotWebex';
			} else {
				resolution = await resolveCurrentBookingMeetingPassword();
			}
		}

		await sendRegistrationResponse('MeetingPasswordResponse', message, companionDeviceRecord, {
			RequestId: requestId,
			PasswordAvailable: resolution.passwordAvailable,
			MeetingPassword: resolution.meetingPassword,
			Reason: resolution.reason
		}, true);
		log.info({
			Message: 'Parent Room Device Meeting Password lookup completed',
			Serial: message.Serial,
			RequestId: requestId,
			PasswordAvailable: resolution.passwordAvailable,
			Reason: resolution.reason
		});
	}

	async function resolveCurrentBookingMeetingPassword() {
		let response;
		try {
			response = await xapi.Command.Bookings.List({ ScheduleType: 'Current', Limit: 20 });
		} catch (error) {
			log.warn({ Message: 'Failed to list current Parent Room Device bookings for Meeting Password lookup', Error: error.message || error.code || 'Unknown Bookings List error' });
			return {
				passwordAvailable: false,
				meetingPassword: '',
				reason: 'BookingsListFailed'
			};
		}

		const bookings = normalizeBookingsList(response);
		const currentMatches = bookings.filter(booking =>
			isBookingCurrent(booking)
			&& doesBookingMatchActiveParentCall(booking)
		);
		if (currentMatches.length !== 1) {
			return {
				passwordAvailable: false,
				meetingPassword: '',
				reason: currentMatches.length > 1 ? 'AmbiguousCurrentBooking' : 'NoMatchingCurrentBooking'
			};
		}

		const meetingPassword = getBookingMeetingPassword(currentMatches[0]);
		if (!meetingPassword) {
			return {
				passwordAvailable: false,
				meetingPassword: '',
				reason: 'MatchingBookingHasNoPassword'
			};
		}

		return {
			passwordAvailable: true,
			meetingPassword: meetingPassword,
			reason: 'MatchingCurrentBooking'
		};
	}

	function normalizeBookingsList(response) {
		const commandResponse = response && response.CommandResponse || {};
		const result = commandResponse.BookingsListResult
			|| response && response.BookingsListResult
			|| response
			|| {};
		const bookings = result.Booking
			|| result.Bookings && result.Bookings.Booking
			|| [];
		return Array.isArray(bookings) ? bookings : bookings ? [bookings] : [];
	}

	function isBookingCurrent(booking) {
		const time = booking && booking.Time || {};
		const startTime = Date.parse(String(getValue(booking && booking.StartTime) || getValue(time.StartTime) || ''));
		let endTime = Date.parse(String(getValue(booking && booking.EndTime) || getValue(time.EndTime) || ''));
		if (!Number.isFinite(startTime)) {
			return false;
		}

		if (!Number.isFinite(endTime)) {
			const durationMinutes = Number(getValue(booking && booking.Duration) || getValue(time.Duration));
			if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
				return false;
			}
			endTime = startTime + durationMinutes * 60 * 1000;
		}

		const currentTime = Number(now());
		return Number.isFinite(currentTime) && currentTime >= startTime && currentTime <= endTime;
	}

	function doesBookingMatchActiveParentCall(booking) {
		if (!activeParentCallDetails) {
			return false;
		}

		const activeCallIdentities = [
			activeParentCallDetails.JoinTarget,
			activeParentCallDetails.MeetingInviteLink,
			activeParentCallDetails.DialedRemoteNumber,
			activeParentCallDetails.CallbackNumber,
			activeParentCallDetails.RemoteNumber,
			activeParentCallDetails.RemoteURI
		].map(normalizeCallIdentity).filter(value => !!value);
		const bookingIdentities = getBookingCallIdentities(booking);
		for (let index = 0; index < bookingIdentities.length; index++) {
			if (activeCallIdentities.indexOf(bookingIdentities[index]) >= 0) {
				return true;
			}
		}
		return false;
	}

	function getBookingCallIdentities(booking) {
		const webex = booking && booking.Webex || {};
		const dialInfo = booking && booking.DialInfo || {};
		const callsContainer = dialInfo.Calls || {};
		const calls = normalizeBookingsList({ Booking: callsContainer.Call || dialInfo.Call || [] });
		const values = [
			booking && booking.Number,
			booking && booking.MeetingNumber,
			booking && booking.JoinTarget,
			booking && booking.MeetingInviteLink,
			webex.Number,
			webex.MeetingNumber,
			webex.JoinTarget,
			webex.MeetingInviteLink,
			webex.Url,
			webex.URL
		];
		for (let index = 0; index < calls.length; index++) {
			values.push(calls[index].Number, calls[index].URI, calls[index].Url, calls[index].URL);
		}

		const identities = [];
		for (let index = 0; index < values.length; index++) {
			const identity = normalizeCallIdentity(getValue(values[index]));
			if (identity && identities.indexOf(identity) < 0) {
				identities.push(identity);
			}
		}
		return identities;
	}

	function getBookingMeetingPassword(booking) {
		const webex = booking && booking.Webex || {};
		const dialInfo = booking && booking.DialInfo || {};
		const candidates = [
			booking && booking.MeetingPassword,
			booking && booking.Password,
			webex.MeetingPassword,
			webex.Password,
			webex.JoinMeetingPassword,
			dialInfo.MeetingPassword,
			dialInfo.Password
		];
		for (let index = 0; index < candidates.length; index++) {
			const meetingPassword = String(getValue(candidates[index]) || '').trim().replace(/#+$/, '');
			if (meetingPassword) {
				return meetingPassword;
			}
		}
		return '';
	}

	async function handleActiveCallDetailsRequest(message) {
		const companionDeviceRecord = registeredCompanionDevices.find(companionDevice => companionDevice.Serial === message.Serial) || normalizeCompanionDeviceRecord(message);
		await reconcileCurrentCallState('ActiveCallDetailsRequest', false);
		await sendRegistrationResponse('CallSync', message, companionDeviceRecord, {
			CallKind: 'ActiveCallDetails',
			ParentHasActiveCall: !!activeParentCallDetails,
			RemoteNumber: activeParentCallDetails && activeParentCallDetails.DialedRemoteNumber || '',
			JoinTarget: activeParentCallDetails && activeParentCallDetails.JoinTarget || '',
			MeetingPlatform: activeParentCallDetails && activeParentCallDetails.MeetingPlatform || '',
			Protocol: activeParentCallDetails && activeParentCallDetails.Protocol || '',
			ParentCall: activeParentCallDetails || {},
			Request: message.Payload || {}
		}, true);
		startAdmissionPolling('ActiveCallDetailsRequest');
		log.debug({ Message: 'Parent Room Device active call details sent to Companion Device', Serial: message.Serial, ParentHasActiveCall: !!activeParentCallDetails, ParentCall: activeParentCallDetails });
	}


	return {
		setRegisteredCompanionDevices,
		start,
		handleActiveCallDetailsRequest,
		handleMeetingPasswordRequest
	};
}

const parentCallCoordination = {
	create: createParentCallCoordination
};

export { parentCallCoordination };
