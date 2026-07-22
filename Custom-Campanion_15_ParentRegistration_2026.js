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

 * Date Created:            July 22, 2026
 * Revised:                 July 22, 2026
 * Version:                 1.0.0
 *
 * Description:             Parent Room Registration and Deregistration controller. Owns the
 *                          PIN-authorized wizard, locked provisioning stages, long-hold removal,
 *                          Pending Deregistration tombstones, and registration reconciliation.
 *
 * Documentation:           N/A
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro Series
 *
 * Code Dependencies:       Custom-Campanion_4_UI_2026, Custom-Campanion_6_DeviceComms_2026,
 *                          Custom-Campanion_8_Services_2026, Custom-Campanion_14_PinMode_2026
 *
 * AI Generation:           Percentage: 95%
 *                          Model(s): GPT-5.3-Codex
 *                          Instruction File(s): /Users/bomcgoni/.claude/rules/Bobby_McGonigles_Macro_Rule_Set_for_AI.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

/*
 * Registration xAPI surface:
 * - UI events are routed by Main: Widget.Action, Prompt.Response/Cleared,
 *   and TextInput.Response/Clear.
 * - Commands are encapsulated by CompanionUI: Prompt Display/Clear, TextInput Display, Panel Close.
 * - Network workflow: DeviceComms parent identity GET, macro install putxml, Peripherals Connect /
 *   HeartBeat putxml, and Message.Send putxml for ParentReadyRequest, ConfigSync, validation,
 *   DeregisterRequest, and acknowledgements.
 * - Registration readiness/config requests retry every five seconds inside their documented
 *   60-second stages. Local xAPI commands remain single-attempt.
 */

const STAGE_TIMEOUT_MS = 60000;
const NETWORK_RETRY_MS = 5000;
const LONG_PRESS_MS = 3000;
const RESULT_DURATION_SECONDS = 60;

const FEEDBACK_IDS = {
	pairInfo: 'cc26_registration_info',
	host: 'cc26_registration_host',
	username: 'cc26_registration_username',
	password: 'cc26_registration_password',
	confirmPassword: 'cc26_registration_confirm_password',
	confirmPair: 'cc26_registration_confirm_pair',
	overwrite: 'cc26_registration_overwrite',
	progress: 'cc26_registration_progress',
	result: 'cc26_registration_result',
	deleteConfirm: 'cc26_deregistration_confirm'
};

