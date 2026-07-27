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
 * Date Created:            July 22, 2026
 * Revised:                 July 27, 2026
 * Version:                 1.0.7
 *
 * Description:             Parent Room Registration and Deregistration controller. Owns the
 *                          PIN-authorized wizard, locked provisioning stages, long-hold removal,
 *                          Pending Deregistration tombstones, and registration reconciliation.
 *
 * Documentation:           https://github.com/ctg-tme/Custom_Companion_2026/blob/main/docs/technical-reference.md
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro, Board Pro G2, Board Pro G3, Desk Pro, Desk, Desk Mini, Desk Pro G2
 *
 * Code Dependencies:       Custom-Campanion_4_UI_2026, Custom-Campanion_6_DeviceComms_2026,
 *                          Custom-Campanion_8_Services_2026, Custom-Campanion_14_PinMode_2026
 *
 * AI Generation:           Percentage: 95% (estimated)
 *                          Model(s): OpenAI Codex (GPT-5 family)
 *                          Instruction File(s): AGENTS.md,
 *                          https://github.com/ctg-tme/Bobbys_Macro_AI_Agents/blob/main/AGENTS.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

/*
 * Registration xAPI surface:
 * - UI events are routed by Main: Widget.Action, Prompt.Response/Cleared,
 *   and TextInput.Response/Clear.
 * - Authenticated Companion Installer Message.Send requests can register, inventory,
 *   or deregister Parent Room Devices through this same controller.
 * - Commands are encapsulated by CompanionUI: Prompt Display/Clear, TextInput Display, Panel Close.
 * - Network workflow: DeviceComms parent identity GET, macro install putxml, Peripherals Connect /
 *   HeartBeat putxml, and Message.Send putxml for ParentReadyRequest, ConfigSync, validation,
 *   DeregisterRequest, and acknowledgements.
 * - Registration readiness/config requests and the user-visible deregistration confirmation
 *   request retry every five seconds inside their documented 60-second stages. Local xAPI
 *   commands remain single-attempt.
 */

const STAGE_TIMEOUT_MS = 60000;
const NETWORK_RETRY_MS = 5000;
const LONG_PRESS_MS = 3000;
const RESULT_DURATION_SECONDS = 60;

