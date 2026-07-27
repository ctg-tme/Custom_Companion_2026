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
 * Revised:                 July 27, 2026
 * Version:                 1.0.15
 *
 * Description:             Companion Device Call Synchronization controller for the Custom Companion solution.
 *                          Owns Companion Device call sync classification, Webex join and disconnect behavior,
 *                          Guest authentication, Paired call authorization, parent-state
 *                          reconciliation, rejoin checks, and user-facing call sync information.
 *
 * Documentation:           https://github.com/ctg-tme/Custom_Companion_2026/blob/main/docs/technical-reference.md
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro, Board Pro G2, Board Pro G3, Desk Pro, Desk, Desk Mini, Desk Pro G2
 *
 * Code Dependencies:       Custom-Campanion_4_UI_2026
 *
 * AI Generation:           Percentage: 95% (estimated)
 *                          Model(s): OpenAI Codex (GPT-5 family)
 *                          Instruction File(s): AGENTS.md,
 *                          https://github.com/ctg-tme/Bobbys_Macro_AI_Agents/blob/main/AGENTS.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

/*
 * Companion Device Call Synchronization xAPI surface:
 * - Subscriptions and initial reads: Status.SystemUnit.State.NumberOfActiveCalls and
 *   Status.Conference.Call.AuthenticationRequest.
 * - Conditional read: Status.Call when a Parent Room Device sends a disconnect sync.
 * - Commands: Command.Webex.Join, Command.Conference.Call.AuthenticationResponse,
 *   and Command.Call.Disconnect.
 * - Companion Device alerts are displayed and cleared through the shared
 *   ownership helpers in Custom-Campanion_4_UI_2026.
 * - Network command: DeviceComms sendMessageCommand to ActiveCallDetailsRequest after initialization,
 *   Parent selection, an unverified local call, a local call drop, each active-call monitor interval,
 *   and MeetingPasswordRequest when Guest authentication requires a password.
 * Only Webex automatic joins are implemented. The inert non-Webex reference paths below remain
 * deliberately separated from executable behavior for future investigation.
 */