function createParentRegistration(options) {
	const dependencies = options || {};
	const callbacks = dependencies.callbacks || {};
	const policy = dependencies.policy || {};
	let parentDevices = [];
	let pendingDeregistrations = [];
	let wizard = null;
	let operation = null;
	let messageWaiter = null;
	let stageTimeout = null;
	let retryTimeout = null;
	let decisionWaiter = null;
	let longPressTimeout = null;
	let longPressWidgetId = '';
	let longPressTriggeredWidgetId = '';
	let transactionSequence = 0;
	const reconciliationInFlight = {};

	function setState(devices, tombstones) {
		parentDevices = Array.isArray(devices) ? devices.slice() : [];
		pendingDeregistrations = Array.isArray(tombstones) ? tombstones.slice() : [];
	}

	function getState() {
		return {
			parentDevices: parentDevices.slice(),
			pendingDeregistrations: pendingDeregistrations.slice()
		};
	}

	async function reconcileStoredConflicts() {
		const registeredSerials = parentDevices.map(device => device.serial);
		const reconciled = pendingDeregistrations.filter(tombstone => registeredSerials.indexOf(tombstone.serial) < 0);
		if (reconciled.length === pendingDeregistrations.length) {
			return;
		}
		pendingDeregistrations = reconciled;
		await dependencies.mem.write(dependencies.pendingStorageKey, pendingDeregistrations);
		dependencies.log.warn({ Message: 'Resolved registration/tombstone conflict in favor of the durable Parent Room Registration' });
	}

	async function handleWidgetAction(event) {
		if (!event || !dependencies.companionUi.isProtectedPanelWidget(event.WidgetId)) {
			return false;
		}

		if (dependencies.companionUi.isPairNewRoomWidget(event.WidgetId)) {
			if (event.Type !== 'released') {
				return true;
			}
			const widget = dependencies.companionUi.parseWidgetId(event.WidgetId);
			if (widget.action === 'PairingInfo') {
				await showPairingInformation();
			} else {
				await requestRegistrationAuthorization();
			}
			return true;
		}

		if (!dependencies.companionUi.isParentDeviceWidget(event.WidgetId)) {
			return false;
		}

		if (event.Type === 'pressed') {
			startParentLongPress(event.WidgetId);
			return true;
		}
		if (event.Type === 'released') {
			clearParentLongPress();
			if (longPressTriggeredWidgetId === event.WidgetId) {
				longPressTriggeredWidgetId = '';
				return true;
			}
		}
		return false;
	}

	function startParentLongPress(widgetId) {
		clearParentLongPress();
		longPressWidgetId = widgetId;
		longPressTimeout = setTimeout(() => {
			longPressTimeout = null;
			longPressTriggeredWidgetId = widgetId;
			const parsed = dependencies.companionUi.parseWidgetId(widgetId);
			showDeleteConfirmation(parsed.index).catch(error => {
				dependencies.utils.softError({ Context: 'Failed to show Parent Room Deregistration confirmation', Error: error });
			});
		}, LONG_PRESS_MS);
	}

	function clearParentLongPress() {
		if (longPressTimeout) {
			clearTimeout(longPressTimeout);
			longPressTimeout = null;
		}
		longPressWidgetId = '';
	}

	async function showPairingInformation() {
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionPrompt(dependencies.xapi, {
			title: 'Pair New Room',
			text: 'Register a parent room to make it available in Select Device. Registration does not select the room or interrupt StandAlone use.',
			feedbackId: FEEDBACK_IDS.result,
			options: ['Dismiss'],
			duration: RESULT_DURATION_SECONDS
		});
	}

	async function requestRegistrationAuthorization() {
		if (isBusy() || isUnhealthy()) {
			return;
		}
		const context = getRuntimeContext();
		if (context.mode === 'Paired' && await callbacks.isBoardInActiveCall()) {
			await showResult('Call In Progress', 'Registering another room is unavailable while this Paired board is in a call. End the board call or run Stand Alone first.');
			return;
		}

		await dependencies.pinModeController.requestAuthorization({
			title: 'Pair New Room',
			text: 'Enter the current PIN to register a parent room.',
			submitText: 'Continue',
			onAuthorized: beginRegistrationWizard
		});
	}

	async function beginRegistrationWizard() {
		wizard = { host: '', username: '', password: '', step: 'info' };
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionPrompt(dependencies.xapi, {
			title: 'Pair New Room',
			text: 'You will enter the parent room host address and a RoomOS account that can install and run the Companion parent macros. Credentials are stored on this board for autonomous communication.',
			feedbackId: FEEDBACK_IDS.pairInfo,
			options: ['Next', 'Cancel'],
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	async function handleTextInputResponse(event) {
		if (!event || !wizard || !isWizardTextInput(event.FeedbackId)) {
			return false;
		}
		dependencies.pinModeController.touchSession();
		const value = String(event.Text || '');

		if (event.FeedbackId === FEEDBACK_IDS.host) {
			const host = normalizeHost(value);
			if (!host) {
				await showHostInput('Enter only a valid host name or IP address, without a URL scheme or path.');
				return true;
			}
			wizard.host = host;
			await showUsernameInput();
			return true;
		}
		if (event.FeedbackId === FEEDBACK_IDS.username) {
			if (!value.trim()) {
				await showUsernameInput('Username is required.');
				return true;
			}
			wizard.username = value.trim();
			await showPasswordInput();
			return true;
		}
		if (event.FeedbackId === FEEDBACK_IDS.password) {
			if (!value) {
				await showPasswordInput('Password is required.');
				return true;
			}
			wizard.password = value;
			await showConfirmPasswordInput();
			return true;
		}
		if (value !== wizard.password) {
			wizard.password = '';
			await showPasswordInput('The passwords did not match. Enter the password again.');
			return true;
		}

		await showPairConfirmation();
		return true;
	}

	async function handlePromptResponse(event) {
		if (!event) {
			return false;
		}
		if (operation && event.FeedbackId === FEEDBACK_IDS.progress) {
			await reopenLockedPrompt();
			return true;
		}
		if (decisionWaiter && event.FeedbackId === FEEDBACK_IDS.overwrite) {
			const resolve = decisionWaiter.resolve;
			decisionWaiter = null;
			if (operation) {
				operation.currentPrompt = null;
			}
			resolve(String(event.OptionId || event.Option || '') === '1');
			return true;
		}
		if (event.FeedbackId === FEEDBACK_IDS.deleteConfirm) {
			if (String(event.OptionId || event.Option || '') === '1' && operation && operation.kind === 'delete-confirmation') {
				const parentDevice = operation.parentDevice;
				operation = null;
				await dependencies.pinModeController.requestAuthorization({
					title: 'Delete Room',
					text: 'Enter the current PIN to remove this board from the parent room.',
					submitText: 'Delete',
					onAuthorized: () => deregisterParent(parentDevice)
				});
			} else if (operation && operation.kind === 'delete-confirmation') {
				operation = null;
			}
			return true;
		}
		if (!wizard) {
			return false;
		}

		const option = String(event.OptionId || event.Option || '');
		if (event.FeedbackId === FEEDBACK_IDS.pairInfo) {
			if (option === '1') {
				await showHostInput();
			} else {
				cancelWizard();
			}
			return true;
		}
		if (event.FeedbackId === FEEDBACK_IDS.confirmPair) {
			if (option === '1') {
				const credentials = wizard;
				wizard = null;
				runRegistration(credentials).catch(error => {
					dependencies.utils.softError({ Context: 'Unhandled Parent Room Registration failure', Error: error });
				});
			} else {
				cancelWizard();
			}
			return true;
		}
		return false;
	}

	async function handlePromptCleared(event) {
		if (!event) {
			return false;
		}
		if (operation && (event.FeedbackId === FEEDBACK_IDS.progress || event.FeedbackId === FEEDBACK_IDS.overwrite)) {
			await reopenLockedPrompt();
			return true;
		}
		if (operation && operation.kind === 'delete-confirmation' && event.FeedbackId === FEEDBACK_IDS.deleteConfirm) {
			operation = null;
			return true;
		}
		if (wizard && (event.FeedbackId === FEEDBACK_IDS.pairInfo || event.FeedbackId === FEEDBACK_IDS.confirmPair)) {
			cancelWizard();
			return true;
		}
		return false;
	}

	function handleTextInputCleared(event) {
		if (!event || !wizard || !isWizardTextInput(event.FeedbackId)) {
			return false;
		}
		cancelWizard();
		return true;
	}

	async function showHostInput(text) {
		wizard.step = 'host';
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionTextInput(dependencies.xapi, {
			title: 'Parent Host Address',
			text: text || 'Enter the parent room host name or IP address.',
			feedbackId: FEEDBACK_IDS.host,
			inputType: 'SingleLine',
			placeholder: 'room.example.com or 10.0.0.10',
			submitText: 'Next',
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	async function showUsernameInput(text) {
		wizard.step = 'username';
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionTextInput(dependencies.xapi, {
			title: 'Parent Username',
			text: text || 'Enter the RoomOS username for the parent room.',
			feedbackId: FEEDBACK_IDS.username,
			inputType: 'SingleLine',
			placeholder: 'Username',
			submitText: 'Next',
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	async function showPasswordInput(text) {
		wizard.step = 'password';
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionTextInput(dependencies.xapi, {
			title: 'Parent Password',
			text: text || 'Enter the password for the parent room account.',
			feedbackId: FEEDBACK_IDS.password,
			inputType: 'Password',
			placeholder: 'Password',
			submitText: 'Next',
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	async function showConfirmPasswordInput() {
		wizard.step = 'confirm-password';
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionTextInput(dependencies.xapi, {
			title: 'Confirm Parent Password',
			text: 'Enter the parent room password again.',
			feedbackId: FEEDBACK_IDS.confirmPassword,
			inputType: 'Password',
			placeholder: 'Confirm password',
			submitText: 'Next',
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	async function showPairConfirmation() {
		wizard.step = 'confirm';
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionPrompt(dependencies.xapi, {
			title: 'Register Parent Room?',
			text: `Confirm registration with ${wizard.host}. The board will verify the room, install the shared parent macros, connect its peripheral, and wait for the parent acknowledgement.`,
			feedbackId: FEEDBACK_IDS.confirmPair,
			options: ['Pair Room', 'Cancel'],
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	function cancelWizard() {
		wizard = null;
	}

	async function runRegistration(credentials) {
		const transactionId = createTransactionId('registration');
		operation = {
			kind: 'registration',
			transactionId: transactionId,
			candidate: null,
			currentPrompt: null,
			mayHaveRegistered: false,
			configDenied: false,
			hadExistingRegistration: false
		};
		await dependencies.companionUi.closeProtectedPanel(dependencies.xapi);

		try {
			const candidate = await runLocalStage('Confirming Pairing', `Verifying the parent room identity and credentials for ${credentials.host}.`, () => dependencies.deviceComms.parentInitializationRequest(dependencies.xapi, credentials, dependencies.httpClientConfig));
			operation.candidate = candidate;
			operation.hadExistingRegistration = !!findParentBySerial(candidate.serial);
			await confirmRegistrationIntent(candidate);
			validateBoardCapacity(candidate);

			await runLocalStage('Installing Parent Macros', `Installing and starting the shared Companion parent macros on ${candidate.name}.`, async () => {
				const macroPayloads = await dependencies.boardServices.getParentInstallMacroPayloads(dependencies.xapi, dependencies.installConfig);
				await dependencies.deviceComms.installParentMacros(dependencies.xapi, candidate, macroPayloads, dependencies.installConfig, dependencies.httpClientConfig);
			});

			const boardInformation = await callbacks.getRuntimeBoardInformation();
			const peripheralInfo = dependencies.boardServices.buildCompanionPeripheralInfo(boardInformation, dependencies.configVersion, dependencies.peripheralType);
			await runLocalStage('Connecting Companion Board', `Registering this board as a peripheral on ${candidate.name}.`, async () => {
				await dependencies.deviceComms.connectPeripheral(dependencies.xapi, candidate, peripheralInfo, dependencies.httpClientConfig);
				await dependencies.deviceComms.sendPeripheralHeartbeat(dependencies.xapi, candidate, peripheralInfo.ID, dependencies.initialHeartbeatTimeout, dependencies.httpClientConfig);
			});

			await runMessageStage('Waiting for Parent Runtime', `${candidate.name} is starting the parent runtime and confirming readiness.`, 'ParentReady', () => sendParentReadyRequest(candidate, boardInformation, transactionId));
			operation.mayHaveRegistered = true;
			await runMessageStage('Confirming Registration', `${candidate.name} is validating capacity and saving this board registration.`, 'ConfigAccepted', () => sendConfigSync(candidate, boardInformation, transactionId));

			await runLocalStage('Saving Room Registration', `Saving ${candidate.name} to this board.`, () => commitRegistration(candidate));
			await finishOperation();
			await showResult('Room Registered', `${candidate.name} was successfully registered. It is now available in Select Device.`);
			dependencies.log.info({ Message: 'Parent Room Registration completed', Host: candidate.host, Serial: candidate.serial, TransactionId: transactionId });
		} catch (error) {
			await handleRegistrationFailure(error);
		}
	}

	async function confirmRegistrationIntent(candidate) {
		const tombstone = findPendingDeregistration(candidate.serial);
		if (tombstone) {
			const confirmed = await runDecisionStage('Re-register Parent Room?', `${candidate.name} is pending removal. Re-registering makes the new registration the current intent and cancels pending cleanup.`, ['Re-register', 'Cancel']);
			if (!confirmed) {
				throw buildOperationError('Registration canceled; pending removal was retained.', 'CC26-REGISTRATION-CANCELED');
			}
		}

		const existing = findParentBySerial(candidate.serial);
		if (existing) {
			const confirmed = await runDecisionStage('Overwrite Room Registration?', `${candidate.name} is already registered. Replace its saved host and credentials with the newly verified values?`, ['Overwrite', 'Cancel']);
			if (!confirmed) {
				throw buildOperationError('Registration overwrite was canceled.', 'CC26-REGISTRATION-CANCELED');
			}
		}
	}

	function validateBoardCapacity(candidate) {
		if (!findParentBySerial(candidate.serial) && parentDevices.length >= policy.maxParentDevices) {
			throw buildOperationError(`This board already has the maximum of ${policy.maxParentDevices} registered rooms. Delete a room before adding another.`, 'CC26-BOARD-PARENT-LIMIT');
		}
	}

	async function runLocalStage(title, text, task) {
		setLockedPrompt(title, text, FEEDBACK_IDS.progress, ['Please Wait']);
		await reopenLockedPrompt();
		return withStageTimeout(task());
	}

	async function runDecisionStage(title, text, choices) {
		setLockedPrompt(title, text, FEEDBACK_IDS.overwrite, choices);
		await reopenLockedPrompt();
		return withStageTimeout(new Promise(resolve => {
			decisionWaiter = { resolve: resolve };
		}));
	}

	async function runMessageStage(title, text, expectedAction, sendRequest) {
		setLockedPrompt(title, text, FEEDBACK_IDS.progress, ['Please Wait']);
		await reopenLockedPrompt();
		return withStageTimeout(new Promise((resolve, reject) => {
			messageWaiter = {
				expectedAction: expectedAction,
				transactionId: operation.transactionId,
				serial: operation.candidate.serial,
				resolve: resolve,
				reject: reject,
				sendRequest: sendRequest
			};
			sendWaitingRequest();
		}));
	}

	function withStageTimeout(promise) {
		clearStageTimeouts();
		return new Promise((resolve, reject) => {
			stageTimeout = setTimeout(() => {
				stageTimeout = null;
				clearRetryTimeout();
				messageWaiter = null;
				decisionWaiter = null;
				reject(buildOperationError('The current registration stage did not complete within 60 seconds.', 'CC26-REGISTRATION-TIMEOUT'));
			}, STAGE_TIMEOUT_MS);
			promise.then(value => {
				clearStageTimeouts();
				resolve(value);
			}).catch(error => {
				clearStageTimeouts();
				reject(error);
			});
		});
	}

	function sendWaitingRequest() {
		if (!messageWaiter) {
			return;
		}
		const waiter = messageWaiter;
		Promise.resolve()
			.then(waiter.sendRequest)
			.catch(error => dependencies.log.warn({ Message: 'Registration network stage request failed; the stage remains active', Action: waiter.expectedAction, Error: error.code || error.message || 'Unknown request error', ErrorContext: error.Context || {} }))
			.then(() => {
				if (messageWaiter !== waiter) {
					return;
				}
				clearRetryTimeout();
				retryTimeout = setTimeout(() => {
					retryTimeout = null;
					sendWaitingRequest();
				}, policy.networkRetryMs || NETWORK_RETRY_MS);
			});
	}

	async function handleMessage(message) {
		if (!message) {
			return false;
		}
		const transactionId = String(message.Payload && message.Payload.TransactionId || '');
		if (messageWaiter && transactionId === messageWaiter.transactionId && message.Serial === messageWaiter.serial) {
			if (message.Action === 'ConfigDenied') {
				const reject = messageWaiter.reject;
				operation.configDenied = true;
				messageWaiter = null;
				reject(buildOperationError(getConfigDeniedReason(message.Payload), 'CC26-PARENT-CONFIG-DENIED'));
				return true;
			}
			if (message.Action === messageWaiter.expectedAction) {
				const resolve = messageWaiter.resolve;
				messageWaiter = null;
				resolve(message);
				return true;
			}
		}

		if (message.Action === 'DeregistrationAccepted') {
			const wasAccepted = await handleDeregistrationAccepted(message);
			if (!wasAccepted) {
				const pending = findPendingDeregistration(message.Serial);
				if (pending) {
					await retryPendingDeregistration(pending, 'StaleDeregistrationAcknowledgement');
				}
			}
			return true;
		}

		const tombstone = findPendingDeregistration(message.Serial);
		if (tombstone) {
			await retryPendingDeregistration(tombstone, `Inbound:${message.Action}`);
			return true;
		}

		const parentDevice = findParentBySerial(message.Serial);
		if (message.Action === 'RegistrationValidation') {
			if (parentDevice) {
				await sendRegistrationValidated(parentDevice, message);
			}
			return true;
		}

		return !parentDevice;
	}

	async function commitRegistration(candidate) {
		const nextParents = parentDevices.slice();
		const existingIndex = nextParents.findIndex(device => device.serial === candidate.serial);
		if (existingIndex >= 0) {
			nextParents[existingIndex] = candidate;
		} else {
			nextParents.push(candidate);
		}
		const nextTombstones = pendingDeregistrations.filter(tombstone => tombstone.serial !== candidate.serial);

		const previousTombstones = pendingDeregistrations.slice();
		await dependencies.mem.write(dependencies.pendingStorageKey, nextTombstones);
		try {
			await dependencies.mem.write(dependencies.parentDevicesStorageKey, nextParents);
		} catch (error) {
			await dependencies.mem.write(dependencies.pendingStorageKey, previousTombstones);
			throw error;
		}
		parentDevices = nextParents;
		pendingDeregistrations = nextTombstones;
		await notifyStateChanged(candidate);
	}

	async function handleRegistrationFailure(error) {
		const failedOperation = operation;
		if (failedOperation && failedOperation.mayHaveRegistered && !failedOperation.configDenied && !failedOperation.hadExistingRegistration && failedOperation.candidate) {
			try {
				const boardInformation = await callbacks.getRuntimeBoardInformation();
				const tombstone = buildTombstone(failedOperation.candidate, boardInformation, createTransactionId('registration-cleanup'));
				await savePendingDeregistration(tombstone);
				await retryPendingDeregistration(tombstone, 'RegistrationFailureCleanup');
			} catch (cleanupError) {
				dependencies.log.warn({ Message: 'Could not queue cleanup after failed Parent Room Registration', Error: cleanupError.code || cleanupError.message || 'Unknown cleanup error' });
			}
		}

		await finishOperation();
		if (error && error.code === 'CC26-REGISTRATION-CANCELED') {
			await showResult('Registration Canceled', error.UserMessage || 'Parent Room Registration was canceled.');
			return;
		}
		const failureText = error && error.UserMessage ? error.UserMessage : 'The parent room could not be registered.';
		await showResult('Room Registration Failed', `${failureText} Inspect the parent room macro logs for more details.`);
		dependencies.log.warn({ Message: 'Parent Room Registration failed', Code: error && error.code || 'CC26-REGISTRATION-FAILED', Error: error && error.message || 'Unknown registration error', ErrorContext: error && error.Context || {} });
	}

	async function showDeleteConfirmation(parentIndex) {
		if (isBusy() || isUnhealthy()) {
			return;
		}
		const parentDevice = parentDevices[parentIndex];
		if (!parentDevice) {
			return;
		}
		const context = getRuntimeContext();
		const deletingActiveParent = context.activeParentSerial === parentDevice.serial;
		const hasActiveCall = deletingActiveParent && await callbacks.isBoardInActiveCall();
		const callWarning = hasActiveCall ? ' This board will leave its call and transition to StandAlone; the call will remain active in the parent room.' : '';
		operation = { kind: 'delete-confirmation', parentDevice: parentDevice };
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionPrompt(dependencies.xapi, {
			title: 'Delete Parent Room?',
			text: `Remove ${parentDevice.name || parentDevice.host} from this board? The shared parent macros will remain installed for other boards.${callWarning}`,
			feedbackId: FEEDBACK_IDS.deleteConfirm,
			options: ['Delete Room', 'Cancel'],
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	async function deregisterParent(parentDevice) {
		if (!parentDevice || isUnhealthy()) {
			return;
		}
		operation = { kind: 'deregistration', parentDevice: parentDevice };
		const context = getRuntimeContext();
		if (context.activeParentSerial === parentDevice.serial) {
			await callbacks.releaseActiveParentForDeregistration();
		}

		try {
			const boardInformation = await callbacks.getRuntimeBoardInformation();
			const tombstone = buildTombstone(parentDevice, boardInformation, createTransactionId('deregistration'));
			await savePendingDeregistration(tombstone);
			const nextParents = parentDevices.filter(device => device.serial !== parentDevice.serial);
			await dependencies.mem.write(dependencies.parentDevicesStorageKey, nextParents);
			parentDevices = nextParents;
			await notifyStateChanged();
			operation = null;
			await retryPendingDeregistration(tombstone, 'UserDeregistration');
			await showResult('Room Removed', `${parentDevice.name || parentDevice.host} was removed from this board. Parent cleanup will retry automatically until confirmed.`);
		} catch (error) {
			try {
				const rollback = pendingDeregistrations.filter(item => item.serial !== parentDevice.serial);
				await dependencies.mem.write(dependencies.pendingStorageKey, rollback);
				pendingDeregistrations = rollback;
			} catch (rollbackError) {
				dependencies.log.error({ Message: 'Failed to roll back Pending Deregistration after local room removal failure', Serial: parentDevice.serial, Error: rollbackError.code || rollbackError.message || 'Unknown rollback error' });
			}
			operation = null;
			await showResult('Room Removal Failed', 'The room could not be removed from board memory. Inspect the board macro logs for details.');
			dependencies.log.error({ Message: 'Parent Room Deregistration failed locally', Error: error.code || error.message || 'Unknown deregistration error' });
		}
	}

	function buildTombstone(parentDevice, boardInformation, transactionId) {
		return {
			serial: parentDevice.serial,
			name: parentDevice.name,
			host: parentDevice.host,
			username: parentDevice.username,
			password: parentDevice.password,
			peripheralId: dependencies.boardServices.getCompanionPeripheralId(boardInformation),
			transactionId: transactionId,
			createdAt: new Date().toISOString()
		};
	}

	async function savePendingDeregistration(tombstone) {
		const next = pendingDeregistrations.filter(item => item.serial !== tombstone.serial);
		next.push(tombstone);
		await dependencies.mem.write(dependencies.pendingStorageKey, next);
		pendingDeregistrations = next;
	}

	async function reconcilePendingDeregistrations() {
		for (let index = 0; index < pendingDeregistrations.length; index++) {
			await retryPendingDeregistration(pendingDeregistrations[index], 'BoardInitialization');
		}
	}

	async function retryPendingDeregistration(tombstone, reason) {
		if (!tombstone || reconciliationInFlight[tombstone.serial]) {
			return;
		}
		reconciliationInFlight[tombstone.serial] = true;
		try {
			const boardInformation = await callbacks.getRuntimeBoardInformation();
			await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, tombstone, 'DeregisterRequest', {
				TransactionId: tombstone.transactionId,
				PeripheralId: tombstone.peripheralId,
				Board: buildBoardPayload(boardInformation)
			}, buildBoardMessageConfig(boardInformation), dependencies.httpClientConfig);
			dependencies.log.info({ Message: 'Pending Deregistration request sent', Serial: tombstone.serial, Reason: reason, TransactionId: tombstone.transactionId });
		} catch (error) {
			dependencies.log.warn({ Message: 'Pending Deregistration remains queued', Serial: tombstone.serial, Reason: reason, Error: error.code || error.message || 'Unknown deregistration request error', ErrorContext: error.Context || {} });
		} finally {
			delete reconciliationInFlight[tombstone.serial];
		}
	}

	async function handleDeregistrationAccepted(message) {
		const tombstone = findPendingDeregistration(message.Serial);
		const transactionId = String(message.Payload && message.Payload.TransactionId || '');
		if (!tombstone || tombstone.transactionId !== transactionId) {
			dependencies.log.info({ Message: 'Ignored stale DeregistrationAccepted acknowledgement', Serial: message.Serial, TransactionId: transactionId });
			return false;
		}
		const nextTombstones = pendingDeregistrations.filter(item => item.serial !== tombstone.serial);
		await dependencies.mem.write(dependencies.pendingStorageKey, nextTombstones);
		pendingDeregistrations = nextTombstones;
		dependencies.log.info({ Message: 'Parent Room Deregistration confirmed and tombstone removed', Serial: message.Serial, TransactionId: transactionId });
		return true;
	}

	async function sendParentReadyRequest(parentDevice, boardInformation, transactionId) {
		await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, parentDevice, 'ParentReadyRequest', {
			TransactionId: transactionId,
			Board: buildBoardPayload(boardInformation)
		}, buildBoardMessageConfig(boardInformation), dependencies.httpClientConfig);
	}

	async function sendConfigSync(parentDevice, boardInformation, transactionId) {
		await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, parentDevice, 'ConfigSync', {
			TransactionId: transactionId,
			Config: callbacks.getParentSyncConfig(),
			Board: buildBoardPayload(boardInformation),
			Capabilities: {
				CanJoinCall: true,
				CanMuteAudio: true,
				CanMuteVideo: true,
				CanReceiveMessages: true
			}
		}, buildBoardMessageConfig(boardInformation), dependencies.httpClientConfig);
	}

	async function sendRegistrationValidated(parentDevice, message) {
		const boardInformation = await callbacks.getRuntimeBoardInformation();
		await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, parentDevice, 'RegistrationValidated', {
			TransactionId: String(message.Payload && message.Payload.TransactionId || ''),
			Status: 'Registered'
		}, buildBoardMessageConfig(boardInformation), dependencies.httpClientConfig);
	}

	function buildBoardPayload(boardInformation) {
		return {
			Serial: boardInformation.serial,
			Name: boardInformation.name,
			Host: boardInformation.host,
			Username: boardInformation.username,
			Password: boardInformation.password,
			MacAddress: boardInformation.macAddress,
			ProductPlatform: boardInformation.productPlatform
		};
	}

	function buildBoardMessageConfig(boardInformation) {
		return {
			app: 'Companion Board 2026',
			serial: boardInformation.serial,
			source: {
				Role: 'Board',
				Name: boardInformation.name,
				Host: boardInformation.host,
				MacAddress: boardInformation.macAddress
			}
		};
	}

	function setLockedPrompt(title, text, feedbackId, promptOptions) {
		if (!operation) {
			return;
		}
		operation.currentPrompt = {
			title: title,
			text: text,
			feedbackId: feedbackId,
			options: promptOptions
		};
	}

	async function reopenLockedPrompt() {
		if (!operation || !operation.currentPrompt) {
			return;
		}
		const prompt = operation.currentPrompt;
		await dependencies.companionUi.showCompanionPrompt(dependencies.xapi, {
			title: prompt.title,
			text: prompt.text,
			feedbackId: prompt.feedbackId,
			options: prompt.options,
			duration: 0
		});
	}

	async function finishOperation() {
		operation = null;
		messageWaiter = null;
		decisionWaiter = null;
		clearStageTimeouts();
		await dependencies.companionUi.clearPrompt(dependencies.xapi, FEEDBACK_IDS.progress);
		await dependencies.companionUi.clearPrompt(dependencies.xapi, FEEDBACK_IDS.overwrite);
	}

	async function showResult(title, text) {
		await dependencies.companionUi.showCompanionPrompt(dependencies.xapi, {
			title: title,
			text: text,
			feedbackId: FEEDBACK_IDS.result,
			options: ['Dismiss'],
			duration: RESULT_DURATION_SECONDS
		});
	}

	async function notifyStateChanged(onlineCandidate) {
		if (callbacks.onStateChanged) {
			await callbacks.onStateChanged({
				parentDevices: parentDevices.slice(),
				pendingDeregistrations: pendingDeregistrations.slice(),
				onlineCandidate: onlineCandidate || null
			});
		}
	}

	function clearStageTimeouts() {
		if (stageTimeout) {
			clearTimeout(stageTimeout);
			stageTimeout = null;
		}
		clearRetryTimeout();
	}

	function clearRetryTimeout() {
		if (retryTimeout) {
			clearTimeout(retryTimeout);
			retryTimeout = null;
		}
	}

	function isBusy() {
		return !!(wizard || operation);
	}

	function isProvisioningLocked() {
		return !!(operation && operation.kind === 'registration');
	}

	function isUnhealthy() {
		return !!getRuntimeContext().isUnhealthy;
	}

	function getRuntimeContext() {
		return callbacks.getRuntimeContext ? callbacks.getRuntimeContext() : {};
	}

	function findParentBySerial(serial) {
		return parentDevices.find(device => device.serial === serial) || null;
	}

	function findPendingDeregistration(serial) {
		return pendingDeregistrations.find(item => item.serial === serial) || null;
	}

	function createTransactionId(prefix) {
		transactionSequence++;
		return `${prefix}:${Date.now()}:${transactionSequence}`;
	}

	function normalizeHost(value) {
		const host = String(value || '').trim().toLowerCase();
		if (!host || host.indexOf('://') >= 0 || host.indexOf('/') >= 0 || /\s/.test(host) || host.length > 253) {
			return '';
		}
		return host;
	}

	function isWizardTextInput(feedbackId) {
		return feedbackId === FEEDBACK_IDS.host || feedbackId === FEEDBACK_IDS.username || feedbackId === FEEDBACK_IDS.password || feedbackId === FEEDBACK_IDS.confirmPassword;
	}

	function getConfigDeniedReason(payload) {
		if (payload && payload.Reason === 'MaxBoardsReached') {
			return `The parent room already has the maximum of ${payload.MaxBoards || 3} registered boards.`;
		}
		return payload && payload.Reason ? `The parent room denied registration: ${payload.Reason}.` : 'The parent room denied this board registration request.';
	}

	function buildOperationError(userMessage, code) {
		const error = new Error(userMessage);
		error.code = code;
		error.UserMessage = userMessage;
		return error;
	}

	return {
		setState,
		getState,
		reconcileStoredConflicts,
		reconcilePendingDeregistrations,
		handleWidgetAction,
		handleTextInputResponse,
		handleTextInputCleared,
		handlePromptResponse,
		handlePromptCleared,
		handleMessage,
		isBusy,
		isProvisioningLocked
	};
}

const parentRegistration = {
	create: createParentRegistration
};

export { parentRegistration };