const FEEDBACK_IDS = {
	registrationInfo: 'cc26_registration_info',
	host: 'cc26_registration_host',
	serial: 'cc26_registration_serial',
	username: 'cc26_registration_username',
	password: 'cc26_registration_password',
	confirmPassword: 'cc26_registration_confirm_password',
	confirmRegistration: 'cc26_registration_confirm',
	overwrite: 'cc26_registration_overwrite',
	progress: 'cc26_registration_progress',
	result: 'cc26_registration_result',
	deregistrationConfirm: 'cc26_deregistration_confirm'
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
	let cleanupResultNotice = null;
	let transactionSequence = 0;
	let installerRequestInFlight = false;
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

		if (dependencies.companionUi.isParentRegistrationWidget(event.WidgetId)) {
			if (event.Type !== 'released') {
				return true;
			}
			const widget = dependencies.companionUi.parseWidgetId(event.WidgetId);
			if (widget.action === 'RegistrationInfo') {
				await showRegistrationInformation();
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
			showDeregistrationConfirmation(parsed.index).catch(error => {
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

	async function showRegistrationInformation() {
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionPrompt(dependencies.xapi, {
			title: 'Register Parent Room Device',
			text: 'Register a Parent Room Device to make it available in Companion Device Select. You will need its host address, serial number, and RoomOS account. Registration does not select the Parent Room Device or interrupt Standalone use.',
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
		if (context.mode === 'Paired' && await callbacks.isCompanionDeviceInActiveCall()) {
			await showResult('Call In Progress', 'Registering another Parent Room Device is unavailable while this Paired Companion Device is in a call. End the Companion Device call or run Standalone first.');
			return;
		}

		await dependencies.pinModeController.requestAuthorization({
			title: 'Register Parent Room Device',
			text: 'Enter the current PIN to register a Parent Room Device.',
			submitText: 'Continue',
			onAuthorized: beginRegistrationWizard
		});
	}

	async function beginRegistrationWizard() {
		wizard = { host: '', serial: '', username: '', password: '', step: 'info' };
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionPrompt(dependencies.xapi, {
			title: 'Register Parent Room Device',
			text: 'You will enter the Parent Room Device host address, expected serial number, and a RoomOS account that can install and run the Custom Companion Parent Room macros. Credentials are stored on this Companion Device for autonomous communication.',
			feedbackId: FEEDBACK_IDS.registrationInfo,
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
				await showHostInput('Enter a valid host name, IPv4 address, or bracketed IPv6 address without a URL scheme or path.');
				return true;
			}
			wizard.host = host;
			await showSerialInput();
			return true;
		}
		if (event.FeedbackId === FEEDBACK_IDS.serial) {
			const serial = normalizeExpectedSerialInput(value);
			if (!serial) {
				await showSerialInput('Enter the Parent Room Device serial number using letters and numbers; spaces and hyphens are optional.');
				return true;
			}
			wizard.serial = serial;
			await showUsernameInput();
			return true;
		}
		if (event.FeedbackId === FEEDBACK_IDS.username) {
			const username = normalizeUsername(value);
			if (!username) {
				await showUsernameInput('Enter a valid RoomOS username using letters, numbers, periods, underscores, hyphens, or @.');
				return true;
			}
			wizard.username = username;
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

		try {
			await showRegistrationConfirmation();
		} catch (error) {
			wizard.password = '';
			dependencies.utils.softError({
				Context: 'Failed to display Parent Room Registration confirmation',
				FeedbackId: FEEDBACK_IDS.confirmPassword,
				Error: error
			});
			try {
				await showPasswordInput('The registration confirmation could not be displayed. Review the entries and enter the password again.');
			} catch (recoveryError) {
				cancelWizard();
				dependencies.utils.softError({
					Context: 'Failed to recover Parent Room Registration after the confirmation display failed',
					FeedbackId: FEEDBACK_IDS.password,
					Error: recoveryError
				});
			}
		}
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
		if (event.FeedbackId === FEEDBACK_IDS.deregistrationConfirm) {
			if (String(event.OptionId || event.Option || '') === '1' && operation && operation.kind === 'deregistration-confirmation') {
				const parentDevice = operation.parentDevice;
				operation = null;
				await dependencies.pinModeController.requestAuthorization({
					title: 'Deregister Parent Room Device',
					text: 'Enter the current PIN to deregister this Companion Device from the Parent Room Device.',
					submitText: 'Deregister',
					onAuthorized: () => deregisterParent(parentDevice)
				});
			} else if (operation && operation.kind === 'deregistration-confirmation') {
				operation = null;
			}
			return true;
		}
		if (!wizard) {
			return false;
		}

		const option = String(event.OptionId || event.Option || '');
		if (event.FeedbackId === FEEDBACK_IDS.registrationInfo) {
			if (option === '1') {
				await showHostInput();
			} else {
				cancelWizard();
			}
			return true;
		}
		if (event.FeedbackId === FEEDBACK_IDS.confirmRegistration) {
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
		if (operation && operation.kind === 'deregistration-confirmation' && event.FeedbackId === FEEDBACK_IDS.deregistrationConfirm) {
			operation = null;
			return true;
		}
		if (wizard && (event.FeedbackId === FEEDBACK_IDS.registrationInfo || event.FeedbackId === FEEDBACK_IDS.confirmRegistration)) {
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
			title: 'Parent Room Device Host',
			text: text || 'Enter the Parent Room Device host name or IP address.',
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
			title: 'Parent Room Device Username',
			text: text || 'Enter the RoomOS username for the Parent Room Device.',
			feedbackId: FEEDBACK_IDS.username,
			inputType: 'SingleLine',
			placeholder: 'Username',
			submitText: 'Next',
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	async function showSerialInput(text) {
		wizard.step = 'serial';
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionTextInput(dependencies.xapi, {
			title: 'Parent Room Device Serial',
			text: text || 'Enter the expected serial number for the Parent Room Device.',
			feedbackId: FEEDBACK_IDS.serial,
			inputType: 'SingleLine',
			placeholder: 'Parent Room Device serial number',
			submitText: 'Next',
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	async function showPasswordInput(text) {
		wizard.step = 'password';
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionTextInput(dependencies.xapi, {
			title: 'Parent Room Device Password',
			text: text || 'Enter the password for the Parent Room Device account.',
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
			title: 'Confirm Parent Room Device Password',
			text: 'Enter the Parent Room Device password again.',
			feedbackId: FEEDBACK_IDS.confirmPassword,
			inputType: 'Password',
			placeholder: 'Confirm password',
			submitText: 'Next',
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	async function showRegistrationConfirmation() {
		wizard.step = 'confirm';
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionPrompt(dependencies.xapi, {
			title: 'Register Parent Room Device?',
			text: `Host: ${wizard.host}; Serial: ${wizard.serial}; Username: ${wizard.username}. The Companion Device will verify this identity before installing the shared Parent Room macros and registering with the Parent Room Device.`,
			feedbackId: FEEDBACK_IDS.confirmRegistration,
			options: ['Register Device', 'Cancel'],
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	function cancelWizard() {
		wizard = null;
	}

	async function runRegistration(credentials, registrationOptions) {
		const options = registrationOptions || {};
		const transactionId = options.transactionId || createTransactionId('registration');
		operation = {
			kind: 'registration',
			transactionId: transactionId,
			channel: options.channel || 'in-room',
			allowOverwrite: !!options.allowOverwrite,
			candidate: null,
			currentPrompt: null,
			mayHaveRegistered: false,
			configDenied: false,
			hadExistingRegistration: false,
			supersededTombstoneSerial: ''
		};
		if (usesInRoomOperationUi()) {
			await dependencies.companionUi.closeProtectedPanel(dependencies.xapi);
		}

		try {
			const candidate = await runLocalStage('Verifying Parent Room Device', `Checking the host, expected serial number, and credentials for ${credentials.host}.`, () => dependencies.deviceComms.parentInitializationRequest(dependencies.xapi, credentials, dependencies.httpClientConfig));
			validateExpectedParentSerial(credentials.serial, candidate.serial, credentials.host);
			operation.candidate = candidate;
			operation.hadExistingRegistration = !!findParentBySerial(candidate.serial);
			await confirmRegistrationIntent(candidate);
			validateCompanionDeviceCapacity(candidate);

			await runLocalStage('Installing Parent Room Runtime', `Installing and starting the shared Custom Companion Parent Room macros on ${candidate.name}.`, async () => {
				const macroPayloads = await dependencies.companionDeviceServices.getParentInstallMacroPayloads(dependencies.xapi, dependencies.installConfig);
				await dependencies.deviceComms.installParentMacros(dependencies.xapi, candidate, macroPayloads, dependencies.installConfig, dependencies.httpClientConfig);
			});

			const companionDeviceInformation = await callbacks.getRuntimeCompanionDeviceInformation();
			const peripheralInfo = dependencies.companionDeviceServices.buildCompanionPeripheralInfo(companionDeviceInformation, dependencies.configVersion, dependencies.peripheralType);
			await runLocalStage('Connecting Companion Device', `Registering this Companion Device as a peripheral on ${candidate.name}.`, async () => {
				await dependencies.deviceComms.connectPeripheral(dependencies.xapi, candidate, peripheralInfo, dependencies.httpClientConfig);
				await dependencies.deviceComms.sendPeripheralHeartbeat(dependencies.xapi, candidate, peripheralInfo.ID, dependencies.initialHeartbeatTimeout, dependencies.httpClientConfig);
			});

			await runMessageStage('Waiting for Parent Room Runtime', `${candidate.name} is starting the Parent Room runtime and confirming readiness.`, 'ParentReady', () => sendParentReadyRequest(candidate, companionDeviceInformation, transactionId));
			operation.mayHaveRegistered = true;
			await runMessageStage('Confirming Parent Room Registration', `${candidate.name} is validating capacity and saving this Companion Device registration.`, 'ConfigAccepted', () => sendConfigSync(candidate, companionDeviceInformation, transactionId));

			await runLocalStage('Saving Parent Room Registration', `Saving ${candidate.name} to this Companion Device.`, () => commitRegistration(candidate));
			const completedOperation = operation;
			await finishOperation();
			if (completedOperation && completedOperation.channel === 'installer') {
				reportInstallerRegistrationResult('completed', completedOperation.transactionId, `${candidate.name} was successfully registered.`, candidate);
			} else {
				await showResult('Parent Room Device Registered', `${candidate.name} was successfully registered. It is now available in Companion Device Select.`);
			}
			dependencies.log.info({ Message: 'Parent Room Registration completed', Host: candidate.host, Serial: candidate.serial, TransactionId: transactionId });
		} catch (error) {
			await handleRegistrationFailure(error);
		}
	}

	async function confirmRegistrationIntent(candidate) {
		const tombstone = findPendingDeregistration(candidate.serial);
		const existing = findParentBySerial(candidate.serial);
		if (isInstallerRegistration()) {
			if ((tombstone || existing) && !operation.allowOverwrite) {
				throw buildOperationError(`${candidate.name} is already registered or has a Pending Deregistration. Select the replacement acknowledgement in the Companion Installer before continuing.`, 'CC26-INSTALLER-REGISTRATION-REPLACEMENT-REQUIRED');
			}
			if (tombstone) {
				operation.supersededTombstoneSerial = candidate.serial;
				if (cleanupResultNotice && cleanupResultNotice.serial === candidate.serial) {
					cleanupResultNotice = null;
				}
			}
			return;
		}
		if (tombstone) {
			const confirmed = await runDecisionStage('Re-register Parent Room Device?', `${candidate.name} has a Pending Deregistration. Re-registering makes the new registration the current intent and cancels pending cleanup.`, ['Re-register', 'Cancel']);
			if (!confirmed) {
				throw buildOperationError('Registration canceled; pending removal was retained.', 'CC26-REGISTRATION-CANCELED');
			}
			operation.supersededTombstoneSerial = candidate.serial;
			if (cleanupResultNotice && cleanupResultNotice.serial === candidate.serial) {
				cleanupResultNotice = null;
			}
		}

		if (existing) {
			const confirmed = await runDecisionStage('Overwrite Parent Room Registration?', `${candidate.name} is already registered. Replace its saved host and credentials with the newly verified values?`, ['Overwrite', 'Cancel']);
			if (!confirmed) {
				throw buildOperationError('Registration overwrite was canceled.', 'CC26-REGISTRATION-CANCELED');
			}
		}
	}

	function validateCompanionDeviceCapacity(candidate) {
		if (!findParentBySerial(candidate.serial) && parentDevices.length >= policy.maxParentDevices) {
			throw buildOperationError(`This Companion Device already has the maximum of ${policy.maxParentDevices} registered Parent Room Devices. Deregister a Parent Room Device before registering another.`, 'CC26-BOARD-PARENT-LIMIT');
		}
	}

	async function runLocalStage(title, text, task) {
		if (usesInRoomOperationUi()) {
			setLockedPrompt(title, text, FEEDBACK_IDS.progress, ['Please Wait']);
			await reopenLockedPrompt();
		}
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
		if (usesInRoomOperationUi()) {
			setLockedPrompt(title, text, FEEDBACK_IDS.progress, ['Please Wait']);
			await reopenLockedPrompt();
		}
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
				reject(buildStageTimeoutError());
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
			.catch(error => dependencies.log.debug({ Message: 'Parent Room Registration network stage request failed; the stage remains active', Action: waiter.expectedAction, Error: error.code || error.message || 'Unknown request error', ErrorContext: error.Context || {} }))
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
		if (message.Action === 'DeregistrationAccepted') {
			const matchingWaiter = messageWaiter
				&& messageWaiter.expectedAction === 'DeregistrationAccepted'
				&& transactionId === messageWaiter.transactionId
				&& message.Serial === messageWaiter.serial
				? messageWaiter
				: null;
			const pending = findPendingDeregistration(message.Serial);
			const wasAccepted = await handleDeregistrationAccepted(message);
			if (wasAccepted && matchingWaiter && messageWaiter === matchingWaiter) {
				messageWaiter = null;
				matchingWaiter.resolve(message);
				return true;
			}
			if (!wasAccepted && pending && !isRegistrationSupersedingTombstone(message.Serial)) {
				await retryPendingDeregistration(pending, 'StaleDeregistrationAcknowledgement');
			}
			return true;
		}
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

		const tombstone = findPendingDeregistration(message.Serial);
		if (tombstone) {
			if (isRegistrationSupersedingTombstone(message.Serial)) {
				dependencies.log.debug({ Message: 'Suppressed Pending Deregistration retry while a newer Parent Room Registration is in progress', Serial: message.Serial, Action: message.Action });
				return true;
			}
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

	async function handleInstallerRegistrationRequest(message) {
		if (!message || message.Action !== dependencies.installerRegistrationAction || !message.Source || message.Source.Role !== 'Installer') {
			return false;
		}

		let transactionId = '';
		try {
			const payload = message.Payload || {};
			transactionId = validateInstallerTransactionId(payload.TransactionId, 'registration');
			if (isBusy()) {
				throw buildOperationError('Another Parent Room Registration or Deregistration is already in progress.', 'CC26-INSTALLER-REGISTRATION-BUSY');
			}
			installerRequestInFlight = true;
			if (isUnhealthy()) {
				throw buildOperationError('Parent Room Registration is unavailable while the Companion Device is unhealthy.', 'CC26-INSTALLER-REGISTRATION-UNHEALTHY');
			}
			await validateInstallerCompanionIdentity(message);
			const context = getRuntimeContext();
			if (context.mode === 'Paired' && await callbacks.isCompanionDeviceInActiveCall()) {
				throw buildOperationError('Registering another Parent Room Device is unavailable while this Paired Companion Device is in a call. End the Companion Device call or run Standalone first.', 'CC26-INSTALLER-REGISTRATION-CALL-IN-PROGRESS');
			}
			const parent = payload.Parent || {};
			const credentials = {
				host: normalizeHost(parent.Host),
				serial: normalizeExpectedSerialInput(parent.Serial),
				username: normalizeUsername(parent.Username),
				password: String(parent.Password || '')
			};
			if (!credentials.host || !credentials.serial || !credentials.username || !credentials.password) {
				throw buildOperationError('The Companion Installer registration request is missing valid Parent Room Device details.', 'CC26-INSTALLER-REGISTRATION-INVALID-REQUEST');
			}
			await runRegistration(credentials, {
				transactionId: transactionId,
				channel: 'installer',
				allowOverwrite: payload.AllowOverwrite === true
			});
		} catch (error) {
			reportInstallerRegistrationResult('failed', transactionId, error && error.UserMessage ? error.UserMessage : 'The Parent Room Device could not be registered.');
		} finally {
			installerRequestInFlight = false;
		}
		return true;
	}

	async function handleInstallerInventoryRequest(message) {
		if (!message || message.Action !== dependencies.installerInventoryAction || !message.Source || message.Source.Role !== 'Installer') {
			return false;
		}

		let transactionId = '';
		try {
			const payload = message.Payload || {};
			transactionId = validateInstallerTransactionId(payload.TransactionId, 'inventory');
			if (isBusy()) {
				throw buildOperationError('Another Parent Room Registration or Deregistration is already in progress.', 'CC26-INSTALLER-INVENTORY-BUSY');
			}
			installerRequestInFlight = true;
			await validateInstallerCompanionIdentity(message);
			const context = getRuntimeContext();
			reportInstallerInventoryResult('completed', transactionId, '', {
				registeredParents: parentDevices.map(parentDevice => ({
					Serial: parentDevice.serial,
					Name: parentDevice.name || parentDevice.host,
					Host: parentDevice.host,
					Active: context.activeParentSerial === parentDevice.serial
				})),
				pendingDeregistrations: pendingDeregistrations.map(tombstone => ({
					Serial: tombstone.serial,
					Name: tombstone.name || tombstone.host,
					Host: tombstone.host,
					CreatedAt: tombstone.createdAt || ''
				}))
			});
		} catch (error) {
			reportInstallerInventoryResult('failed', transactionId, error && error.UserMessage ? error.UserMessage : 'The Companion Device could not read its Parent Room Registrations.');
		} finally {
			installerRequestInFlight = false;
		}
		return true;
	}

	async function handleInstallerDeregistrationRequest(message) {
		if (!message || message.Action !== dependencies.installerDeregistrationAction || !message.Source || message.Source.Role !== 'Installer') {
			return false;
		}

		let transactionId = '';
		try {
			const payload = message.Payload || {};
			transactionId = validateInstallerTransactionId(payload.TransactionId, 'deregistration');
			if (isBusy()) {
				throw buildOperationError('Another Parent Room Registration or Deregistration is already in progress.', 'CC26-INSTALLER-DEREGISTRATION-BUSY');
			}
			installerRequestInFlight = true;
			if (isUnhealthy()) {
				throw buildOperationError('Parent Room Deregistration is unavailable while the Companion Device is unhealthy.', 'CC26-INSTALLER-DEREGISTRATION-UNHEALTHY');
			}
			await validateInstallerCompanionIdentity(message);
			const parentSerial = normalizeExpectedSerialInput(payload.ParentSerial);
			const parentDevice = findParentBySerial(parentSerial);
			if (!parentSerial || !parentDevice) {
				throw buildOperationError('The selected Parent Room Registration is no longer saved on this Companion Device.', 'CC26-INSTALLER-DEREGISTRATION-NOT-FOUND');
			}
			await deregisterParent(parentDevice, {
				transactionId: transactionId,
				channel: 'installer'
			});
		} catch (error) {
			reportInstallerDeregistrationResult('failed', transactionId, error && error.UserMessage ? error.UserMessage : 'The Parent Room Device could not be deregistered.');
		} finally {
			installerRequestInFlight = false;
		}
		return true;
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
				const companionDeviceInformation = await callbacks.getRuntimeCompanionDeviceInformation();
				const tombstone = buildTombstone(failedOperation.candidate, companionDeviceInformation, createTransactionId('registration-cleanup'));
				await savePendingDeregistration(tombstone);
				await retryPendingDeregistration(tombstone, 'RegistrationFailureCleanup');
			} catch (cleanupError) {
				dependencies.log.warn({ Message: 'Could not queue cleanup after failed Parent Room Registration', Error: cleanupError.code || cleanupError.message || 'Unknown cleanup error' });
			}
		}

		const failureText = error && error.UserMessage ? error.UserMessage : 'The Parent Room Device could not be registered.';
		await finishOperation();
		if (failedOperation && failedOperation.channel === 'installer') {
			reportInstallerRegistrationResult('failed', failedOperation.transactionId, failureText);
			return;
		}
		if (error && error.code === 'CC26-REGISTRATION-CANCELED') {
			await showResult('Parent Room Registration Canceled', error.UserMessage || 'Parent Room Registration was canceled.');
			return;
		}
		const logGuidance = failedOperation && failedOperation.mayHaveRegistered ? ' Inspect the Parent Room Device macro logs for more details.' : '';
		await showResult('Parent Room Registration Failed', `${failureText}${logGuidance}`);
		dependencies.log.warn({ Message: 'Parent Room Registration failed', Code: error && error.code || 'CC26-REGISTRATION-FAILED', Error: error && error.message || 'Unknown registration error', ErrorContext: error && error.Context || {} });
	}

	async function showDeregistrationConfirmation(parentIndex) {
		if (isBusy() || isUnhealthy()) {
			return;
		}
		const parentDevice = parentDevices[parentIndex];
		if (!parentDevice) {
			return;
		}
		const context = getRuntimeContext();
		const deregisteringActiveParent = context.activeParentSerial === parentDevice.serial;
		const hasActiveCall = deregisteringActiveParent && await callbacks.isCompanionDeviceInActiveCall();
		const callWarning = hasActiveCall ? ' This Companion Device will leave its call and transition to Standalone; the call will remain active on the Parent Room Device.' : '';
		operation = { kind: 'deregistration-confirmation', parentDevice: parentDevice };
		dependencies.pinModeController.touchSession();
		await dependencies.companionUi.showCompanionPrompt(dependencies.xapi, {
			title: 'Deregister Parent Room Device?',
			text: `Deregister ${parentDevice.name || parentDevice.host} from this Companion Device? The shared Parent Room macros will remain installed for other Companion Devices.${callWarning}`,
			feedbackId: FEEDBACK_IDS.deregistrationConfirm,
			options: ['Deregister Device', 'Cancel'],
			duration: STAGE_TIMEOUT_MS / 1000
		});
	}

	async function deregisterParent(parentDevice, deregistrationOptions) {
		if (!parentDevice || isUnhealthy()) {
			return;
		}
		const options = deregistrationOptions || {};
		operation = {
			kind: 'deregistration',
			transactionId: options.transactionId || '',
			channel: options.channel || 'in-room',
			parentDevice: parentDevice,
			candidate: null,
			currentPrompt: null
		};
		if (usesInRoomOperationUi()) {
			cleanupResultNotice = null;
			await dependencies.companionUi.closeProtectedPanel(dependencies.xapi);
		}
		const context = getRuntimeContext();
		let tombstone;
		try {
			if (context.activeParentSerial === parentDevice.serial) {
				await runLocalStage('Returning to Standalone', `Ending this Companion Device's active call, if any, and returning it to Standalone before deregistering ${parentDevice.name || parentDevice.host}.`, callbacks.releaseActiveParentForDeregistration);
			}
			const companionDeviceInformation = await callbacks.getRuntimeCompanionDeviceInformation();
			tombstone = buildTombstone(parentDevice, companionDeviceInformation, operation.transactionId || createTransactionId('deregistration'));
			operation.transactionId = tombstone.transactionId;
			operation.candidate = tombstone;
			await runLocalStage('Saving Parent Room Deregistration', `Deregistering ${parentDevice.name || parentDevice.host} from this Companion Device and preserving cleanup details until the Parent Room Device confirms.`, () => retireParentLocally(parentDevice, tombstone));
		} catch (error) {
			const failedOperation = operation;
			await finishOperation();
			const detail = 'The Companion Device could not save the local Parent Room Deregistration. Inspect the Companion Device macro logs for details.';
			if (failedOperation && failedOperation.channel === 'installer') {
				reportInstallerDeregistrationResult('failed', failedOperation.transactionId, detail);
			} else {
				await showResult('Parent Room Deregistration Failed', detail);
			}
			dependencies.log.error({ Message: 'Parent Room Deregistration failed locally', Error: error.code || error.message || 'Unknown deregistration error' });
			return;
		}

		try {
			await runMessageStage('Confirming Parent Room Deregistration', `${parentDevice.name || parentDevice.host} is removing this Companion Device's registration and peripheral.`, 'DeregistrationAccepted', () => sendDeregistrationRequest(tombstone));
			const completedOperation = operation;
			await finishOperation();
			const detail = `${parentDevice.name || parentDevice.host} was deregistered from this Companion Device and the Parent Room Device.`;
			if (completedOperation && completedOperation.channel === 'installer') {
				reportInstallerDeregistrationResult('completed', completedOperation.transactionId, detail);
			} else {
				await showResult('Parent Room Device Deregistered', detail);
			}
			dependencies.log.info({ Message: 'Parent Room Deregistration completed', Host: parentDevice.host, Serial: parentDevice.serial, TransactionId: tombstone.transactionId });
		} catch (error) {
			const pendingOperation = operation;
			await finishOperation();
			if (!findPendingDeregistration(parentDevice.serial)) {
				const detail = `${parentDevice.name || parentDevice.host} was deregistered from this Companion Device and the Parent Room Device.`;
				if (pendingOperation && pendingOperation.channel === 'installer') {
					reportInstallerDeregistrationResult('completed', pendingOperation.transactionId, detail);
				} else {
					await showResult('Parent Room Device Deregistered', detail);
				}
				return;
			}
			const detail = `${parentDevice.name || parentDevice.host} was deregistered from this Companion Device, but the Parent Room Device did not confirm cleanup. The Companion Device will retry automatically after either device reconnects.`;
			if (pendingOperation && pendingOperation.channel === 'installer') {
				reportInstallerDeregistrationResult('pending', pendingOperation.transactionId, detail);
			} else {
				cleanupResultNotice = {
					serial: parentDevice.serial,
					name: parentDevice.name || parentDevice.host,
					transactionId: tombstone.transactionId
				};
				await showResult('Parent Room Deregistration Pending', detail);
			}
			dependencies.log.warn({ Message: 'Parent Room Deregistration remains pending after the user-visible cleanup stage', Serial: parentDevice.serial, TransactionId: tombstone.transactionId, Error: error.code || error.message || 'Unknown deregistration confirmation error' });
		}
	}

	async function retireParentLocally(parentDevice, tombstone) {
		const previousTombstones = pendingDeregistrations.slice();
		const nextParents = parentDevices.filter(device => device.serial !== parentDevice.serial);
		await savePendingDeregistration(tombstone);
		try {
			await dependencies.mem.write(dependencies.parentDevicesStorageKey, nextParents);
		} catch (error) {
			try {
				await dependencies.mem.write(dependencies.pendingStorageKey, previousTombstones);
				pendingDeregistrations = previousTombstones;
			} catch (rollbackError) {
				dependencies.log.error({ Message: 'Failed to restore Pending Deregistration state after local room removal failure', Serial: parentDevice.serial, Error: rollbackError.code || rollbackError.message || 'Unknown rollback error' });
			}
			throw error;
		}
		parentDevices = nextParents;
		try {
			await notifyStateChanged();
		} catch (error) {
			dependencies.log.warn({ Message: 'Parent Room Deregistration committed but the Companion Device UI refresh failed', Serial: parentDevice.serial, Error: error.code || error.message || 'Unknown UI refresh error' });
		}
	}

	function buildTombstone(parentDevice, companionDeviceInformation, transactionId) {
		return {
			serial: parentDevice.serial,
			name: parentDevice.name,
			host: parentDevice.host,
			username: parentDevice.username,
			password: parentDevice.password,
			peripheralId: dependencies.companionDeviceServices.getCompanionPeripheralId(companionDeviceInformation),
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
			await retryPendingDeregistration(pendingDeregistrations[index], 'CompanionDeviceInitialization');
		}
	}

	async function retryPendingDeregistration(tombstone, reason) {
		if (!tombstone || reconciliationInFlight[tombstone.serial]) {
			return;
		}
		reconciliationInFlight[tombstone.serial] = true;
		try {
			await sendDeregistrationRequest(tombstone);
			dependencies.log.debug({ Message: 'Pending Deregistration request sent', Serial: tombstone.serial, Reason: reason, TransactionId: tombstone.transactionId });
		} catch (error) {
			dependencies.log.debug({ Message: 'Pending Deregistration remains queued', Serial: tombstone.serial, Reason: reason, Error: error.code || error.message || 'Unknown deregistration request error', ErrorContext: error.Context || {} });
		} finally {
			delete reconciliationInFlight[tombstone.serial];
		}
	}

	async function sendDeregistrationRequest(tombstone) {
		const companionDeviceInformation = await callbacks.getRuntimeCompanionDeviceInformation();
		await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, tombstone, 'DeregisterRequest', {
			TransactionId: tombstone.transactionId,
			PeripheralId: tombstone.peripheralId,
			Board: buildCompanionDevicePayload(companionDeviceInformation)
		}, buildCompanionDeviceMessageConfig(companionDeviceInformation), dependencies.httpClientConfig);
	}

	async function handleDeregistrationAccepted(message) {
		const tombstone = findPendingDeregistration(message.Serial);
		const transactionId = String(message.Payload && message.Payload.TransactionId || '');
		if (!tombstone || tombstone.transactionId !== transactionId) {
			dependencies.log.debug({ Message: 'Ignored stale DeregistrationAccepted acknowledgement', Serial: message.Serial, TransactionId: transactionId });
			return false;
		}
		const nextTombstones = pendingDeregistrations.filter(item => item.serial !== tombstone.serial);
		await dependencies.mem.write(dependencies.pendingStorageKey, nextTombstones);
		pendingDeregistrations = nextTombstones;
		dependencies.log.info({ Message: 'Parent Room Deregistration confirmed and tombstone removed', Serial: message.Serial, TransactionId: transactionId });
		if (cleanupResultNotice
			&& cleanupResultNotice.serial === message.Serial
			&& cleanupResultNotice.transactionId === transactionId
			&& !isRegistrationSupersedingTombstone(message.Serial)) {
			const confirmedNotice = cleanupResultNotice;
			cleanupResultNotice = null;
			await showResult('Parent Room Device Deregistered', `${confirmedNotice.name} was deregistered from this Companion Device and the Parent Room Device. Cleanup is now confirmed.`);
		}
		return true;
	}

	async function sendParentReadyRequest(parentDevice, companionDeviceInformation, transactionId) {
		await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, parentDevice, 'ParentReadyRequest', {
			TransactionId: transactionId,
			Board: buildCompanionDevicePayload(companionDeviceInformation)
		}, buildCompanionDeviceMessageConfig(companionDeviceInformation), dependencies.httpClientConfig);
	}

	async function sendConfigSync(parentDevice, companionDeviceInformation, transactionId) {
		await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, parentDevice, 'ConfigSync', {
			TransactionId: transactionId,
			Config: callbacks.getParentSyncConfig(),
			Board: buildCompanionDevicePayload(companionDeviceInformation),
			Capabilities: {
				CanJoinCall: true,
				CanMuteAudio: true,
				CanMuteVideo: true,
				CanReceiveMessages: true
			}
		}, buildCompanionDeviceMessageConfig(companionDeviceInformation), dependencies.httpClientConfig);
	}

	async function sendRegistrationValidated(parentDevice, message) {
		const companionDeviceInformation = await callbacks.getRuntimeCompanionDeviceInformation();
		await dependencies.deviceComms.sendMessageCommand(dependencies.xapi, parentDevice, 'RegistrationValidated', {
			TransactionId: String(message.Payload && message.Payload.TransactionId || ''),
			Status: 'Registered'
		}, buildCompanionDeviceMessageConfig(companionDeviceInformation), dependencies.httpClientConfig);
	}

	function buildCompanionDevicePayload(companionDeviceInformation) {
		return {
			Serial: companionDeviceInformation.serial,
			Name: companionDeviceInformation.name,
			Host: companionDeviceInformation.host,
			Username: companionDeviceInformation.username,
			Password: companionDeviceInformation.password,
			MacAddress: companionDeviceInformation.macAddress,
			ProductPlatform: companionDeviceInformation.productPlatform
		};
	}

	function buildCompanionDeviceMessageConfig(companionDeviceInformation) {
		return {
			app: 'Companion Board 2026',
			serial: companionDeviceInformation.serial,
			source: {
				Role: 'Board',
				Name: companionDeviceInformation.name,
				Host: companionDeviceInformation.host,
				MacAddress: companionDeviceInformation.macAddress
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
		const clearInRoomPrompts = usesInRoomOperationUi();
		operation = null;
		messageWaiter = null;
		decisionWaiter = null;
		clearStageTimeouts();
		if (clearInRoomPrompts) {
			await dependencies.companionUi.clearPrompt(dependencies.xapi, FEEDBACK_IDS.progress);
			await dependencies.companionUi.clearPrompt(dependencies.xapi, FEEDBACK_IDS.overwrite);
		}
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
		return !!(wizard || operation || installerRequestInFlight);
	}

	function isInstallerRegistration() {
		return !!(operation && operation.kind === 'registration' && operation.channel === 'installer');
	}

	function usesInRoomOperationUi() {
		return !!(operation
			&& (operation.kind === 'registration' || operation.kind === 'deregistration')
			&& operation.channel !== 'installer');
	}

	function isProvisioningLocked() {
		return !!(operation && (operation.kind === 'registration' || operation.kind === 'deregistration'));
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
		if (isValidIpv4Address(host) || isValidDnsHostName(host) || isValidBracketedIpv6Address(host)) {
			return host;
		}
		return '';
	}

	function isValidIpv4Address(host) {
		const parts = host.split('.');
		if (parts.length !== 4) {
			return false;
		}
		for (let index = 0; index < parts.length; index++) {
			if (!/^\d{1,3}$/.test(parts[index]) || Number(parts[index]) > 255) {
				return false;
			}
		}
		return true;
	}

	function isValidDnsHostName(host) {
		if (/^[0-9.]+$/.test(host)) {
			return false;
		}
		const labels = host.split('.');
		for (let index = 0; index < labels.length; index++) {
			const label = labels[index];
			if (!label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
				return false;
			}
		}
		return true;
	}

	function isValidBracketedIpv6Address(host) {
		if (host[0] !== '[' || host[host.length - 1] !== ']') {
			return false;
		}
		const address = host.slice(1, -1);
		if (!address || !/^[a-f0-9:.]+$/.test(address)) {
			return false;
		}
		if ((address[0] === ':' && address.slice(0, 2) !== '::')
			|| (address[address.length - 1] === ':' && address.slice(-2) !== '::')
			|| address.indexOf('::') !== address.lastIndexOf('::')) {
			return false;
		}
		const parts = address.split(':').filter(part => part !== '');
		let groupCount = parts.length;
		for (let index = 0; index < parts.length; index++) {
			const part = parts[index];
			if (part.indexOf('.') >= 0) {
				if (index !== parts.length - 1 || !isValidIpv4Address(part)) {
					return false;
				}
				groupCount++;
			} else if (!/^[a-f0-9]{1,4}$/.test(part)) {
				return false;
			}
		}
		return address.indexOf('::') >= 0 ? groupCount < 8 : groupCount === 8;
	}

	function normalizeSerial(value) {
		return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
	}

	function normalizeExpectedSerialInput(value) {
		const serialInput = String(value || '').trim();
		if (!serialInput || serialInput.length > 64 || !/^[A-Za-z0-9 -]+$/.test(serialInput)) {
			return '';
		}
		return normalizeSerial(serialInput);
	}

	function normalizeUsername(value) {
		const username = String(value || '').trim();
		if (!username || username.length > 128 || !/^[A-Za-z0-9._@-]+$/.test(username)) {
			return '';
		}
		return username;
	}

	function validateInstallerTransactionId(value, requestKind) {
		const transactionId = String(value || '');
		const prefix = `installer-${requestKind}:`;
		if (transactionId.indexOf(prefix) !== 0 || !/^installer-[a-z]+:[A-Za-z0-9:-]{8,200}$/.test(transactionId)) {
			throw buildOperationError(`The Companion Installer ${requestKind} request has an invalid transaction identifier.`, 'CC26-INSTALLER-INVALID-TRANSACTION');
		}
		return transactionId;
	}

	async function validateInstallerCompanionIdentity(message) {
		const runtimeCompanionDeviceInformation = await callbacks.getRuntimeCompanionDeviceInformation();
		if (normalizeSerial(message.Serial) !== normalizeSerial(runtimeCompanionDeviceInformation.serial)) {
			throw buildOperationError('The Companion Installer request does not identify this Companion Device.', 'CC26-INSTALLER-COMPANION-MISMATCH');
		}
	}

	function reportInstallerRegistrationResult(status, transactionId, detail, candidate) {
		const message = status === 'completed'
			? dependencies.installerRegistrationSuccessMessage
			: dependencies.installerRegistrationFailureMessage;
		const outcome = {
			Message: message,
			TransactionId: transactionId || 'unavailable',
			Detail: detail || '',
			Host: candidate && candidate.host || ''
		};
		if (status === 'completed') {
			dependencies.log.info(JSON.stringify(outcome));
		} else {
			dependencies.log.warn(JSON.stringify(outcome));
		}
	}

	function reportInstallerInventoryResult(status, transactionId, detail, inventory) {
		const result = inventory || {};
		const outcome = {
			Message: status === 'completed'
				? dependencies.installerInventorySuccessMessage
				: dependencies.installerInventoryFailureMessage,
			TransactionId: transactionId || 'unavailable',
			Detail: detail || '',
			RegisteredParents: result.registeredParents || [],
			PendingDeregistrations: result.pendingDeregistrations || []
		};
		if (status === 'completed') {
			dependencies.log.info(JSON.stringify(outcome));
		} else {
			dependencies.log.warn(JSON.stringify(outcome));
		}
	}

	function reportInstallerDeregistrationResult(status, transactionId, detail) {
		const message = status === 'completed'
			? dependencies.installerDeregistrationSuccessMessage
			: status === 'pending'
				? dependencies.installerDeregistrationPendingMessage
				: dependencies.installerDeregistrationFailureMessage;
		const outcome = {
			Message: message,
			TransactionId: transactionId || 'unavailable',
			Detail: detail || ''
		};
		if (status === 'completed') {
			dependencies.log.info(JSON.stringify(outcome));
		} else {
			dependencies.log.warn(JSON.stringify(outcome));
		}
	}

	function validateExpectedParentSerial(expectedSerial, observedSerial, host) {
		if (normalizeSerial(expectedSerial) === normalizeSerial(observedSerial)) {
			return;
		}
		throw buildOperationError(`The entered Parent Room Device serial number did not match the device at ${host}. No Parent Room macros were changed.`, 'CC26-PARENT-SERIAL-MISMATCH');
	}

	function isRegistrationSupersedingTombstone(serial) {
		return !!(operation
			&& operation.kind === 'registration'
			&& operation.supersededTombstoneSerial === serial);
	}

	function isWizardTextInput(feedbackId) {
		return feedbackId === FEEDBACK_IDS.host || feedbackId === FEEDBACK_IDS.serial || feedbackId === FEEDBACK_IDS.username || feedbackId === FEEDBACK_IDS.password || feedbackId === FEEDBACK_IDS.confirmPassword;
	}

	function buildStageTimeoutError() {
		if (operation && operation.kind === 'deregistration') {
			return buildOperationError('The Parent Room Device did not confirm cleanup within 60 seconds.', 'CC26-DEREGISTRATION-TIMEOUT');
		}
		return buildOperationError('The current registration stage did not complete within 60 seconds.', 'CC26-REGISTRATION-TIMEOUT');
	}

	function getConfigDeniedReason(payload) {
		if (payload && payload.Reason === 'MaxBoardsReached') {
			return `The Parent Room Device already has the maximum of ${payload.MaxBoards || 3} registered Companion Devices.`;
		}
		return payload && payload.Reason ? `The Parent Room Device denied registration: ${payload.Reason}.` : 'The Parent Room Device denied this Companion Device registration request.';
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
		handleInstallerInventoryRequest,
		handleInstallerDeregistrationRequest,
		handleInstallerRegistrationRequest,
		isBusy,
		isProvisioningLocked
	};
}

const parentRegistration = {
	create: createParentRegistration
};

export { parentRegistration };