function createCompanionDeviceCallSync(options) {
	const dependencies = options || {};
	const callbacks = dependencies.callbacks || {};
	const policy = dependencies.policy || {};
	let infoText = '';
	let syncToken = 0;
	let lastWebexPayload = null;
	let isRejoinInProgress = false;
	let activeCompanionDeviceCallCount = 0;
	let unauthorizedCallCheckTimeout = null;
	let unauthorizedCallNoticeTimeout = null;
	let unauthorizedCallNoticeToken = 0;
	let unauthorizedCallNoticeActive = false;
	let parentCallCheckInterval = null;
	let parentCallRequestInFlight = false;
	let joinCommandPendingUntil = 0;
	let authenticationRequest = 'None';
	let meetingPasswordRequestCounter = 0;
	let pendingMeetingPasswordRequest = null;
	let meetingPasswordNoticeActive = false;
	let meetingPasswordNoticeToken = 0;

	const UNAUTHORIZED_CALL_INFO_TEXT = 'Start calls from the Parent Room Device.';
	const UNAUTHORIZED_CALL_ALERT_TEXT = 'Calling is available through the Parent Room Device while this Companion Device is Paired. Start the call from the Parent Room Device, or run this Companion Device as Standalone to call directly.';
	const UNAUTHORIZED_CALL_ALERT_TITLE = 'Start Calls from Parent Room Device';
	const MEETING_PASSWORD_INFO_TEXT = 'Enter the meeting password manually on this Companion Device.';
	const MEETING_PASSWORD_ALERT_TITLE = 'Meeting Password Required';
	const MEETING_PASSWORD_ALERT_OWNER = 'board-call-sync:meeting-password';
	const BYOD_ALERT_OWNER = 'board-call-sync:unsupported-call';
	const CALL_JOIN_FAILURE_ALERT_OWNER = 'board-call-sync:join-failure';
	const UNAUTHORIZED_CALL_ALERT_OWNER = 'board-call-sync:unauthorized-call';

	function registerCallCountHandler() {
		dependencies.xapi.Status.SystemUnit.State.NumberOfActiveCalls.on(callCount => {
			const activeCallCount = Number(getXapiValue(callCount));
			activeCompanionDeviceCallCount = Number.isFinite(activeCallCount) ? activeCallCount : 0;
			if (activeCallCount < 1) {
				handleCallCountZero().catch(error => {
					dependencies.utils.softError({ Context: 'Failed to handle Companion Device call count zero', Error: error });
				});
				return;
			}
			joinCommandPendingUntil = 0;

			handleCallCountPositive('ActiveCallCount').catch(error => {
				dependencies.utils.softError({ Context: 'Failed to authorize active Companion Device call', Error: error });
			});
		});
	}

	function registerAuthenticationRequestHandler() {
		const statusNode = dependencies.xapi.Status.Conference
			&& dependencies.xapi.Status.Conference.Call
			&& dependencies.xapi.Status.Conference.Call.AuthenticationRequest;
		if (!statusNode || typeof statusNode.on !== 'function') {
			dependencies.log.warn({ Message: 'Conference call authentication request subscription unavailable' });
			return;
		}

		statusNode.on(value => {
			handleAuthenticationRequest(value, 'StatusChange').catch(error => {
				dependencies.utils.softError({ Context: 'Failed to handle Companion Device authentication request', Error: error });
			});
		});
	}

	async function initializeActiveCallCount() {
		try {
			const activeCallCount = Number(getXapiValue(await dependencies.xapi.Status.SystemUnit.State.NumberOfActiveCalls.get()));
			if (!Number.isFinite(activeCallCount)) {
				throw new Error('Initial active call count was not numeric');
			}
			activeCompanionDeviceCallCount = activeCallCount;
			dependencies.log.debug({ Message: 'Initial Companion Device active call count read', ActiveCallCount: activeCallCount });
			if (activeCallCount > 0) {
				await handleCallCountPositive('CompanionDeviceInitialization');
			}
		} catch (error) {
			dependencies.log.error({
				Code: 'CC26-CALL-COUNT-READ',
				Component: 'CompanionDeviceCallSync',
				Context: 'Failed to read the initial local active call count',
				Remediation: 'Diagnose Status.SystemUnit.State.NumberOfActiveCalls before relying on automatic Standalone transition behavior.',
				Error: error
			});
		}
	}

	async function initializeAuthenticationRequest() {
		const statusNode = dependencies.xapi.Status.Conference
			&& dependencies.xapi.Status.Conference.Call
			&& dependencies.xapi.Status.Conference.Call.AuthenticationRequest;
		if (!statusNode || typeof statusNode.get !== 'function') {
			dependencies.log.warn({ Message: 'Initial conference call authentication request read unavailable' });
			return;
		}

		try {
			await handleAuthenticationRequest(await statusNode.get(), 'CompanionDeviceInitialization');
		} catch (error) {
			if (isMissingIndexedStatusError(error)) {
				authenticationRequest = 'None';
				dependencies.log.debug({ Message: 'Initial conference call authentication request is unavailable while no conference call is active' });
				return;
			}
			dependencies.log.warn({ Message: 'Failed to read initial conference call authentication request', Error: error.message || error.code || 'Unknown authentication request read error' });
		}
	}

	async function handleAuthenticationRequest(value, reason) {
		const request = String(getXapiValue(value) || 'None');
		authenticationRequest = request;
		dependencies.log.debug({ Message: 'Companion Device conference authentication request updated', AuthenticationRequest: request, Reason: reason });

		if (request === 'None') {
			pendingMeetingPasswordRequest = null;
			await clearMeetingPasswordNotice('AuthenticationComplete');
			return;
		}

		const callId = await getActiveCompanionDeviceCallId();
		if (callId === null) {
			dependencies.log.warn({ Message: 'Conference authentication request ignored because the active Companion Device CallId is unavailable', AuthenticationRequest: request, Reason: reason });
			return;
		}

		if (requiresGuestRoleSelection(request)) {
			pendingMeetingPasswordRequest = null;
			await clearMeetingPasswordNotice('GuestAuthenticationAvailable');
			try {
				await sendGuestAuthenticationResponse(callId);
				if (requiresGuestMeetingPassword(request)) {
					await delay(getAuthenticationUiSettleMs());
					if (authenticationRequest !== request) {
						dependencies.log.debug({
							Message: 'Combined Guest authentication password lookup skipped because the authentication request changed during UI settle',
							PreviousAuthenticationRequest: request,
							AuthenticationRequest: authenticationRequest,
							CallId: callId
						});
						return;
					}
					const activeCallId = await getActiveCompanionDeviceCallId();
					if (activeCallId === null || Number(activeCallId) !== Number(callId)) {
						dependencies.log.debug({
							Message: 'Combined Guest authentication password lookup skipped because the call changed during UI settle',
							AuthenticationRequest: request,
							CallId: callId,
							ActiveCallId: activeCallId
						});
						return;
					}
					await requestMeetingPassword(callId, request);
				}
			} catch (error) {
				if (!requiresGuestMeetingPassword(request)) {
					throw error;
				}
				dependencies.log.info({
					Message: 'Guest role-only authentication response was not accepted; requesting Meeting Password for a combined response',
					AuthenticationRequest: request,
					CallId: callId,
					Error: error.message || error.code || 'Unknown authentication response error'
				});
				await requestMeetingPassword(callId, request);
			}
			return;
		}

		if (requiresGuestMeetingPassword(request)) {
			await requestMeetingPassword(callId, request);
			return;
		}

		pendingMeetingPasswordRequest = null;
		await showMeetingPasswordNotice('UnsupportedAuthenticationRequest');
		dependencies.log.warn({ Message: 'Conference authentication request cannot be satisfied under the Guest-only policy', AuthenticationRequest: request, CallId: callId });
	}

	async function sendGuestAuthenticationResponse(callId, meetingPassword) {
		const response = {
			CallId: Number(callId),
			ParticipantRole: 'Guest'
		};
		if (meetingPassword) {
			response.Pin = appendPinTerminator(meetingPassword);
		}

		await dependencies.xapi.Command.Conference.Call.AuthenticationResponse(response);
		dependencies.log.info({
			Message: 'Companion Device conference authentication response accepted',
			CallId: Number(callId),
			ParticipantRole: 'Guest',
			MeetingPasswordSupplied: !!meetingPassword
		});
	}

	async function requestMeetingPassword(callId, request) {
		const context = getRuntimeContext();
		const activeParentDevice = callbacks.getActiveParentDevice ? callbacks.getActiveParentDevice() : null;
		if (context.mode !== 'Paired' || !context.activeParentSerial || !activeParentDevice) {
			pendingMeetingPasswordRequest = null;
			await showMeetingPasswordNotice('ActiveParentUnavailable');
			dependencies.log.warn({ Message: 'Meeting Password lookup unavailable because the active Parent Room Device is unavailable', AuthenticationRequest: request, CallId: callId });
			return;
		}

		if (pendingMeetingPasswordRequest
			&& pendingMeetingPasswordRequest.parentSerial === context.activeParentSerial
			&& pendingMeetingPasswordRequest.callId === Number(callId)
			&& pendingMeetingPasswordRequest.authenticationRequest === request) {
			dependencies.log.debug({ Message: 'Meeting Password request already pending', AuthenticationRequest: request, CallId: callId, RequestId: pendingMeetingPasswordRequest.requestId });
			return;
		}

		const requestId = `meeting-password:${Date.now()}:${++meetingPasswordRequestCounter}`;
		pendingMeetingPasswordRequest = {
			requestId: requestId,
			parentSerial: context.activeParentSerial,
			callId: Number(callId),
			authenticationRequest: request
		};

		try {
			const companionDeviceInformation = callbacks.getRuntimeCompanionDeviceInformation ? await callbacks.getRuntimeCompanionDeviceInformation() : {};
			await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, activeParentDevice, dependencies.meetingPasswordRequestRoute, {
				RequestId: requestId,
				AuthenticationRequest: request
			}, {
				app: 'Companion Board 2026',
				serial: companionDeviceInformation.serial,
				source: {
					Role: 'Board',
					Name: companionDeviceInformation.name,
					Host: companionDeviceInformation.host,
					MacAddress: companionDeviceInformation.macAddress
				}
			});
			dependencies.log.info({ Message: 'Requested Meeting Password from active Parent Room Device', AuthenticationRequest: request, CallId: callId, RequestId: requestId });
		} catch (error) {
			pendingMeetingPasswordRequest = null;
			await showMeetingPasswordNotice('MeetingPasswordRequestFailed');
			dependencies.log.warn({ Message: 'Failed to request Meeting Password from active Parent Room Device', AuthenticationRequest: request, CallId: callId, Error: error.message || error.code || 'Unknown Meeting Password request error' });
		}
	}

	async function handleMeetingPasswordResponse(message) {
		const context = getRuntimeContext();
		const payload = message && message.Payload || {};
		const pendingRequest = pendingMeetingPasswordRequest;
		if (!pendingRequest
			|| message.Serial !== context.activeParentSerial
			|| pendingRequest.parentSerial !== context.activeParentSerial
			|| payload.RequestId !== pendingRequest.requestId
			|| !requiresGuestMeetingPassword(authenticationRequest)) {
			dependencies.log.debug({ Message: 'Ignored stale or unrelated Meeting Password response', SendingParentSerial: message && message.Serial || '', ActiveParentSerial: context.activeParentSerial || '', RequestId: payload.RequestId || '' });
			return;
		}

		const activeCallId = await getActiveCompanionDeviceCallId();
		if (activeCallId === null || Number(activeCallId) !== pendingRequest.callId) {
			pendingMeetingPasswordRequest = null;
			dependencies.log.debug({ Message: 'Ignored Meeting Password response because the authenticated call is no longer active', RequestId: payload.RequestId || '' });
			return;
		}

		pendingMeetingPasswordRequest = null;
		const meetingPassword = normalizeMeetingPassword(payload.MeetingPassword);
		if (!payload.PasswordAvailable || !meetingPassword) {
			await showMeetingPasswordNotice(payload.Reason || 'MeetingPasswordUnavailable');
			dependencies.log.info({ Message: 'Active Parent Room Device did not provide a matching Meeting Password', Reason: payload.Reason || 'MeetingPasswordUnavailable', RequestId: payload.RequestId || '' });
			return;
		}

		try {
			await sendGuestAuthenticationResponse(activeCallId, meetingPassword);
			await clearMeetingPasswordNotice('MeetingPasswordSubmitted');
		} catch (error) {
			await showMeetingPasswordNotice('MeetingPasswordSubmissionFailed');
			dependencies.log.warn({ Message: 'Failed to submit the Meeting Password as Guest', CallId: activeCallId, Error: error.message || error.code || 'Unknown authentication response error' });
		}
	}

	async function getActiveCompanionDeviceCallId() {
		try {
			const calls = normalizeCallStatusList(await dependencies.xapi.Status.Call.get());
			for (let index = 0; index < calls.length; index++) {
				const callId = calls[index].CallId !== undefined ? calls[index].CallId : calls[index].id;
				const numericCallId = Number(getXapiValue(callId));
				if (Number.isFinite(numericCallId)) {
					return numericCallId;
				}
			}
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to read active Companion Device CallId for conference authentication', Error: error.message || error.code || 'Unknown call status error' });
		}
		return null;
	}

	function requiresGuestRoleSelection(request) {
		return request === 'HostPinOrGuest'
			|| request === 'HostPinOrGuestPin'
			|| request === 'PanelistPinOrAttendee'
			|| request === 'PanelistPinOrAttendeePin';
	}

	function requiresGuestMeetingPassword(request) {
		return request === 'GuestPin'
			|| request === 'HostPinOrGuestPin'
			|| request === 'AnyHostPinOrGuestPin'
			|| request === 'PanelistPinOrAttendeePin';
	}

	function getAuthenticationUiSettleMs() {
		const settleMs = Number(policy.authenticationUiSettleMs);
		return Number.isFinite(settleMs) && settleMs >= 0 ? settleMs : 250;
	}

	function delay(durationMs) {
		return new Promise(resolve => setTimeout(resolve, durationMs));
	}

	function isMissingIndexedStatusError(error) {
		const message = String(error && (error.message || error.code) || error || '');
		return message.indexOf('No match on Path argument') >= 0;
	}

	function normalizeMeetingPassword(value) {
		return String(value || '').trim().replace(/#+$/, '');
	}

	function appendPinTerminator(value) {
		const password = normalizeMeetingPassword(value);
		return password ? `${password}#` : '';
	}

	async function showMeetingPasswordNotice(reason) {
		const noticeToken = ++meetingPasswordNoticeToken;
		meetingPasswordNoticeActive = true;
		await setInfo(MEETING_PASSWORD_INFO_TEXT);
		if (noticeToken !== meetingPasswordNoticeToken || !meetingPasswordNoticeActive) {
			return;
		}
		try {
			await dependencies.companionUi.showOwnedAlert(dependencies.xapi, {
				ownerId: MEETING_PASSWORD_ALERT_OWNER,
				ownershipToken: noticeToken,
				title: MEETING_PASSWORD_ALERT_TITLE,
				text: MEETING_PASSWORD_INFO_TEXT,
				duration: 0
			});
			if (noticeToken !== meetingPasswordNoticeToken || !meetingPasswordNoticeActive) {
				dependencies.companionUi.relinquishOwnedAlert(MEETING_PASSWORD_ALERT_OWNER, noticeToken);
			}
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to display manual Meeting Password alert', Reason: reason, Error: error.message || error.code || 'Unknown alert display error' });
		}
		dependencies.log.info({ Message: 'Manual Meeting Password entry requested', Reason: reason, UserGuidance: MEETING_PASSWORD_INFO_TEXT, NoticeDurationSeconds: 0 });
	}

	async function clearMeetingPasswordNotice(reason) {
		if (!meetingPasswordNoticeActive) {
			return;
		}
		const noticeToken = meetingPasswordNoticeToken;
		meetingPasswordNoticeToken++;
		meetingPasswordNoticeActive = false;
		if (infoText === MEETING_PASSWORD_INFO_TEXT) {
			await setInfo('');
		}
		try {
			await dependencies.companionUi.clearOwnedAlert(dependencies.xapi, MEETING_PASSWORD_ALERT_OWNER, noticeToken);
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to clear manual Meeting Password alert', Reason: reason, Error: error.message || error.code || 'Unknown alert clear error' });
		}
		dependencies.log.debug({ Message: 'Manual Meeting Password notice cleared', Reason: reason });
	}

	async function handleMessage(message) {
		const context = getRuntimeContext();
		if (message.Serial !== context.activeParentSerial) {
			dependencies.log.debug({ Message: 'Ignored call sync from a non-active Parent Room Device', SendingParentSerial: message.Serial, ActiveParentSerial: context.activeParentSerial });
			return;
		}

		const payload = message.Payload || {};
		if (shouldClearStandbySyncState(payload) && callbacks.clearStandbySyncState) {
			await callbacks.clearStandbySyncState();
		}
		await handlePayload(payload);
	}

	function shouldClearStandbySyncState(payload) {
		switch (payload && payload.CallKind) {
			case 'ActiveCallDetails':
				return !!payload.ParentHasActiveCall;
			case 'Network':
			case 'BYOD':
			case 'AdmissionRequired':
			case 'AdmissionAdmitted':
				return true;
			case 'Disconnect':
			default:
				return false;
		}
	}

	async function handlePayload(payload) {
		if (payload.CallKind === 'Disconnect') {
			syncToken++;
			lastWebexPayload = null;
			isRejoinInProgress = false;
			joinCommandPendingUntil = 0;
			authenticationRequest = 'None';
			pendingMeetingPasswordRequest = null;
			clearUnauthorizedCallCheck();
			stopParentCallMonitoring();
			await clearMeetingPasswordNotice('ParentCallDisconnected');
			await disconnectAllCalls();
			if (!unauthorizedCallNoticeActive) {
				await setInfo('');
			}
			dependencies.log.info({ Message: 'Parent Room Device call disconnect sync received', Payload: payload });
			return;
		}

		if (payload.CallKind === 'BYOD') {
			await clearUnauthorizedCallNotice('ParentBYODCallStarted');
			lastWebexPayload = null;
			joinCommandPendingUntil = 0;
			authenticationRequest = 'None';
			pendingMeetingPasswordRequest = null;
			clearUnauthorizedCallCheck();
			stopParentCallMonitoring();
			await clearMeetingPasswordNotice('ParentBYODCallStarted');
			const unsupportedPayload = { MeetingPlatform: 'BYOD' };
			await setInfo(getUnsupportedCallInfoText(unsupportedPayload));
			await dependencies.companionUi.showOwnedAlert(dependencies.xapi, {
				ownerId: BYOD_ALERT_OWNER,
				title: 'Unsupported Call Type',
				text: getUnsupportedCallAlertText(unsupportedPayload),
				duration: 15
			});
			await disconnectAllCalls();
			dependencies.log.debug({ Message: 'BYOD call sync received; Companion Device join not supported', Payload: payload });
			return;
		}

		if (payload.CallKind === 'AdmissionRequired') {
			await clearUnauthorizedCallNotice('ParentWebexCallStarted');
			await setInfo('A host or cohost needs to admit this Companion Device to the Webex call.');
			dependencies.log.debug({ Message: 'Parent Room Device cannot auto-admit Companion Device because it is not host or cohost', Payload: payload });
			return;
		}

		if (payload.CallKind === 'AdmissionAdmitted') {
			await clearUnauthorizedCallNotice('ParentWebexCallStarted');
			await setInfo('');
			dependencies.log.info({ Message: 'Companion Device admitted by Parent Room Device host', Payload: payload });
			return;
		}

		if (payload.CallKind === 'ActiveCallDetails') {
			await handleActiveCallDetailsResponse(payload);
			return;
		}

		const isWebexCall = isWebexCallPayload(payload);
		await clearUnauthorizedCallNotice(isWebexCall ? 'ParentWebexCallStarted' : 'ParentUnsupportedCallStarted');
		dependencies.log.debug({ Message: 'Call sync payload classified', IsWebexCall: isWebexCall, RemoteNumber: payload.RemoteNumber || '', JoinTarget: payload.JoinTarget || '', MeetingPlatform: payload.MeetingPlatform || '', Protocol: payload.Protocol || '', ParentProtocol: payload.ParentCall && payload.ParentCall.Protocol || '' });
		if (!isWebexCall) {
			syncToken++;
			lastWebexPayload = null;
			joinCommandPendingUntil = 0;
			authenticationRequest = 'None';
			pendingMeetingPasswordRequest = null;
			clearUnauthorizedCallCheck();
			stopParentCallMonitoring();
			await clearMeetingPasswordNotice('ParentUnsupportedCallStarted');
			await setInfo(getUnsupportedCallInfoText(payload));
			await disconnectAllCalls();
			dependencies.log.debug({ Message: 'Non-Webex call sync received; Companion Device join is out of scope', Payload: payload });
			return;
		}
		await synchronizeToParentCall(payload, 'CallSync');
	}

	async function handleCallCountPositive(reason) {
		const context = getRuntimeContext();
		if (context.mode !== 'Paired') {
			return;
		}

		if (lastWebexPayload) {
			clearUnauthorizedCallCheck();
			startParentCallMonitoring();
			return;
		}

		try {
			await requestActiveParentCallState(reason);
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to request Parent Room Device call state for an unverified Paired Companion Device call', Reason: reason, Error: error.message || error.code || 'Unknown Parent Room Device call state request error' });
		}
		scheduleUnauthorizedCallCheck(reason);
	}

	async function handleCallCountZero() {
		activeCompanionDeviceCallCount = 0;
		joinCommandPendingUntil = 0;
		authenticationRequest = 'None';
		pendingMeetingPasswordRequest = null;
		clearUnauthorizedCallCheck();
		stopParentCallMonitoring();
		if (callbacks.onCallCountZeroBoundary && await callbacks.onCallCountZeroBoundary()) {
			return;
		}

		const context = getRuntimeContext();
		if (context.mode !== 'Paired' || !lastWebexPayload || isRejoinInProgress) {
			return;
		}

		const activeParentDevice = callbacks.getActiveParentDevice ? callbacks.getActiveParentDevice() : null;
		if (!activeParentDevice) {
			dependencies.log.warn({ Message: 'Companion Device call ended; active Parent Room Device unavailable for rejoin check' });
			return;
		}

		isRejoinInProgress = true;
		await setInfo('Checking the active Parent Room Device call before rejoining.');
		try {
			await sendActiveCallDetailsRequest(activeParentDevice, 'CompanionDeviceCallEnded');
		} catch (error) {
			isRejoinInProgress = false;
			dependencies.log.warn({ Message: 'Failed to request Parent Room Device call details after Companion Device call ended', Host: activeParentDevice.host, Error: error.message || error.code || 'Unknown Parent Room Device call details request error' });
			return;
		}

		dependencies.log.info({ Message: 'Requested active Parent Room Device call details after Companion Device call ended', Host: activeParentDevice.host, Payload: lastWebexPayload });
	}

	async function requestActiveParentCallState(reason) {
		const context = getRuntimeContext();
		if (context.mode !== 'Paired') {
			return false;
		}

		const activeParentDevice = callbacks.getActiveParentDevice ? callbacks.getActiveParentDevice() : null;
		if (!activeParentDevice) {
			dependencies.log.debug({ Message: 'Active Parent Room Device unavailable for call-state reconciliation', Reason: reason });
			return false;
		}
		if (parentCallRequestInFlight) {
			dependencies.log.debug({ Message: 'Parent Room Device call-state reconciliation already in flight', Reason: reason, Host: activeParentDevice.host });
			return false;
		}

		parentCallRequestInFlight = true;
		try {
			await sendActiveCallDetailsRequest(activeParentDevice, reason || 'Unspecified');
			dependencies.log.debug({ Message: 'Requested active Parent Room Device call state', Reason: reason || 'Unspecified', Host: activeParentDevice.host });
			return true;
		} finally {
			parentCallRequestInFlight = false;
		}
	}

	async function sendActiveCallDetailsRequest(parentDevice, reason) {
		const companionDeviceInformation = callbacks.getRuntimeCompanionDeviceInformation ? await callbacks.getRuntimeCompanionDeviceInformation() : {};
		await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, parentDevice, dependencies.activeCallDetailsRoute, {
			Reason: reason || 'Unspecified',
			LastSyncedCall: lastWebexPayload || {}
		}, {
			app: 'Companion Board 2026',
			serial: companionDeviceInformation.serial,
			source: {
				Role: 'Board',
				Name: companionDeviceInformation.name,
				Host: companionDeviceInformation.host,
				MacAddress: companionDeviceInformation.macAddress
			}
		});
	}

	async function handleActiveCallDetailsResponse(payload) {
		const requestReason = payload.Request && payload.Request.Reason || 'Unspecified';
		if (!payload.ParentHasActiveCall) {
			const hadActiveCompanionDeviceCall = await hasActiveCompanionDeviceCall();
			syncToken++;
			lastWebexPayload = null;
			isRejoinInProgress = false;
			authenticationRequest = 'None';
			pendingMeetingPasswordRequest = null;
			clearUnauthorizedCallCheck();
			stopParentCallMonitoring();
			await clearMeetingPasswordNotice('ParentCallNotActive');
			if (hadActiveCompanionDeviceCall) {
				await showUnauthorizedCallNotice(requestReason);
				await disconnectAllCalls();
			} else if (!unauthorizedCallNoticeActive) {
				await setInfo('');
			}
			const reconciliationLog = hadActiveCompanionDeviceCall ? dependencies.log.info.bind(dependencies.log) : dependencies.log.debug.bind(dependencies.log);
			reconciliationLog({
				Message: hadActiveCompanionDeviceCall ? 'Direct Companion Device call disconnected; Paired calls must start from the Parent Room Device' : 'Parent Room Device call-state reconciliation found no active call',
				RequestReason: requestReason,
				DisconnectedCompanionDeviceCall: hadActiveCompanionDeviceCall,
				PairedCallPolicy: hadActiveCompanionDeviceCall ? 'While Paired, start calls from the Parent Room Device' : '',
				UserGuidance: hadActiveCompanionDeviceCall ? UNAUTHORIZED_CALL_INFO_TEXT : '',
				AlertGuidance: hadActiveCompanionDeviceCall ? UNAUTHORIZED_CALL_ALERT_TEXT : '',
				NoticeDurationSeconds: hadActiveCompanionDeviceCall ? getUnauthorizedCallNoticeDurationSeconds() : 0
			});
			return;
		}

		await clearUnauthorizedCallNotice('ActiveParentCallReconciled');
		const reconciledPayload = buildCallSyncPayload(payload);
		if (!isWebexCallPayload(reconciledPayload)) {
			await handlePayload(reconciledPayload);
			isRejoinInProgress = false;
			return;
		}

		if (requestReason === 'CompanionDeviceCallEnded' && lastWebexPayload && !findMatchingParentCall([payload.ParentCall || {}], lastWebexPayload)) {
			const skippedPayload = lastWebexPayload;
			lastWebexPayload = null;
			isRejoinInProgress = false;
			joinCommandPendingUntil = 0;
			await setInfo('');
			dependencies.log.info({ Message: 'Companion Device call ended and active Parent Room Device call did not match last synced call; rejoin skipped', ParentHasActiveCall: !!payload.ParentHasActiveCall, ParentCall: payload.ParentCall || {}, Payload: skippedPayload });
			return;
		}

		await synchronizeToParentCall(reconciledPayload, requestReason);
		isRejoinInProgress = false;
	}

	async function synchronizeToParentCall(payload, reason) {
		const previousPayload = lastWebexPayload;
		const hasActiveCall = await hasActiveCompanionDeviceCall();
		const isSamePendingJoin = !hasActiveCall
			&& Date.now() < joinCommandPendingUntil
			&& previousPayload
			&& findMatchingParentCall([payload.ParentCall || {}], previousPayload);
		const isAlreadyAuthorized = hasActiveCall && (
			(previousPayload && findMatchingParentCall([payload.ParentCall || {}], previousPayload)) ||
			await doesActiveCompanionDeviceCallMatchPayload(payload)
		);

		syncToken++;
		const joinToken = syncToken;
		lastWebexPayload = payload;
		clearUnauthorizedCallCheck();
		if (isSamePendingJoin) {
			dependencies.log.debug({ Message: 'Duplicate Parent Room Device call state accepted while Webex join is settling', Reason: reason, Payload: payload });
			return;
		}

		if (isAlreadyAuthorized) {
			activeCompanionDeviceCallCount = Math.max(activeCompanionDeviceCallCount, 1);
			startParentCallMonitoring();
			await setInfo('');
			dependencies.log.debug({ Message: 'Existing Companion Device call authorized by active Parent Room Device state', Reason: reason, Payload: payload });
			return;
		}

		if (hasActiveCall) {
			isRejoinInProgress = true;
			await disconnectAllCalls();
			dependencies.log.info({ Message: 'Disconnected Companion Device call that did not match the active Parent Room Device call', Reason: reason, Payload: payload });
		}

		if (reason === 'CompanionDeviceCallEnded') {
			await setInfo('Rejoining the Webex call from the active Parent Room Device.');
		}
		try {
			await joinParentCallOnce(payload, joinToken);
		} finally {
			isRejoinInProgress = false;
		}
	}

	async function joinParentCallOnce(payload, joinToken) {
		if (joinToken !== syncToken) {
			dependencies.log.info({ Message: 'Companion Device call join from Parent Room Device canceled', Payload: payload });
			return;
		}

		try {
			authenticationRequest = 'None';
			pendingMeetingPasswordRequest = null;
			await clearMeetingPasswordNotice('JoiningParentCall');
			await joinParentCall(payload);
			if (joinToken !== syncToken) {
				dependencies.log.info({ Message: 'Companion Device call join from Parent Room Device completed after cancellation', Payload: payload });
				return;
			}
			const settleMs = Number(policy.joinCommandSettleMs);
			joinCommandPendingUntil = Date.now() + (Number.isFinite(settleMs) ? Math.max(0, settleMs) : 10000);
			await setInfo(getCallJoinInfoText(payload));
			startParentCallMonitoring();
			dependencies.log.info({ Message: 'Companion Device call join from Parent Room Device accepted', Payload: payload });
		} catch (error) {
			lastWebexPayload = null;
			joinCommandPendingUntil = 0;
			stopParentCallMonitoring();
			await setInfo(getCallJoinFailureInfoText(payload));
			await dependencies.companionUi.showOwnedAlert(dependencies.xapi, {
				ownerId: CALL_JOIN_FAILURE_ALERT_OWNER,
				title: 'Call Sync Failed',
				text: getCallJoinFailureAlertText(payload),
				duration: 20
			});
			dependencies.utils.softError({ Context: 'Failed to join Parent Room Device call', Error: error, Payload: payload });
		}
	}

	async function joinParentCall(payload) {
		const remoteNumber = payload.JoinTarget || payload.RemoteNumber || '';

		if (!remoteNumber) {
			throw new Error('Cannot join parent call without a Webex join target');
		}

		if (isWebexCallPayload(payload)) {
			return dependencies.xapi.Command.Webex.Join({ Number: remoteNumber, ParticipantRole: 'Guest', TrackingData: 'CustomCompanion2026' });
		}

		throw new Error('Only Webex call sync join is in scope for the Custom Companion solution');
	}

	/*
	 * Out of scope: non-Webex join handling.
	 * Zoom, Microsoft Teams, Google Meet, SIP, and H.323 auto-join paths are intentionally disabled.
	 * Zoom has additional limitations, especially when the Zoom App experience or generic Zoom bridge
	 * formats are involved. Keep non-Webex detection executable so the Web Widget info block can tell
	 * users that the Companion Device will only join Webex calls.
	 *
	 * Previous reference implementation, retained for future investigation:
	 *
	 * const zoomMeetingInfo = parseZoomJoinTarget(remoteNumber);
	 * if (zoomMeetingInfo) {
	 *   try {
	 *     return await dependencies.xapi.Command.Zoom.Join(zoomMeetingInfo);
	 *   } catch (error) {
	 *     if (isZoomMeetingIdTooShortError(error)) {
	 *       dependencies.log.warn({ Message: 'Zoom MeetingID too short; falling back to Dial', RemoteNumber: remoteNumber, Error: error.message || error.code || 'Unknown Zoom join error' });
	 *       return dialParentCall(remoteNumber, 'sip');
	 *     }
	 *     throw error;
	 *   }
	 * }
	 * if (meetingPlatform.indexOf('google') >= 0) {
	 *   return dependencies.xapi.Command.WebRTC.Join({ Type: 'GoogleMeet', Url: remoteNumber, TrackingData: 'CustomCompanion2026' });
	 * }
	 * if (meetingPlatform.indexOf('microsoft') >= 0 || meetingPlatform.indexOf('teams') >= 0) {
	 *   return dependencies.xapi.Command.MicrosoftTeams.Join({ Url: remoteNumber, TrackingData: 'CustomCompanion2026' });
	 * }
	 * return dialParentCall(remoteNumber, protocol);
	 */

	// Out of scope reference functions kept commented for future investigation:
	// function dialParentCall(options, remoteNumber, protocol) { ... }
	// function isZoomMeetingIdTooShortError(error) { ... }
	// function parseZoomJoinTarget(remoteNumber) { ... }
	// function parseZoomMeetingUrl(remoteNumber) { ... }
	// function parseZoomSipAddress(remoteNumber) { ... }

	async function disconnectAllCalls() {
		let calls = [];
		try {
			calls = normalizeCallStatusList(await dependencies.xapi.Status.Call.get());
		} catch (error) {
			dependencies.log.warn({ Message: 'Companion Device call status read failed; attempting one aggregate disconnect', Error: error.message || error.code || 'Unknown call status error' });
			await dependencies.xapi.Command.Call.Disconnect();
			return;
		}

		if (calls.length < 1) {
			dependencies.log.debug({ Message: 'Companion Device has no active calls to disconnect' });
			return;
		}

		for (let index = 0; index < calls.length; index++) {
			const callId = calls[index].CallId || calls[index].id;
			if (callId === undefined || callId === '') {
				await dependencies.xapi.Command.Call.Disconnect();
			} else {
				await dependencies.xapi.Command.Call.Disconnect({ CallId: Number(callId) });
			}
		}

		dependencies.log.debug({ Message: 'Companion Device disconnected all calls', CallCount: calls.length });
	}

	async function hasActiveCompanionDeviceCall() {
		try {
			const activeCallCount = Number(getXapiValue(await dependencies.xapi.Status.SystemUnit.State.NumberOfActiveCalls.get()));
			if (!Number.isFinite(activeCallCount)) {
				throw new Error('Active call count was not numeric');
			}
			activeCompanionDeviceCallCount = activeCallCount;
			return activeCallCount > 0;
		} catch (error) {
			dependencies.log.warn({ Message: 'Could not verify the Paired Call Limit; new Parent Room Device call join ignored', Error: error.message || error.code || 'Unknown call count error' });
			return true;
		}
	}

	async function doesActiveCompanionDeviceCallMatchPayload(payload) {
		let calls = [];
		try {
			calls = normalizeCallStatusList(await dependencies.xapi.Status.Call.get());
		} catch (error) {
			dependencies.log.warn({ Message: 'Could not compare active Companion Device call with Parent Room Device call state', Error: error.message || error.code || 'Unknown Companion Device call status error' });
			return false;
		}

		const parentCall = payload.ParentCall || {};
		const expectedValues = [
			payload.JoinTarget,
			payload.RemoteNumber,
			parentCall.JoinTarget,
			parentCall.DialedRemoteNumber,
			parentCall.CallbackNumber,
			parentCall.RemoteNumber,
			parentCall.RemoteURI
		].map(normalizeCallIdentity).filter(value => !!value);

		for (let callIndex = 0; callIndex < calls.length; callIndex++) {
			const call = calls[callIndex];
			const companionDeviceValues = [call.CallbackNumber, call.RemoteNumber, call.RemoteURI].map(normalizeCallIdentity).filter(value => !!value);
			for (let valueIndex = 0; valueIndex < companionDeviceValues.length; valueIndex++) {
				if (expectedValues.indexOf(companionDeviceValues[valueIndex]) >= 0) {
					return true;
				}
			}
		}

		return false;
	}

	function buildCallSyncPayload(payload) {
		const parentCall = payload.ParentCall || {};
		return {
			CallKind: 'Network',
			RemoteNumber: payload.RemoteNumber || parentCall.DialedRemoteNumber || parentCall.CallbackNumber || parentCall.RemoteNumber || parentCall.RemoteURI || '',
			JoinTarget: payload.JoinTarget || parentCall.JoinTarget || parentCall.MeetingInviteLink || parentCall.DialedRemoteNumber || parentCall.CallbackNumber || parentCall.RemoteNumber || parentCall.RemoteURI || '',
			MeetingPlatform: payload.MeetingPlatform || parentCall.MeetingPlatform || '',
			Protocol: payload.Protocol || parentCall.Protocol || '',
			ParentCall: parentCall
		};
	}

	function scheduleUnauthorizedCallCheck(reason) {
		clearUnauthorizedCallCheck();
		const graceMs = Number(policy.unauthorizedCallGraceMs);
		unauthorizedCallCheckTimeout = setTimeout(() => {
			unauthorizedCallCheckTimeout = null;
			enforceUnauthorizedCall(reason).catch(error => {
				dependencies.utils.softError({ Context: 'Failed to enforce Paired Companion Device call authorization', Reason: reason, Error: error });
			});
		}, Number.isFinite(graceMs) ? Math.max(0, graceMs) : 5000);
	}

	function clearUnauthorizedCallCheck() {
		if (unauthorizedCallCheckTimeout) {
			clearTimeout(unauthorizedCallCheckTimeout);
			unauthorizedCallCheckTimeout = null;
		}
	}

	async function enforceUnauthorizedCall(reason) {
		const context = getRuntimeContext();
		if (context.mode !== 'Paired' || lastWebexPayload || !await hasActiveCompanionDeviceCall()) {
			return;
		}

		syncToken++;
		await showUnauthorizedCallNotice(reason);
		await disconnectAllCalls();
		dependencies.log.warn({
			Message: 'Direct Companion Device call disconnected; Paired calls must start from the Parent Room Device',
			Reason: reason,
			PairedCallPolicy: 'While Paired, start calls from the Parent Room Device',
			UserGuidance: UNAUTHORIZED_CALL_INFO_TEXT,
			AlertGuidance: UNAUTHORIZED_CALL_ALERT_TEXT,
			NoticeDurationSeconds: getUnauthorizedCallNoticeDurationSeconds()
		});
	}

	async function showUnauthorizedCallNotice(reason) {
		const noticeDurationMs = getUnauthorizedCallNoticeDurationMs();
		const noticeToken = ++unauthorizedCallNoticeToken;
		clearUnauthorizedCallNoticeTimeout();
		unauthorizedCallNoticeActive = true;
		await setInfo(UNAUTHORIZED_CALL_INFO_TEXT);
		if (noticeToken !== unauthorizedCallNoticeToken || !unauthorizedCallNoticeActive) {
			return;
		}
		unauthorizedCallNoticeTimeout = setTimeout(() => {
			unauthorizedCallNoticeTimeout = null;
			if (noticeToken !== unauthorizedCallNoticeToken || !unauthorizedCallNoticeActive) {
				return;
			}
			unauthorizedCallNoticeActive = false;
			if (infoText !== UNAUTHORIZED_CALL_INFO_TEXT) {
				return;
			}
			setInfo('').catch(error => {
				dependencies.utils.softError({ Context: 'Failed to clear the Paired calling policy Infoblock notice', Error: error });
			});
		}, noticeDurationMs);

		try {
			await dependencies.companionUi.showOwnedAlert(dependencies.xapi, {
				ownerId: UNAUTHORIZED_CALL_ALERT_OWNER,
				ownershipToken: noticeToken,
				title: UNAUTHORIZED_CALL_ALERT_TITLE,
				text: UNAUTHORIZED_CALL_ALERT_TEXT,
				duration: getUnauthorizedCallNoticeDurationSeconds()
			});
			if (noticeToken !== unauthorizedCallNoticeToken || !unauthorizedCallNoticeActive) {
				dependencies.companionUi.relinquishOwnedAlert(UNAUTHORIZED_CALL_ALERT_OWNER, noticeToken);
			}
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to display Paired calling policy alert', Reason: reason, Error: error.message || error.code || 'Unknown alert display error' });
		}

		dependencies.log.debug({
			Message: 'Paired calling policy notice displayed',
			Reason: reason,
			UserGuidance: UNAUTHORIZED_CALL_INFO_TEXT,
			AlertGuidance: UNAUTHORIZED_CALL_ALERT_TEXT,
			NoticeDurationSeconds: getUnauthorizedCallNoticeDurationSeconds()
		});
	}

	async function clearUnauthorizedCallNotice(reason) {
		const wasActive = unauthorizedCallNoticeActive;
		const noticeToken = unauthorizedCallNoticeToken;
		unauthorizedCallNoticeToken++;
		unauthorizedCallNoticeActive = false;
		clearUnauthorizedCallNoticeTimeout();
		if (infoText === UNAUTHORIZED_CALL_INFO_TEXT) {
			await setInfo('');
		}
		if (!wasActive) {
			return;
		}
		await clearUnauthorizedCallAlert(reason, noticeToken);
		dependencies.log.debug({ Message: 'Paired calling policy notice cleared early', Reason: reason });
	}

	async function clearUnauthorizedCallAlert(reason, noticeToken) {
		try {
			await dependencies.companionUi.clearOwnedAlert(dependencies.xapi, UNAUTHORIZED_CALL_ALERT_OWNER, noticeToken);
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to clear Paired calling policy alert', Reason: reason, Error: error.message || error.code || 'Unknown alert clear error' });
		}
	}

	function clearUnauthorizedCallNoticeTimeout() {
		if (unauthorizedCallNoticeTimeout) {
			clearTimeout(unauthorizedCallNoticeTimeout);
			unauthorizedCallNoticeTimeout = null;
		}
	}

	function getUnauthorizedCallNoticeDurationMs() {
		const durationMs = Number(policy.unauthorizedCallNoticeMs);
		return Number.isFinite(durationMs) ? Math.max(1000, durationMs) : 15000;
	}

	function getUnauthorizedCallNoticeDurationSeconds() {
		return Math.ceil(getUnauthorizedCallNoticeDurationMs() / 1000);
	}

	function startParentCallMonitoring() {
		if (parentCallCheckInterval) {
			return;
		}
		const intervalMs = Number(policy.parentCallCheckIntervalMs);
		if (!Number.isFinite(intervalMs) || intervalMs < 1) {
			return;
		}

		parentCallCheckInterval = setInterval(() => {
			const context = getRuntimeContext();
			if (context.mode !== 'Paired' || !lastWebexPayload || activeCompanionDeviceCallCount < 1) {
				return;
			}
			requestActiveParentCallState('PeriodicParentCallCheck').catch(error => {
				dependencies.log.debug({ Message: 'Periodic Parent Room Device call-state reconciliation failed', Error: error.message || error.code || 'Unknown Parent Room Device call state request error' });
			});
		}, intervalMs);
		dependencies.log.debug({ Message: 'Parent Room Device call-state monitoring started', IntervalMs: intervalMs });
	}

	function stopParentCallMonitoring() {
		if (!parentCallCheckInterval) {
			return;
		}
		clearInterval(parentCallCheckInterval);
		parentCallCheckInterval = null;
		dependencies.log.debug({ Message: 'Parent Room Device call-state monitoring stopped' });
	}

	async function cancel() {
		syncToken++;
		lastWebexPayload = null;
		isRejoinInProgress = false;
		joinCommandPendingUntil = 0;
		authenticationRequest = 'None';
		pendingMeetingPasswordRequest = null;
		activeCompanionDeviceCallCount = 0;
		parentCallRequestInFlight = false;
		clearUnauthorizedCallCheck();
		stopParentCallMonitoring();
		try {
			await clearUnauthorizedCallNotice('CallSyncCanceled');
		} catch (error) {
			dependencies.utils.softError({ Context: 'Failed to clear the Paired calling policy notice while canceling call sync', Error: error });
		}
		try {
			await clearMeetingPasswordNotice('CallSyncCanceled');
		} catch (error) {
			dependencies.utils.softError({ Context: 'Failed to clear the manual Meeting Password notice while canceling call sync', Error: error });
		}
		infoText = '';
	}

	function getInfoText() {
		return infoText;
	}

	async function setInfo(value) {
		infoText = value || '';
		if (callbacks.onInfoChanged) {
			await callbacks.onInfoChanged(infoText);
		}
	}

	function getRuntimeContext() {
		return callbacks.getRuntimeContext ? callbacks.getRuntimeContext() : {};
	}

	function findMatchingParentCall(parentCalls, payload) {
		const parentCall = payload.ParentCall || {};
		const expectedCallId = normalizeCallIdentity(parentCall.CallId);
		const expectedJoinTarget = normalizeCallIdentity(payload.JoinTarget || parentCall.JoinTarget || parentCall.MeetingInviteLink);
		const expectedCallbackNumber = normalizeCallIdentity(parentCall.CallbackNumber);
		const expectedRemoteUri = normalizeCallIdentity(parentCall.RemoteURI);
		const expectedParentRemoteNumber = normalizeCallIdentity(parentCall.RemoteNumber);
		const expectedDialedRemoteNumber = normalizeCallIdentity(payload.RemoteNumber);

		for (let index = 0; index < parentCalls.length; index++) {
			const parentCallStatus = parentCalls[index];
			if (expectedCallId && normalizeCallIdentity(parentCallStatus.CallId) === expectedCallId) {
				return parentCallStatus;
			}
			if (expectedJoinTarget && normalizeCallIdentity(parentCallStatus.JoinTarget || parentCallStatus.MeetingInviteLink) === expectedJoinTarget) {
				return parentCallStatus;
			}
			if (expectedCallbackNumber && normalizeCallIdentity(parentCallStatus.CallbackNumber) === expectedCallbackNumber) {
				return parentCallStatus;
			}
			if (expectedRemoteUri && normalizeCallIdentity(parentCallStatus.RemoteURI) === expectedRemoteUri) {
				return parentCallStatus;
			}
			if (expectedParentRemoteNumber && normalizeCallIdentity(parentCallStatus.RemoteNumber) === expectedParentRemoteNumber) {
				return parentCallStatus;
			}
			if (!expectedParentRemoteNumber && expectedDialedRemoteNumber && normalizeCallIdentity(parentCallStatus.RemoteNumber) === expectedDialedRemoteNumber) {
				return parentCallStatus;
			}
		}

		return null;
	}

	function normalizeCallStatusList(callStatus) {
		if (!callStatus) {
			return [];
		}
		if (Array.isArray(callStatus)) {
			return callStatus;
		}
		if (Array.isArray(callStatus.Call)) {
			return callStatus.Call;
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

	function normalizeCallIdentity(value) {
		const normalizedValue = String(value || '').trim().toLowerCase();
		const schemeSeparatorIndex = normalizedValue.indexOf(':');
		if (schemeSeparatorIndex < 0) {
			return normalizedValue;
		}

		return normalizedValue.slice(schemeSeparatorIndex + 1).trim();
	}

	function isWebexCallPayload(payload) {
		const meetingPlatform = String(payload.MeetingPlatform || '').toLowerCase();
		const parentCall = payload.ParentCall || {};
		const protocol = String(payload.Protocol || parentCall.Protocol || '').toLowerCase();
		const targets = [payload.JoinTarget, payload.RemoteNumber, parentCall.JoinTarget, parentCall.MeetingInviteLink, parentCall.CallbackNumber, parentCall.RemoteNumber, parentCall.RemoteURI].join(' ').toLowerCase();
		const hasKnownNonWebexPlatform = meetingPlatform.indexOf('zoom') >= 0 || meetingPlatform.indexOf('microsoft') >= 0 || meetingPlatform.indexOf('teams') >= 0 || meetingPlatform.indexOf('google') >= 0;
		const hasKnownNonWebexTarget = targets.indexOf('zoom.') >= 0 || targets.indexOf('zoomcrc.') >= 0 || targets.indexOf('teams.') >= 0 || targets.indexOf('microsoft.') >= 0 || targets.indexOf('google.') >= 0 || targets.indexOf('meet.google') >= 0;

		if (hasKnownNonWebexPlatform || hasKnownNonWebexTarget) {
			return false;
		}
		return meetingPlatform.indexOf('webex') >= 0 || protocol === 'spark' || targets.indexOf('webex.com') >= 0;
	}

	function getUnsupportedCallInfoText(payload) {
		return `${getUnsupportedCallPlatformName(payload)} isn't supported. Start a Webex call from the Parent Room Device.`;
	}

	function getUnsupportedCallAlertText(payload) {
		return `The Companion Device cannot join ${getUnsupportedCallPlatformName(payload)} calls; only Webex is supported. To use the Companion Device, start a Webex call from the Parent Room Device.`;
	}

	function getUnsupportedCallPlatformName(payload) {
		const meetingPlatform = String(payload.MeetingPlatform || '').trim();
		const remoteNumber = String(payload.RemoteNumber || '').toLowerCase();
		if (meetingPlatform && meetingPlatform.toLowerCase() !== 'unknown') {
			return meetingPlatform;
		}
		if (remoteNumber.indexOf('zoom.') >= 0 || remoteNumber.indexOf('zoomcrc.') >= 0) {
			return 'Zoom';
		}
		if (remoteNumber.indexOf('teams.') >= 0 || remoteNumber.indexOf('microsoft.') >= 0) {
			return 'Microsoft Teams';
		}
		if (remoteNumber.indexOf('google.') >= 0 || remoteNumber.indexOf('meet.google') >= 0) {
			return 'Google Meet';
		}
		return 'non-Webex';
	}

	function getCallJoinFailureInfoText(payload) {
		return `⚠️ Failed to join call: ${getCallRemoteNumberText(payload)} ⚠️`;
	}

	function getCallJoinFailureAlertText(payload) {
		return `Failed to join call: ${getCallRemoteNumberText(payload)}`;
	}

	function getCallRemoteNumberText(payload) {
		return payload.JoinTarget || payload.RemoteNumber || 'Unknown remote number';
	}

	function getCallJoinInfoText(payload) {
		const meetingPlatform = String(payload.MeetingPlatform || '').toLowerCase();
		const remoteNumber = String(payload.RemoteNumber || '').toLowerCase();
		if (meetingPlatform.indexOf('webex') >= 0 || (remoteNumber.indexOf('webex') >= 0 && remoteNumber.indexOf('com') >= 0)) {
			return '';
		}
		return 'Joining the Parent Room Device call. Admit this Companion Device from the meeting lobby if needed.';
	}

	function getXapiValue(value) {
		return value && typeof value === 'object' && value.Value !== undefined ? value.Value : value;
	}

	return {
		registerCallCountHandler,
		registerAuthenticationRequestHandler,
		initializeActiveCallCount,
		initializeAuthenticationRequest,
		handleMessage,
		handleMeetingPasswordResponse,
		requestActiveParentCallState,
		disconnectAllCalls,
		cancel,
		getInfoText
	};
}

const companionDeviceCallSync = {
	create: createCompanionDeviceCallSync
};

export { companionDeviceCallSync };
