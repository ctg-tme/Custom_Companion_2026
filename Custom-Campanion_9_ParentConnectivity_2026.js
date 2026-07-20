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
 * Description:             Parent Connectivity controller for the Custom Companion Solution.
 *                          Owns parent identity refresh, serial-verified retries, monitoring,
 *                          heartbeat, Call Preservation recovery, and connectivity messages.
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

/**
 * Creates the stateful Parent Connectivity controller used by the companion board entry macro.
 * Network retries remain explicit here; local xAPI commands remain owned by their calling modules.
 */
function createParentConnectivity(options) {
	const dependencies = options || {};
	const policy = dependencies.policy || {};
	const callbacks = dependencies.callbacks || {};
	let parentDevices = [];
	let parentDeviceStatus = [];
	let statusInterval = null;
	let connectionToken = 0;
	let recoveryPromise = null;
	let callPreservationActive = false;
	let infoText = '';
	let infoClearTimer = null;

	function setParentDevices(devices, statuses) {
		parentDevices = Array.isArray(devices) ? devices.slice() : [];
		parentDeviceStatus = Array.isArray(statuses) ? statuses.slice() : [];
	}

	function getSnapshot() {
		return {
			parentDevices: parentDevices.slice(),
			parentDeviceStatus: parentDeviceStatus.slice()
		};
	}

	async function refresh(refreshOptions = {}) {
		const previousAvailabilitySignature = getAvailabilitySignature();
		const refreshedStatus = [];
		const updatedDevices = [];
		let hasParentDeviceUpdates = false;
		const statusLog = refreshOptions.isInterval ? dependencies.log.debug.bind(dependencies.log) : dependencies.log.info.bind(dependencies.log);
		const errorLog = refreshOptions.isInterval ? dependencies.log.debug.bind(dependencies.log) : dependencies.log.warn.bind(dependencies.log);

		for (let index = 0; index < parentDevices.length; index++) {
			const device = parentDevices[index];

			try {
				const refreshedDevice = await dependencies.deviceComms.parentInitializationRequest(dependencies.xapi, device, dependencies.httpClientConfig);
				if (device.serial && refreshedDevice.serial !== device.serial) {
					const mismatchError = new Error('Parent identity serial changed for an existing parent record');
					mismatchError.code = 'CC26-PARENT-IDENTITY-MISMATCH';
					throw mismatchError;
				}

				const updatedDevice = buildUpdatedParentDevice(device, refreshedDevice);
				updatedDevices.push(updatedDevice);
				if (device.serial !== updatedDevice.serial || device.name !== updatedDevice.name) {
					hasParentDeviceUpdates = true;
				}

				refreshedStatus.push(buildOnlineStatus(updatedDevice));
				statusLog({ Message: 'Parent device identity refreshed', Host: device.host, Serial: refreshedDevice.serial, Name: refreshedDevice.name });
			} catch (error) {
				updatedDevices.push(device);
				refreshedStatus.push(buildOfflineStatus(device, error, device.lastHeartbeat || ''));
				errorLog({ Message: 'Parent device identity refresh failed', Host: device.host, Error: error.code || error.message || 'Unknown parent refresh error', ErrorContext: error.Context || {} });
			}
		}

		if (hasParentDeviceUpdates) {
			await dependencies.mem.write(dependencies.parentDevicesStorageKey, updatedDevices);
			dependencies.log.info({ Message: 'Persisted refreshed parent device identity fields', UpdatedDeviceCount: updatedDevices.length });
		}

		parentDevices = hasParentDeviceUpdates ? updatedDevices : parentDevices;
		parentDeviceStatus = refreshedStatus;
		await notifySnapshotChanged();

		const availabilityChanged = previousAvailabilitySignature !== getAvailabilitySignature();
		if (availabilityChanged && refreshOptions.notifyAvailabilityChange !== false && callbacks.onAvailabilityChanged) {
			await callbacks.onAvailabilityChanged(getSnapshot());
		}

		return getSnapshot();
	}

	async function select(parentDevice) {
		await cancel(true);
		const currentToken = connectionToken;
		const result = await runConnectionAttempts(parentDevice, currentToken, policy.selectionRetryCount, true);
		if (result.canceled) {
			return result;
		}

		if (callbacks.onAvailabilityChanged) {
			await callbacks.onAvailabilityChanged(getSnapshot());
		}

		if (!result.parentStatus || !result.parentStatus.online) {
			await finishUnavailableFallback(parentDevice, currentToken);
			return result;
		}

		const refreshedParentDevice = findParentDeviceBySerial(result.parentStatus.serial) || parentDevice;
		const canContinue = callbacks.onSelectionVerified
			? await callbacks.onSelectionVerified(refreshedParentDevice, result.parentStatus)
			: true;
		if (canContinue !== false) {
			await sendHeartbeat();
			dependencies.log.info({ Message: 'Companion board paired to parent', Host: refreshedParentDevice.host, Serial: result.parentStatus.serial, Name: result.parentStatus.name });
		}

		return result;
	}

	async function evaluate() {
		const context = getRuntimeContext();
		if (context.isUnhealthy || context.isHandlingSelection || context.mode !== 'Paired') {
			return;
		}

		const activeParentDevice = findActiveParentDevice(context);
		if (!activeParentDevice) {
			dependencies.log.warn({ Message: 'Active parent record is unavailable', ActiveParentSerial: context.activeParentSerial });
			const currentToken = ++connectionToken;
			await finishUnavailableFallback({ name: context.activeParentName || context.activeParentSerial, host: '' }, currentToken);
			return;
		}

		const activeParentStatus = findParentStatus(activeParentDevice);
		const identityMatches = !!(activeParentStatus && activeParentStatus.online && activeParentStatus.serial === context.activeParentSerial);
		if (identityMatches) {
			if (callPreservationActive) {
				await completeRecovery(activeParentDevice);
			}
			return;
		}

		startRecovery(activeParentDevice);
	}

	function start() {
		stop();
		statusInterval = setInterval(() => {
			runStatusInterval().catch(error => {
				dependencies.utils.softError({ Context: 'Parent status interval failed', Error: error });
			});
		}, policy.statusIntervalMs);
	}

	function stop() {
		if (statusInterval) {
			clearInterval(statusInterval);
		}
		statusInterval = null;
	}

	async function cancel(clearInfo) {
		connectionToken++;
		callPreservationActive = false;
		recoveryPromise = null;
		if (clearInfo) {
			clearInfoTimer();
			infoText = '';
		}
	}

	async function handleCallEnded() {
		if (!callPreservationActive) {
			return false;
		}

		const context = getRuntimeContext();
		const activeParentDevice = findActiveParentDevice(context);
		if (activeParentDevice) {
			await finishUnavailableFallback(activeParentDevice, connectionToken);
		}
		return true;
	}

	async function sendHeartbeat() {
		const context = getRuntimeContext();
		const activeParentDevice = findActiveParentDevice(context);
		if (!activeParentDevice) {
			return;
		}

		const activeParentStatus = findParentStatus(activeParentDevice);
		if (!activeParentStatus || !activeParentStatus.online) {
			dependencies.log.warn({ Message: 'Active parent is offline; skipping peripheral heartbeat', Host: activeParentDevice.host });
			return;
		}

		const peripheralId = callbacks.getPeripheralId ? callbacks.getPeripheralId() : '';
		try {
			await dependencies.deviceComms.sendPeripheralHeartbeat(dependencies.xapi, activeParentDevice, peripheralId, policy.heartbeatTimeoutSeconds, dependencies.httpClientConfig);
			dependencies.log.debug({ Message: 'Companion board peripheral heartbeat sent', Host: activeParentDevice.host, PeripheralID: peripheralId, Timeout: policy.heartbeatTimeoutSeconds });
		} catch (error) {
			dependencies.log.warn({ Message: 'Companion board peripheral heartbeat failed', Host: activeParentDevice.host, Error: error.code || error.message || 'Unknown peripheral heartbeat error', ErrorContext: error.Context || {} });
		}
	}

	function getInfoText() {
		return infoText;
	}

	async function clearInfo() {
		await setInfo('');
	}

	function isCallPreservationActive() {
		return callPreservationActive;
	}

	async function runStatusInterval() {
		const context = getRuntimeContext();
		if (context.isUnhealthy || context.isHandlingSelection || recoveryPromise) {
			return;
		}

		await refresh({ isInterval: true });
		await evaluate();
		if (!recoveryPromise && !callPreservationActive) {
			await sendHeartbeat();
		}
	}

	function startRecovery(parentDevice) {
		const context = getRuntimeContext();
		if (recoveryPromise || context.isUnhealthy || context.mode !== 'Paired') {
			return;
		}

		const currentToken = ++connectionToken;
		const activePromise = recoverActiveParent(parentDevice, currentToken)
			.catch(error => {
				dependencies.utils.softError({ Context: 'Active parent recovery failed', Host: parentDevice.host, Error: error });
			})
			.then(() => {
				if (recoveryPromise === activePromise) {
					recoveryPromise = null;
				}
			});
		recoveryPromise = activePromise;
	}

	async function recoverActiveParent(parentDevice, currentToken) {
		const result = await runConnectionAttempts(parentDevice, currentToken, policy.selectionRetryCount, true);
		if (result.canceled) {
			return;
		}
		if (callbacks.onAvailabilityChanged) {
			await callbacks.onAvailabilityChanged(getSnapshot());
		}

		if (result.parentStatus && result.parentStatus.online) {
			await completeRecovery(parentDevice);
			return;
		}

		if (callbacks.isBoardInActiveCall && await callbacks.isBoardInActiveCall()) {
			await enterCallPreservation(parentDevice, currentToken);
			return;
		}

		await finishUnavailableFallback(parentDevice, currentToken);
	}

	async function enterCallPreservation(parentDevice, currentToken) {
		const context = getRuntimeContext();
		if (currentToken !== connectionToken || context.mode !== 'Paired' || context.isUnhealthy) {
			return;
		}

		callPreservationActive = true;
		await setInfo(`${getParentDisplayName(parentDevice)} is temporarily unavailable. Your call will continue.`);
		if (callbacks.onCallPreservationChanged) {
			await callbacks.onCallPreservationChanged(true, parentDevice);
		}
		dependencies.log.warn({ Message: 'Call Preservation State entered', Host: parentDevice.host, Serial: context.activeParentSerial });
		await runCallPreservationRetryLoop(parentDevice, currentToken);
	}

	async function runCallPreservationRetryLoop(parentDevice, currentToken) {
		while (callPreservationActive && currentToken === connectionToken) {
			const context = getRuntimeContext();
			if (context.mode !== 'Paired' || context.isUnhealthy) {
				return;
			}

			await delay(policy.retryDelayMs);
			const refreshedContext = getRuntimeContext();
			if (!callPreservationActive || currentToken !== connectionToken || refreshedContext.mode !== 'Paired' || refreshedContext.isUnhealthy) {
				return;
			}

			if (callbacks.isBoardInActiveCall && !await callbacks.isBoardInActiveCall()) {
				await finishUnavailableFallback(parentDevice, currentToken);
				return;
			}

			const result = await runConnectionAttempts(parentDevice, currentToken, 1, false);
			if (result.canceled) {
				return;
			}
			if (result.parentStatus && result.parentStatus.online && result.parentStatus.serial === refreshedContext.activeParentSerial) {
				await completeRecovery(parentDevice);
				return;
			}
		}
	}

	async function completeRecovery(parentDevice) {
		const context = getRuntimeContext();
		if (context.mode !== 'Paired' || context.activeParentSerial !== parentDevice.serial) {
			return;
		}

		callPreservationActive = false;
		await setInfo('');
		if (callbacks.onRecovered) {
			await callbacks.onRecovered(parentDevice);
		}
		await sendHeartbeat();
		dependencies.log.info({ Message: 'Active parent communication restored', Host: parentDevice.host, Serial: context.activeParentSerial });
	}

	async function finishUnavailableFallback(parentDevice, currentToken) {
		const context = getRuntimeContext();
		if (currentToken !== connectionToken || context.isUnhealthy) {
			return;
		}

		callPreservationActive = false;
		const roomName = getParentDisplayName(parentDevice);
		await setInfo(`Unable to connect to ${roomName}. Running Stand Alone.`, policy.failureInfoMs);
		if (callbacks.onUnavailableFallback) {
			await callbacks.onUnavailableFallback(parentDevice);
		}
	}

	async function runConnectionAttempts(parentDevice, currentToken, retryCount, showAttemptInfo) {
		let latestStatus = null;
		const retryDelayMs = Number(policy.retryDelayMs) || 0;

		for (let attempt = 1; attempt <= retryCount; attempt++) {
			if (isCanceled(currentToken)) {
				return buildAttemptResult(latestStatus, true, attempt);
			}

			if (showAttemptInfo) {
				await setInfo(`Connecting to ${getParentDisplayName(parentDevice)} — attempt ${attempt} of ${retryCount}`);
			}

			try {
				const refreshedDevice = await dependencies.deviceComms.parentInitializationRequest(dependencies.xapi, parentDevice, dependencies.httpClientConfig);
				if (parentDevice.serial && refreshedDevice.serial !== parentDevice.serial) {
					const mismatchError = new Error('Parent identity serial did not match the selected parent');
					mismatchError.code = 'CC26-PARENT-IDENTITY-MISMATCH';
					throw mismatchError;
				}

				if (isCanceled(currentToken)) {
					return buildAttemptResult(latestStatus, true, attempt);
				}

				const updatedDevice = buildUpdatedParentDevice(parentDevice, refreshedDevice);
				const parentIndex = parentDevices.findIndex(device => device.host === parentDevice.host || device.serial === parentDevice.serial);
				if (parentIndex >= 0) {
					const existingDevice = parentDevices[parentIndex];
					parentDevices[parentIndex] = updatedDevice;
					if (existingDevice.serial !== updatedDevice.serial || existingDevice.name !== updatedDevice.name) {
						await dependencies.mem.write(dependencies.parentDevicesStorageKey, parentDevices);
					}
				}

				latestStatus = buildOnlineStatus(updatedDevice);
				parentDeviceStatus = replaceParentStatus(parentDeviceStatus, latestStatus, parentDevice);
				await notifySnapshotChanged();
				return buildAttemptResult(latestStatus, false, attempt);
			} catch (error) {
				latestStatus = buildOfflineStatus(parentDevice, error);
				parentDeviceStatus = replaceParentStatus(parentDeviceStatus, latestStatus, parentDevice);
				await notifySnapshotChanged();
				dependencies.log.debug({ Message: 'Parent connection attempt failed', Host: parentDevice.host, Attempt: attempt, AttemptCount: retryCount, Error: latestStatus.lastError, ErrorContext: error.Context || {} });
			}

			if (attempt < retryCount && retryDelayMs > 0) {
				await delay(retryDelayMs);
			}
		}

		return buildAttemptResult(latestStatus || buildOfflineStatus(parentDevice, new Error('Parent offline after retry')), false, retryCount);
	}

	function buildAttemptResult(parentStatus, canceled, attempt) {
		return {
			parentDevices: parentDevices.slice(),
			parentDeviceStatus: parentDeviceStatus.slice(),
			parentStatus: parentStatus,
			canceled: canceled,
			attempt: attempt
		};
	}

	function buildUpdatedParentDevice(parentDevice, refreshedDevice) {
		return {
			serial: refreshedDevice.serial,
			name: refreshedDevice.name,
			host: parentDevice.host,
			username: parentDevice.username,
			password: parentDevice.password
		};
	}

	function buildOnlineStatus(parentDevice) {
		return {
			host: parentDevice.host,
			serial: parentDevice.serial,
			name: parentDevice.name,
			online: true,
			lastHeartbeat: new Date().toISOString(),
			lastError: ''
		};
	}

	function buildOfflineStatus(parentDevice, error, lastHeartbeat = '') {
		return {
			host: parentDevice.host,
			serial: parentDevice.serial,
			name: parentDevice.name,
			online: false,
			lastError: error.code || error.message || 'Unknown parent refresh error',
			lastHeartbeat: lastHeartbeat
		};
	}

	function replaceParentStatus(statuses, replacementStatus, parentDevice) {
		const updatedStatus = statuses.slice();
		const statusIndex = updatedStatus.findIndex(status => status.host === parentDevice.host || status.serial === parentDevice.serial);
		if (statusIndex >= 0) {
			updatedStatus[statusIndex] = replacementStatus;
		} else {
			updatedStatus.push(replacementStatus);
		}
		return updatedStatus;
	}

	function findActiveParentDevice(context) {
		if (context.mode !== 'Paired') {
			return null;
		}
		return parentDevices.find(device => device.serial === context.activeParentSerial || device.host === context.activeParentHost) || null;
	}

	function findParentDeviceBySerial(serial) {
		return parentDevices.find(device => device.serial === serial) || null;
	}

	function findParentStatus(parentDevice) {
		return parentDeviceStatus.find(status => status.host === parentDevice.host || status.serial === parentDevice.serial) || null;
	}

	function getAvailabilitySignature() {
		return parentDeviceStatus.map(status => `${status.host}:${status.online ? 'online' : 'offline'}`).join('|');
	}

	function getRuntimeContext() {
		return callbacks.getRuntimeContext ? callbacks.getRuntimeContext() : {};
	}

	function isCanceled(currentToken) {
		const context = getRuntimeContext();
		return currentToken !== connectionToken || !!context.isUnhealthy;
	}

	async function setInfo(value, clearAfterMs) {
		clearInfoTimer();
		infoText = value || '';
		if (callbacks.onInfoChanged) {
			await callbacks.onInfoChanged(infoText);
		}

		if (infoText && clearAfterMs) {
			infoClearTimer = setTimeout(() => {
				infoClearTimer = null;
				infoText = '';
				if (callbacks.onInfoChanged) {
					callbacks.onInfoChanged(infoText).catch(error => {
						dependencies.utils.softError({ Context: 'Failed to clear parent connection information', Error: error });
					});
				}
			}, clearAfterMs);
		}
	}

	function clearInfoTimer() {
		if (infoClearTimer) {
			clearTimeout(infoClearTimer);
		}
		infoClearTimer = null;
	}

	async function notifySnapshotChanged() {
		if (callbacks.onSnapshotChanged) {
			await callbacks.onSnapshotChanged(getSnapshot());
		}
	}

	function getParentDisplayName(parentDevice) {
		return parentDevice.name || parentDevice.host || 'Selected room';
	}

	function delay(milliseconds) {
		return new Promise(resolve => setTimeout(resolve, milliseconds));
	}

	return {
		setParentDevices,
		refresh,
		select,
		evaluate,
		start,
		stop,
		cancel,
		handleCallEnded,
		getInfoText,
		clearInfo,
		isCallPreservationActive
	};
}

const parentConnectivity = {
	create: createParentConnectivity
};

export { parentConnectivity };
