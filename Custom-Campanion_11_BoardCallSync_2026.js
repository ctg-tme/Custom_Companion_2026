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

 * Date Created:            July 20, 2026
 * Revised:                 July 23, 2026
 * Version:                 1.0.7
 *
 * Description:             Board Call Synchronization controller for the Custom Companion Solution.
 *                          Owns board call sync classification, Webex join and disconnect behavior,
 *                          Paired call authorization, parent-state reconciliation, rejoin checks,
 *                          and user-facing call sync information.
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

/*
 * Board Call Synchronization xAPI surface:
 * - Subscription and initial read: Status.SystemUnit.State.NumberOfActiveCalls.
 * - Conditional read: Status.Call when a parent sends a disconnect sync.
 * - Commands: Command.Webex.Join, Command.Call.Disconnect,
 *   Command.UserInterface.Message.Alert.Display, and
 *   Command.UserInterface.Message.Alert.Clear.
 * - Network command: DeviceComms sendMessageCommand to ActiveCallDetailsRequest after initialization,
 *   Parent selection, an unverified local call, a local call drop, and each active-call monitor interval.
 * Only Webex automatic joins are implemented. The inert non-Webex reference paths below remain
 * deliberately separated from executable behavior for future investigation.
 */

function createBoardCallSync(options) {
	const dependencies = options || {};
	const callbacks = dependencies.callbacks || {};
	const policy = dependencies.policy || {};
	let infoText = '';
	let syncToken = 0;
	let lastWebexPayload = null;
	let isRejoinInProgress = false;
	let activeBoardCallCount = 0;
	let unauthorizedCallCheckTimeout = null;
	let unauthorizedCallNoticeTimeout = null;
	let unauthorizedCallNoticeToken = 0;
	let unauthorizedCallNoticeActive = false;
	let parentCallCheckInterval = null;
	let parentCallRequestInFlight = false;
	let joinCommandPendingUntil = 0;

	const UNAUTHORIZED_CALL_INFO_TEXT = 'Start calls from the Parent Room.';
	const UNAUTHORIZED_CALL_ALERT_TEXT = 'Calling is available through the Parent Room while this board is Paired. Start the call from the Parent Room, or return this board to StandAlone to call directly.';
	const UNAUTHORIZED_CALL_ALERT_TITLE = 'Start Calls from the Parent Room';

	function registerCallCountHandler() {
		dependencies.xapi.Status.SystemUnit.State.NumberOfActiveCalls.on(callCount => {
			const activeCallCount = Number(getXapiValue(callCount));
			activeBoardCallCount = Number.isFinite(activeCallCount) ? activeCallCount : 0;
			if (activeCallCount < 1) {
				handleCallCountZero().catch(error => {
					dependencies.utils.softError({ Context: 'Failed to handle companion board call count zero', Error: error });
				});
				return;
			}
			joinCommandPendingUntil = 0;

			handleCallCountPositive('ActiveCallCount').catch(error => {
				dependencies.utils.softError({ Context: 'Failed to authorize companion board active call', Error: error });
			});
		});
	}

	async function initializeActiveCallCount() {
		try {
			const activeCallCount = Number(getXapiValue(await dependencies.xapi.Status.SystemUnit.State.NumberOfActiveCalls.get()));
			if (!Number.isFinite(activeCallCount)) {
				throw new Error('Initial active call count was not numeric');
			}
			activeBoardCallCount = activeCallCount;
			dependencies.log.debug({ Message: 'Initial companion board active call count read', ActiveCallCount: activeCallCount });
			if (activeCallCount > 0) {
				await handleCallCountPositive('BoardInitialization');
			}
		} catch (error) {
			dependencies.log.error({
				Code: 'CC26-CALL-COUNT-READ',
				Component: 'BoardCallSync',
				Context: 'Failed to read the initial local active call count',
				Remediation: 'Diagnose Status.SystemUnit.State.NumberOfActiveCalls before relying on automatic release behavior.',
				Error: error
			});
		}
	}

	async function handleMessage(message) {
		const context = getRuntimeContext();
		if (message.Serial !== context.activeParentSerial) {
			dependencies.log.debug({ Message: 'Ignored call sync from non-active parent', SendingParentSerial: message.Serial, ActiveParentSerial: context.activeParentSerial });
			return;
		}

		if (callbacks.clearStandbySyncState) {
			callbacks.clearStandbySyncState();
		}
		await handlePayload(message.Payload || {});
	}

	async function handlePayload(payload) {
		if (payload.CallKind === 'Disconnect') {
			syncToken++;
			lastWebexPayload = null;
			isRejoinInProgress = false;
			joinCommandPendingUntil = 0;
			joinCommandPendingUntil = 0;
			clearUnauthorizedCallCheck();
			stopParentCallMonitoring();
			await disconnectAllCalls();
			if (!unauthorizedCallNoticeActive) {
				await setInfo('');
			}
			dependencies.log.info({ Message: 'Parent call disconnect sync received', Payload: payload });
			return;
		}

		if (payload.CallKind === 'BYOD') {
			await clearUnauthorizedCallNotice('ParentBYODCallStarted');
			lastWebexPayload = null;
			joinCommandPendingUntil = 0;
			clearUnauthorizedCallCheck();
			stopParentCallMonitoring();
			await disconnectAllCalls();
			const unsupportedPayload = { MeetingPlatform: 'BYOD' };
			await setInfo(getUnsupportedCallInfoText(unsupportedPayload));
			await dependencies.xapi.Command.UserInterface.Message.Alert.Display({
				Title: 'Unsupported Call Type',
				Text: getUnsupportedCallAlertText(unsupportedPayload),
				Duration: 15
			});
			dependencies.log.info({ Message: 'BYOD call sync received; board join not supported', Payload: payload });
			return;
		}

		if (payload.CallKind === 'AdmissionRequired') {
			await clearUnauthorizedCallNotice('ParentWebexCallStarted');
			await setInfo('A host or cohost needs to admit this board to the Webex call.');
			dependencies.log.info({ Message: 'Parent cannot auto-admit companion board because it is not host or cohost', Payload: payload });
			return;
		}

		if (payload.CallKind === 'AdmissionAdmitted') {
			await clearUnauthorizedCallNotice('ParentWebexCallStarted');
			await setInfo('');
			dependencies.log.info({ Message: 'Companion board admitted by parent host', Payload: payload });
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
			clearUnauthorizedCallCheck();
			stopParentCallMonitoring();
			await disconnectAllCalls();
			await setInfo(getUnsupportedCallInfoText(payload));
			dependencies.log.info({ Message: 'Non-Webex call sync received; board join is out of scope', Payload: payload });
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
			dependencies.log.warn({ Message: 'Failed to request parent call state for an unverified Paired board call', Reason: reason, Error: error.message || error.code || 'Unknown parent call state request error' });
		}
		scheduleUnauthorizedCallCheck(reason);
	}

	async function handleCallCountZero() {
		activeBoardCallCount = 0;
		clearUnauthorizedCallCheck();
		stopParentCallMonitoring();
		if (callbacks.onCallCountZeroBoundary && await callbacks.onCallCountZeroBoundary()) {
			return;
		}

		const context = getRuntimeContext();
		if (context.mode !== 'Paired' || !lastWebexPayload || isRejoinInProgress || Date.now() < joinCommandPendingUntil) {
			return;
		}

		const activeParentDevice = callbacks.getActiveParentDevice ? callbacks.getActiveParentDevice() : null;
		if (!activeParentDevice) {
			dependencies.log.warn({ Message: 'Board call ended; active parent unavailable for rejoin check' });
			return;
		}

		isRejoinInProgress = true;
		await setInfo('Checking active parent call before rejoining.');
		try {
			await sendActiveCallDetailsRequest(activeParentDevice, 'BoardCallEnded');
		} catch (error) {
			isRejoinInProgress = false;
			dependencies.log.warn({ Message: 'Failed to request parent call details after board call ended', Host: activeParentDevice.host, Error: error.message || error.code || 'Unknown parent call details request error' });
			return;
		}

		dependencies.log.info({ Message: 'Requested active parent call details after board call ended', Host: activeParentDevice.host, Payload: lastWebexPayload });
	}

	async function requestActiveParentCallState(reason) {
		const context = getRuntimeContext();
		if (context.mode !== 'Paired') {
			return false;
		}

		const activeParentDevice = callbacks.getActiveParentDevice ? callbacks.getActiveParentDevice() : null;
		if (!activeParentDevice) {
			dependencies.log.warn({ Message: 'Active parent unavailable for call-state reconciliation', Reason: reason });
			return false;
		}
		if (parentCallRequestInFlight) {
			dependencies.log.debug({ Message: 'Parent call-state reconciliation already in flight', Reason: reason, Host: activeParentDevice.host });
			return false;
		}

		parentCallRequestInFlight = true;
		try {
			await sendActiveCallDetailsRequest(activeParentDevice, reason || 'Unspecified');
			dependencies.log.info({ Message: 'Requested active parent call state', Reason: reason || 'Unspecified', Host: activeParentDevice.host });
			return true;
		} finally {
			parentCallRequestInFlight = false;
		}
	}

	async function sendActiveCallDetailsRequest(parentDevice, reason) {
		const boardInformation = callbacks.getRuntimeBoardInformation ? await callbacks.getRuntimeBoardInformation() : {};
		await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, parentDevice, dependencies.activeCallDetailsRoute, {
			Reason: reason || 'Unspecified',
			LastSyncedCall: lastWebexPayload || {}
		}, {
			app: 'Companion Board 2026',
			serial: boardInformation.serial,
			source: {
				Role: 'Board',
				Name: boardInformation.name,
				Host: boardInformation.host,
				MacAddress: boardInformation.macAddress
			}
		}, dependencies.httpClientConfig);
	}

	async function handleActiveCallDetailsResponse(payload) {
		const requestReason = payload.Request && payload.Request.Reason || 'Unspecified';
		if (!payload.ParentHasActiveCall) {
			const hadActiveBoardCall = await hasActiveBoardCall();
			syncToken++;
			lastWebexPayload = null;
			isRejoinInProgress = false;
			clearUnauthorizedCallCheck();
			stopParentCallMonitoring();
			if (hadActiveBoardCall) {
				await disconnectAllCalls();
				await showUnauthorizedCallNotice(requestReason);
			} else if (!unauthorizedCallNoticeActive) {
				await setInfo('');
			}
			dependencies.log.info({
				Message: hadActiveBoardCall ? 'Direct board call disconnected; Paired calls must start from the Parent Room' : 'Parent call-state reconciliation found no active parent call',
				RequestReason: requestReason,
				DisconnectedBoardCall: hadActiveBoardCall,
				PairedCallPolicy: hadActiveBoardCall ? 'While Paired, start calls from the Parent Room' : '',
				UserGuidance: hadActiveBoardCall ? UNAUTHORIZED_CALL_INFO_TEXT : '',
				AlertGuidance: hadActiveBoardCall ? UNAUTHORIZED_CALL_ALERT_TEXT : '',
				NoticeDurationSeconds: hadActiveBoardCall ? getUnauthorizedCallNoticeDurationSeconds() : 0
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

		if (requestReason === 'BoardCallEnded' && lastWebexPayload && !findMatchingParentCall([payload.ParentCall || {}], lastWebexPayload)) {
			const skippedPayload = lastWebexPayload;
			lastWebexPayload = null;
			isRejoinInProgress = false;
			joinCommandPendingUntil = 0;
			await setInfo('');
			dependencies.log.info({ Message: 'Board call ended and active parent call did not match last synced call; rejoin skipped', ParentHasActiveCall: !!payload.ParentHasActiveCall, ParentCall: payload.ParentCall || {}, Payload: skippedPayload });
			return;
		}

		await synchronizeToParentCall(reconciledPayload, requestReason);
		isRejoinInProgress = false;
	}

	async function synchronizeToParentCall(payload, reason) {
		const previousPayload = lastWebexPayload;
		const hasActiveCall = await hasActiveBoardCall();
		const isSamePendingJoin = !hasActiveCall
			&& Date.now() < joinCommandPendingUntil
			&& previousPayload
			&& findMatchingParentCall([payload.ParentCall || {}], previousPayload);
		const isAlreadyAuthorized = hasActiveCall && (
			(previousPayload && findMatchingParentCall([payload.ParentCall || {}], previousPayload)) ||
			await doesActiveBoardCallMatchPayload(payload)
		);

		syncToken++;
		const joinToken = syncToken;
		lastWebexPayload = payload;
		clearUnauthorizedCallCheck();
		if (isSamePendingJoin) {
			dependencies.log.info({ Message: 'Duplicate parent call state accepted while Webex join is settling', Reason: reason, Payload: payload });
			return;
		}

		if (isAlreadyAuthorized) {
			activeBoardCallCount = Math.max(activeBoardCallCount, 1);
			startParentCallMonitoring();
			await setInfo('');
			dependencies.log.info({ Message: 'Existing companion board call authorized by active parent state', Reason: reason, Payload: payload });
			return;
		}

		if (hasActiveCall) {
			isRejoinInProgress = true;
			await disconnectAllCalls();
			dependencies.log.info({ Message: 'Disconnected board call that did not match the active parent call', Reason: reason, Payload: payload });
		}

		if (reason === 'BoardCallEnded') {
			await setInfo('Rejoining Webex call from active parent.');
		}
		try {
			await joinParentCallOnce(payload, joinToken);
		} finally {
			isRejoinInProgress = false;
		}
	}

	async function joinParentCallOnce(payload, joinToken) {
		if (joinToken !== syncToken) {
			dependencies.log.info({ Message: 'Companion board parent call join canceled', Payload: payload });
			return;
		}

		try {
			await joinParentCall(payload);
			if (joinToken !== syncToken) {
				dependencies.log.info({ Message: 'Companion board parent call join completed after cancellation', Payload: payload });
				return;
			}
			const settleMs = Number(policy.joinCommandSettleMs);
			joinCommandPendingUntil = Date.now() + (Number.isFinite(settleMs) ? Math.max(0, settleMs) : 10000);
			await setInfo(getCallJoinInfoText(payload));
			startParentCallMonitoring();
			dependencies.log.info({ Message: 'Companion board parent call join command accepted', Payload: payload });
		} catch (error) {
			lastWebexPayload = null;
			joinCommandPendingUntil = 0;
			stopParentCallMonitoring();
			await setInfo(getCallJoinFailureInfoText(payload));
			await dependencies.xapi.Command.UserInterface.Message.Alert.Display({
				Title: 'Call Sync Failed',
				Text: getCallJoinFailureAlertText(payload),
				Duration: 20
			});
			dependencies.utils.softError({ Context: 'Failed to join parent call', Error: error, Payload: payload });
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

		throw new Error('Only Webex call sync join is in scope for this Companion solution');
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
			dependencies.log.warn({ Message: 'Companion board call status read failed; attempting one aggregate disconnect', Error: error.message || error.code || 'Unknown call status error' });
			await dependencies.xapi.Command.Call.Disconnect();
			return;
		}

		if (calls.length < 1) {
			dependencies.log.info({ Message: 'Companion board has no active calls to disconnect' });
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

		dependencies.log.info({ Message: 'Companion board disconnected all calls', CallCount: calls.length });
	}

	async function hasActiveBoardCall() {
		try {
			const activeCallCount = Number(getXapiValue(await dependencies.xapi.Status.SystemUnit.State.NumberOfActiveCalls.get()));
			if (!Number.isFinite(activeCallCount)) {
				throw new Error('Active call count was not numeric');
			}
			activeBoardCallCount = activeCallCount;
			return activeCallCount > 0;
		} catch (error) {
			dependencies.log.warn({ Message: 'Could not verify the Paired Call Limit; new parent call join ignored', Error: error.message || error.code || 'Unknown call count error' });
			return true;
		}
	}

	async function doesActiveBoardCallMatchPayload(payload) {
		let calls = [];
		try {
			calls = normalizeCallStatusList(await dependencies.xapi.Status.Call.get());
		} catch (error) {
			dependencies.log.warn({ Message: 'Could not compare active board call with parent call state', Error: error.message || error.code || 'Unknown board call status error' });
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
			const boardValues = [call.CallbackNumber, call.RemoteNumber, call.RemoteURI].map(normalizeCallIdentity).filter(value => !!value);
			for (let valueIndex = 0; valueIndex < boardValues.length; valueIndex++) {
				if (expectedValues.indexOf(boardValues[valueIndex]) >= 0) {
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
				dependencies.utils.softError({ Context: 'Failed to enforce Paired board call authorization', Reason: reason, Error: error });
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
		if (context.mode !== 'Paired' || lastWebexPayload || !await hasActiveBoardCall()) {
			return;
		}

		syncToken++;
		await disconnectAllCalls();
		await showUnauthorizedCallNotice(reason);
		dependencies.log.warn({
			Message: 'Direct board call disconnected; Paired calls must start from the Parent Room',
			Reason: reason,
			PairedCallPolicy: 'While Paired, start calls from the Parent Room',
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
			await dependencies.xapi.Command.UserInterface.Message.Alert.Display({
				Title: UNAUTHORIZED_CALL_ALERT_TITLE,
				Text: UNAUTHORIZED_CALL_ALERT_TEXT,
				Duration: getUnauthorizedCallNoticeDurationSeconds()
			});
			if (noticeToken !== unauthorizedCallNoticeToken || !unauthorizedCallNoticeActive) {
				await clearUnauthorizedCallAlert('NoticeSupersededDuringDisplay');
			}
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to display Paired calling policy alert', Reason: reason, Error: error.message || error.code || 'Unknown alert display error' });
		}

		dependencies.log.info({
			Message: 'Paired calling policy notice displayed',
			Reason: reason,
			UserGuidance: UNAUTHORIZED_CALL_INFO_TEXT,
			AlertGuidance: UNAUTHORIZED_CALL_ALERT_TEXT,
			NoticeDurationSeconds: getUnauthorizedCallNoticeDurationSeconds()
		});
	}

	async function clearUnauthorizedCallNotice(reason) {
		const wasActive = unauthorizedCallNoticeActive;
		unauthorizedCallNoticeToken++;
		unauthorizedCallNoticeActive = false;
		clearUnauthorizedCallNoticeTimeout();
		if (infoText === UNAUTHORIZED_CALL_INFO_TEXT) {
			await setInfo('');
		}
		if (!wasActive) {
			return;
		}
		await clearUnauthorizedCallAlert(reason);
		dependencies.log.debug({ Message: 'Paired calling policy notice cleared early', Reason: reason });
	}

	async function clearUnauthorizedCallAlert(reason) {
		try {
			await dependencies.xapi.Command.UserInterface.Message.Alert.Clear();
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
			if (context.mode !== 'Paired' || !lastWebexPayload || activeBoardCallCount < 1) {
				return;
			}
			requestActiveParentCallState('PeriodicParentCallCheck').catch(error => {
				dependencies.log.warn({ Message: 'Periodic parent call-state reconciliation failed', Error: error.message || error.code || 'Unknown parent call state request error' });
			});
		}, intervalMs);
		dependencies.log.info({ Message: 'Parent call-state monitoring started', IntervalMs: intervalMs });
	}

	function stopParentCallMonitoring() {
		if (!parentCallCheckInterval) {
			return;
		}
		clearInterval(parentCallCheckInterval);
		parentCallCheckInterval = null;
		dependencies.log.info({ Message: 'Parent call-state monitoring stopped' });
	}

	function cancel() {
		clearUnauthorizedCallNotice('CallSyncCanceled').catch(error => {
			dependencies.utils.softError({ Context: 'Failed to clear the Paired calling policy notice while canceling call sync', Error: error });
		});
		syncToken++;
		lastWebexPayload = null;
		isRejoinInProgress = false;
		joinCommandPendingUntil = 0;
		activeBoardCallCount = 0;
		parentCallRequestInFlight = false;
		clearUnauthorizedCallCheck();
		stopParentCallMonitoring();
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
		return `${getUnsupportedCallPlatformName(payload)} isn't supported. Start a Webex call from the Parent Room.`;
	}

	function getUnsupportedCallAlertText(payload) {
		return `The Companion Device can not join ${getUnsupportedCallPlatformName(payload)} calls, only Webex. To use the Companion Device, have the Paired Room join a Webex Call`;
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
		return 'Joining parent call. Admit this board from the meeting lobby if needed.';
	}

	function getXapiValue(value) {
		return value && typeof value === 'object' && value.Value !== undefined ? value.Value : value;
	}

	return {
		registerCallCountHandler,
		initializeActiveCallCount,
		handleMessage,
		requestActiveParentCallState,
		disconnectAllCalls,
		cancel,
		getInfoText
	};
}

const boardCallSync = {
	create: createBoardCallSync
};

export { boardCallSync };
