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
 * Revised:                 July 20, 2026
 * Version:                 1.0.0
 *
 * Description:             Board Call Synchronization controller for the Custom Companion Solution.
 *                          Owns board call sync classification, Webex join and disconnect behavior,
 *                          rejoin checks, retry state, and user-facing call sync information.
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
 *   and Command.UserInterface.Message.Alert.Display.
 * - Network command: DeviceComms sendMessageCommand to ActiveCallDetailsRequest.
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

	function registerCallCountHandler() {
		dependencies.xapi.Status.SystemUnit.State.NumberOfActiveCalls.on(callCount => {
			const activeCallCount = Number(getXapiValue(callCount));
			if (activeCallCount < 1) {
				handleCallCountZero().catch(error => {
					dependencies.utils.softError({ Context: 'Failed to handle companion board call count zero', Error: error });
				});
			}
		});
	}

	async function initializeActiveCallCount() {
		try {
			const activeCallCount = Number(getXapiValue(await dependencies.xapi.Status.SystemUnit.State.NumberOfActiveCalls.get()));
			if (!Number.isFinite(activeCallCount)) {
				throw new Error('Initial active call count was not numeric');
			}
			dependencies.log.debug({ Message: 'Initial companion board active call count read', ActiveCallCount: activeCallCount });
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
			await disconnectAllCalls();
			await setInfo('');
			dependencies.log.info({ Message: 'Parent call disconnect sync received', Payload: payload });
			return;
		}

		if (payload.CallKind === 'BYOD') {
			await setInfo('Companion Device will only join Webex calls. Laptop/BYOD calls are not supported.');
			await dependencies.xapi.Command.UserInterface.Message.Alert.Display({
				Title: 'Unsupported Call Type',
				Text: 'The Companion Device will only join Webex calls. Laptop/BYOD calls are not supported.',
				Duration: 15
			});
			dependencies.log.info({ Message: 'BYOD call sync received; board join not supported', Payload: payload });
			return;
		}

		if (payload.CallKind === 'AdmissionRequired') {
			await setInfo('Host needs to admit this board to the Webex call.');
			dependencies.log.info({ Message: 'Parent cannot auto-admit companion board because it is not host', Payload: payload });
			return;
		}

		if (payload.CallKind === 'AdmissionAdmitted') {
			await setInfo('');
			dependencies.log.info({ Message: 'Companion board admitted by parent host', Payload: payload });
			return;
		}

		if (payload.CallKind === 'ActiveCallDetails') {
			await handleActiveCallDetailsResponse(payload);
			return;
		}

		const isWebexCall = isWebexCallPayload(payload);
		dependencies.log.debug({ Message: 'Call sync payload classified', IsWebexCall: isWebexCall, RemoteNumber: payload.RemoteNumber || '', MeetingPlatform: payload.MeetingPlatform || '', Protocol: payload.Protocol || '' });
		if (!isWebexCall) {
			syncToken++;
			await setInfo(getUnsupportedCallInfoText(payload));
			dependencies.log.info({ Message: 'Non-Webex call sync received; board join is out of scope', Payload: payload });
			return;
		}

		syncToken++;
		lastWebexPayload = payload;
		await joinParentCallWithRetries(payload, syncToken);
	}

	async function handleCallCountZero() {
		if (callbacks.onCallCountZeroBoundary && await callbacks.onCallCountZeroBoundary()) {
			return;
		}

		const context = getRuntimeContext();
		if (context.mode !== 'Paired' || !lastWebexPayload || isRejoinInProgress) {
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
			await sendActiveCallDetailsRequest(activeParentDevice);
		} catch (error) {
			isRejoinInProgress = false;
			dependencies.log.warn({ Message: 'Failed to request parent call details after board call ended', Host: activeParentDevice.host, Error: error.message || error.code || 'Unknown parent call details request error' });
			return;
		}

		dependencies.log.info({ Message: 'Requested active parent call details after board call ended', Host: activeParentDevice.host, Payload: lastWebexPayload });
	}

	async function sendActiveCallDetailsRequest(parentDevice) {
		const boardInformation = callbacks.getRuntimeBoardInformation ? await callbacks.getRuntimeBoardInformation() : {};
		await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, parentDevice, dependencies.activeCallDetailsRoute, {
			Reason: 'BoardCallEnded',
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
		if (!isRejoinInProgress || !lastWebexPayload) {
			dependencies.log.debug({ Message: 'Ignored active call details response without pending rejoin', Payload: payload });
			return;
		}

		const matchingParentCall = findMatchingParentCall([payload.ParentCall || {}], lastWebexPayload);
		if (!matchingParentCall) {
			const skippedPayload = lastWebexPayload;
			lastWebexPayload = null;
			isRejoinInProgress = false;
			await setInfo('');
			dependencies.log.info({ Message: 'Board call ended and active parent call did not match last synced call; rejoin skipped', ParentHasActiveCall: !!payload.ParentHasActiveCall, ParentCall: payload.ParentCall || {}, Payload: skippedPayload });
			return;
		}

		syncToken++;
		const rejoinToken = syncToken;
		await setInfo('Rejoining Webex call from active parent.');
		dependencies.log.info({ Message: 'Board call ended while parent is still in same call; rejoining companion board', ParentCall: matchingParentCall, Payload: lastWebexPayload });

		try {
			await joinParentCallWithRetries(lastWebexPayload, rejoinToken);
		} finally {
			isRejoinInProgress = false;
		}
	}

	async function joinParentCallWithRetries(payload, joinToken) {
		let lastError = null;

		for (let attempt = 1; attempt <= policy.joinRetryCount; attempt++) {
			if (joinToken !== syncToken) {
				dependencies.log.info({ Message: 'Companion board parent call join canceled', Attempt: attempt, Payload: payload });
				return;
			}

			try {
				await joinParentCall(payload);
				if (joinToken !== syncToken) {
					dependencies.log.info({ Message: 'Companion board parent call join completed after cancellation', Attempt: attempt, Payload: payload });
					return;
				}
				await setInfo(getCallJoinInfoText(payload));
				dependencies.log.info({ Message: 'Companion board joined parent call', Attempt: attempt, Payload: payload });
				return;
			} catch (error) {
				lastError = error;
				dependencies.log.warn({ Message: 'Companion board parent call join failed', Attempt: attempt, Error: error.message || error.code || 'Unknown call join error', Payload: payload });
				if (attempt < policy.joinRetryCount) {
					await delay(policy.joinRetryDelayMs);
				}
			}
		}

		await setInfo(getCallJoinFailureInfoText(payload));
		await dependencies.xapi.Command.UserInterface.Message.Alert.Display({
			Title: 'Call Sync Failed',
			Text: getCallJoinFailureAlertText(payload),
			Duration: 20
		});
		dependencies.utils.softError({ Context: 'Failed to join parent call after retries', Error: lastError, Payload: payload });
	}

	async function joinParentCall(payload) {
		const remoteNumber = payload.RemoteNumber || '';
		const meetingPlatform = String(payload.MeetingPlatform || '').toLowerCase();
		const protocol = String(payload.Protocol || '').toLowerCase();
		const normalizedRemoteNumber = String(remoteNumber || '').toLowerCase();

		if (!remoteNumber) {
			throw new Error('Cannot join parent call without RemoteNumber');
		}

		if (meetingPlatform.indexOf('webex') >= 0 || protocol === 'spark' || (normalizedRemoteNumber.indexOf('webex') >= 0 && normalizedRemoteNumber.indexOf('com') >= 0)) {
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
		try {
			const calls = normalizeCallStatusList(await dependencies.xapi.Status.Call.get());
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
		} catch (error) {
			dependencies.log.warn({ Message: 'Companion board call disconnect failed', Error: error.message || error.code || 'Unknown disconnect error' });
			await dependencies.xapi.Command.Call.Disconnect();
		}
	}

	function cancel() {
		syncToken++;
		lastWebexPayload = null;
		isRejoinInProgress = false;
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
		const expectedRemoteUri = normalizeCallIdentity(parentCall.RemoteURI);
		const expectedParentRemoteNumber = normalizeCallIdentity(parentCall.RemoteNumber);
		const expectedDialedRemoteNumber = normalizeCallIdentity(payload.RemoteNumber);

		for (let index = 0; index < parentCalls.length; index++) {
			const parentCallStatus = parentCalls[index];
			if (expectedCallId && normalizeCallIdentity(parentCallStatus.CallId) === expectedCallId) {
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
		return String(value || '').trim().toLowerCase();
	}

	function isWebexCallPayload(payload) {
		const meetingPlatform = String(payload.MeetingPlatform || '').toLowerCase();
		const protocol = String(payload.Protocol || '').toLowerCase();
		const remoteNumber = String(payload.RemoteNumber || '').toLowerCase();
		const isWebexRemoteNumber = remoteNumber.indexOf('webex') >= 0 && remoteNumber.indexOf('com') >= 0;
		const isWebexProtocol = protocol === 'spark';
		const isKnownNonWebexPlatform = meetingPlatform && meetingPlatform !== 'unknown' && meetingPlatform.indexOf('webex') < 0;

		if (isKnownNonWebexPlatform) {
			return false;
		}
		if (remoteNumber.indexOf('zoom.') >= 0 || remoteNumber.indexOf('zoomcrc.') >= 0 || remoteNumber.indexOf('teams.') >= 0 || remoteNumber.indexOf('google.') >= 0) {
			return false;
		}
		return meetingPlatform.indexOf('webex') >= 0 || isWebexProtocol || isWebexRemoteNumber;
	}

	function getUnsupportedCallInfoText(payload) {
		return `Companion Device will only join Webex calls. Join ${getUnsupportedCallPlatformName(payload)} manually from the room system.`;
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
		return 'this meeting';
	}

	function getCallJoinFailureInfoText(payload) {
		return `⚠️ Failed to join call: ${getCallRemoteNumberText(payload)} ⚠️`;
	}

	function getCallJoinFailureAlertText(payload) {
		return `Failed to join call: ${getCallRemoteNumberText(payload)}`;
	}

	function getCallRemoteNumberText(payload) {
		return payload.RemoteNumber || 'Unknown remote number';
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

	function delay(milliseconds) {
		return new Promise(resolve => setTimeout(resolve, milliseconds));
	}

	return {
		registerCallCountHandler,
		initializeActiveCallCount,
		handleMessage,
		cancel,
		getInfoText
	};
}

const boardCallSync = {
	create: createBoardCallSync
};

export { boardCallSync };
