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

 * Date Created:            July 21, 2026
 * Revised:                 July 21, 2026
 * Version:                 1.0.0
 *
 * Description:             Board-local PIN Mode state, validation, protected-panel access,
 *                          PIN editing, and inactivity-session policy.
 *
 * Documentation:           N/A
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro Series
 *
 * Code Dependencies:       Custom-Campanion_4_UI_2026
 *
 * AI Generation:           Percentage: 95%
 *                          Model(s): GPT-5.3-Codex
 *                          Instruction File(s): /Users/bomcgoni/.claude/rules/Bobby_McGonigles_Macro_Rule_Set_for_AI.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 8;
const PIN_PATTERN = /^\d{4,8}$/;
const RECOVERY_PIN = '0000';
const MEMORY_RETRY_DELAY_MS = 2000;
const SESSION_TIMEOUT_MS = 60000;
const NOTICE_DURATION_SECONDS = 15;
const PAGE_CLOSE_GRACE_MS = 250;

const PIN_FEEDBACK_IDS = {
	access: 'cc26_pin_access',
	disable: 'cc26_pin_disable',
	editOld: 'cc26_pin_edit_old',
	editNew: 'cc26_pin_edit_new',
	editConfirm: 'cc26_pin_edit_confirm',
	notice: 'cc26_pin_notice'
};

function createPinMode(options) {
	const dependencies = options || {};
	const callbacks = dependencies.callbacks || {};
	let state = null;
	let pendingNewPin = '';
	let activeTextInputFeedbackId = '';
	let isNoticeActive = false;
	let isProtectedPanelOpen = false;
	let sessionTimeout = null;
	let pageCloseTimeout = null;

	async function initialize() {
		const configured = getConfiguredDefaultState();
		let storedState;

		try {
			storedState = await dependencies.mem.read(dependencies.storageKey);
		} catch (error) {
			if (!isMissingMemoryValue(error)) {
				dependencies.utils.hardError({
					Code: 'CC26-PIN-MEMORY-READ',
					Component: 'PinMode',
					Context: `Failed to read saved PIN Mode state [${dependencies.storageKey}]`,
					Remediation: 'Verify Memory-Storage-Functions-V2 and the generated storage macro, then restart the Macro Runtime.',
					Error: error
				});
			}

			const initialState = configured.valid ? configured.state : createRecoveryState(configured.state);
			await writeDuringInitialization(initialState, 'initialize PIN Mode memory');
			if (!configured.valid) {
				dependencies.utils.hardError({
					Code: 'CC26-PIN-DEFAULT-INVALID',
					Component: 'PinMode',
					Context: 'Configured PIN Mode defaults were invalid; a valid recovery record was saved',
					Remediation: 'Set pinMode.defaults.enabled to true or false and pinMode.defaults.pin to a quoted 4-8 digit value, then restart the Macro Runtime.'
				});
			}

			state = initialState;
			return getState();
		}

		if (!isValidState(storedState)) {
			const recoveryState = configured.valid ? configured.state : createRecoveryState(configured.state);
			await writeDuringInitialization(recoveryState, 'repair invalid PIN Mode memory');
			dependencies.utils.hardError({
				Code: 'CC26-PIN-STATE-INVALID',
				Component: 'PinMode',
				Context: 'Saved PIN Mode state was invalid; a valid recovery record was saved',
				Remediation: 'Review the generated storage macro for unexpected edits, then restart the Macro Runtime.'
			});
		}

		state = copyState(storedState);
		return getState();
	}

	async function handlePanelClicked(event) {
		if (!event || !dependencies.companionUi.isAccessPanel(event.PanelId)) {
			return false;
		}
		if (!state || isUnhealthy()) {
			return true;
		}

		touchSession();
		if (state.enabled) {
			await showAccessPinPrompt();
		} else {
			await openProtectedPanel();
		}
		return true;
	}

	async function handleWidgetAction(event) {
		if (!event || !dependencies.companionUi.isProtectedPanelWidget(event.WidgetId)) {
			return false;
		}

		touchSession();
		if (!dependencies.companionUi.isPinModeWidget(event.WidgetId)) {
			return false;
		}
		if (event.Type !== 'released' || !state || isUnhealthy()) {
			return true;
		}

		const widget = dependencies.companionUi.parseWidgetId(event.WidgetId);
		switch (widget.action) {
			case 'PinOn':
				await enablePinMode();
				break;
			case 'PinOff':
				await requestDisablePinMode();
				break;
			case 'PinEdit':
				await startPinEdit();
				break;
			case 'PinInfo':
				await showPinInfo();
				break;
		}
		return true;
	}

	async function handleTextInputResponse(event) {
		if (!event || !isPinFeedbackId(event.FeedbackId)) {
			return false;
		}
		if (!state || isUnhealthy()) {
			return true;
		}

		activeTextInputFeedbackId = '';
		touchSession();
		const submittedPin = String(event.Text || '');

		switch (event.FeedbackId) {
			case PIN_FEEDBACK_IDS.access:
				await handleAccessPin(submittedPin);
				break;
			case PIN_FEEDBACK_IDS.disable:
				await handleDisablePin(submittedPin);
				break;
			case PIN_FEEDBACK_IDS.editOld:
				await handleEditOldPin(submittedPin);
				break;
			case PIN_FEEDBACK_IDS.editNew:
				await handleEditNewPin(submittedPin);
				break;
			case PIN_FEEDBACK_IDS.editConfirm:
				await handleEditConfirmation(submittedPin);
				break;
		}
		return true;
	}

	function handlePageOpened(event) {
		if (!event || !dependencies.companionUi.isProtectedPanelPage(event.PageId)) {
			return false;
		}
		clearPageCloseTimeout();
		isProtectedPanelOpen = true;
		touchSession();
		return true;
	}

	function handlePageClosed(event) {
		if (!event || !dependencies.companionUi.isProtectedPanelPage(event.PageId)) {
			return false;
		}
		isProtectedPanelOpen = false;
		clearPageCloseTimeout();
		pageCloseTimeout = setTimeout(() => {
			pageCloseTimeout = null;
			if (!isProtectedPanelOpen) {
				endSession();
			}
		}, PAGE_CLOSE_GRACE_MS);
		return true;
	}

	async function handlePromptResponse(event) {
		if (!event || event.FeedbackId !== PIN_FEEDBACK_IDS.notice) {
			return false;
		}
		isNoticeActive = false;
		if (isProtectedPanelOpen) {
			touchSession();
		}
		return true;
	}

	async function enablePinMode() {
		if (state.enabled) {
			await closeProtectedPanel();
			await showNotice('PIN Mode Enabled', 'PIN Mode is enabled. Enter the PIN the next time you open Companion Device Select.');
			return;
		}

		if (!await persistState({ enabled: true, pin: state.pin }, 'enable PIN Mode')) {
			return;
		}
		await dependencies.companionUi.setPinModeFeedback(dependencies.xapi, true);
		await closeProtectedPanel();
		await showNotice('PIN Mode Enabled', 'PIN Mode is enabled. Enter the PIN the next time you open Companion Device Select.');
	}

	async function requestDisablePinMode() {
		if (!state.enabled) {
			await dependencies.companionUi.setPinModeFeedback(dependencies.xapi, false);
			await showNotice('PIN Mode Disabled', 'PIN Mode is disabled. Companion Device Select can now be opened without a PIN.');
			return;
		}
		pendingNewPin = '';
		await showPinPrompt({
			feedbackId: PIN_FEEDBACK_IDS.disable,
			title: 'Disable PIN Mode',
			text: 'Enter the current PIN to disable PIN Mode.',
			submitText: 'Disable'
		});
	}

	async function startPinEdit() {
		pendingNewPin = '';
		await showEditOldPinPrompt('Enter the current PIN to begin editing.');
	}

	async function showPinInfo() {
		touchSession();
		isNoticeActive = true;
		await dependencies.companionUi.showPinNotice(dependencies.xapi, {
			title: 'PIN Mode',
			text: `PIN Mode accepts a ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digit numeric PIN. The current PIN can be changed from this page.`,
			feedbackId: PIN_FEEDBACK_IDS.notice,
			duration: NOTICE_DURATION_SECONDS
		});
	}

	async function handleAccessPin(submittedPin) {
		if (submittedPin === state.pin) {
			await openProtectedPanel();
			return;
		}
		await showPinPrompt({
			feedbackId: PIN_FEEDBACK_IDS.access,
			title: 'Incorrect PIN',
			text: 'The PIN was incorrect. Try again or dismiss to cancel.',
			submitText: 'Open'
		});
	}

	async function handleDisablePin(submittedPin) {
		if (submittedPin !== state.pin) {
			await showPinPrompt({
				feedbackId: PIN_FEEDBACK_IDS.disable,
				title: 'Incorrect PIN',
				text: 'The current PIN was incorrect. Try again or dismiss to cancel.',
				submitText: 'Disable'
			});
			return;
		}

		if (!await persistState({ enabled: false, pin: state.pin }, 'disable PIN Mode')) {
			return;
		}
		await dependencies.companionUi.setPinModeFeedback(dependencies.xapi, false);
		await showNotice('PIN Mode Disabled', 'PIN Mode is disabled. Companion Device Select can now be opened without a PIN.');
	}

	async function handleEditOldPin(submittedPin) {
		if (submittedPin !== state.pin) {
			pendingNewPin = '';
			await showEditOldPinPrompt('The current PIN was incorrect. Enter it again to restart the PIN change.');
			return;
		}

		await showPinPrompt({
			feedbackId: PIN_FEEDBACK_IDS.editNew,
			title: 'Enter New PIN',
			text: `Enter a new ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digit numeric PIN.`,
			submitText: 'Next'
		});
	}

	async function handleEditNewPin(submittedPin) {
		if (!isValidPin(submittedPin)) {
			pendingNewPin = '';
			await showEditOldPinPrompt(`The new PIN must contain ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits. Enter the current PIN to restart.`);
			return;
		}

		pendingNewPin = submittedPin;
		await showPinPrompt({
			feedbackId: PIN_FEEDBACK_IDS.editConfirm,
			title: 'Confirm New PIN',
			text: 'Enter the new PIN again to confirm it.',
			submitText: 'Save'
		});
	}

	async function handleEditConfirmation(submittedPin) {
		if (!pendingNewPin || submittedPin !== pendingNewPin) {
			pendingNewPin = '';
			await showEditOldPinPrompt('The new PIN entries did not match. Enter the current PIN to restart.');
			return;
		}

		const nextPin = pendingNewPin;
		pendingNewPin = '';
		if (!await persistState({ enabled: state.enabled, pin: nextPin }, 'save a new PIN')) {
			return;
		}
		await closeProtectedPanel();
		await showNotice('PIN Updated', 'PIN updated. Use the new PIN the next time you open Companion Device Select.');
	}

	async function showAccessPinPrompt() {
		await showPinPrompt({
			feedbackId: PIN_FEEDBACK_IDS.access,
			title: 'Companion Device Select',
			text: 'Enter the PIN to open Companion Device Select.',
			submitText: 'Open'
		});
	}

	async function showEditOldPinPrompt(text) {
		await showPinPrompt({
			feedbackId: PIN_FEEDBACK_IDS.editOld,
			title: 'Edit PIN',
			text: text,
			submitText: 'Next'
		});
	}

	async function showPinPrompt(prompt) {
		touchSession();
		activeTextInputFeedbackId = prompt.feedbackId;
		await dependencies.companionUi.showPinTextInput(dependencies.xapi, {
			title: prompt.title,
			text: prompt.text,
			feedbackId: prompt.feedbackId,
			submitText: prompt.submitText,
			duration: SESSION_TIMEOUT_MS / 1000
		});
	}

	async function showNotice(title, text) {
		isNoticeActive = true;
		if (isProtectedPanelOpen) {
			touchSession();
		}
		await dependencies.companionUi.showPinNotice(dependencies.xapi, {
			title: title,
			text: text,
			feedbackId: PIN_FEEDBACK_IDS.notice,
			duration: NOTICE_DURATION_SECONDS
		});
	}

	async function openProtectedPanel() {
		isProtectedPanelOpen = true;
		touchSession();
		await dependencies.companionUi.openProtectedPanel(dependencies.xapi);
	}

	async function closeProtectedPanel() {
		endSession();
		await dependencies.companionUi.closeProtectedPanel(dependencies.xapi);
	}

	async function persistState(nextState, context) {
		try {
			await writeWithRetry(nextState, context);
			state = copyState(nextState);
			return true;
		} catch (error) {
			if (typeof callbacks.onHardError === 'function') {
				await callbacks.onHardError({
					Code: 'CC26-PIN-MEMORY-WRITE',
					Component: 'PinMode',
					Context: `MemoryStorage failed twice while attempting to ${context}`,
					Remediation: 'Verify Memory-Storage-Functions-V2 and the generated storage macro. PIN Mode state was not changed.',
					StorageErrorCode: getErrorCode(error)
				});
			}
			return false;
		}
	}

	async function writeDuringInitialization(nextState, context) {
		try {
			await writeWithRetry(nextState, context);
		} catch (error) {
			dependencies.utils.hardError({
				Code: 'CC26-PIN-MEMORY-WRITE',
				Component: 'PinMode',
				Context: `MemoryStorage failed twice while attempting to ${context}`,
				Remediation: 'Verify Memory-Storage-Functions-V2 and the generated storage macro, then restart the Macro Runtime.',
				StorageErrorCode: getErrorCode(error)
			});
		}
	}

	async function writeWithRetry(nextState, context) {
		try {
			await dependencies.mem.write(dependencies.storageKey, copyState(nextState));
			return;
		} catch (error) {
			dependencies.log.warn({
				Code: 'CC26-PIN-MEMORY-WRITE-RETRY',
				Component: 'PinMode',
				Context: `MemoryStorage write failed while attempting to ${context}; retrying once`,
				RetryDelayMs: MEMORY_RETRY_DELAY_MS,
				StorageErrorCode: getErrorCode(error)
			});
		}

		await delay(MEMORY_RETRY_DELAY_MS);
		await dependencies.mem.write(dependencies.storageKey, copyState(nextState));
	}

	function touchSession() {
		clearSessionTimeout();
		sessionTimeout = setTimeout(() => {
			sessionTimeout = null;
			expireSession().catch(error => {
				if (typeof callbacks.onHardError === 'function') {
					callbacks.onHardError({
						Code: 'CC26-PIN-SESSION-CLOSE',
						Component: 'PinMode',
						Context: 'Failed to close the protected Companion UI after 60 seconds of inactivity',
						Remediation: 'Diagnose Command.UserInterface.Extensions.Panel.Close and restart the Macro Runtime.',
						Error: error
					}).catch(callbackError => dependencies.utils.softError({ Context: 'Failed to enter Unhealthy State after PIN session close failure', Error: callbackError }));
				}
			});
		}, SESSION_TIMEOUT_MS);
	}

	async function expireSession() {
		const activeFeedbackId = activeTextInputFeedbackId;
		const hadActiveNotice = isNoticeActive;
		endSession();

		if (activeFeedbackId) {
			await dependencies.companionUi.clearPinTextInput(dependencies.xapi, activeFeedbackId);
		}
		if (hadActiveNotice) {
			await dependencies.companionUi.clearPrompt(dependencies.xapi, PIN_FEEDBACK_IDS.notice);
		}
		await dependencies.companionUi.closeProtectedPanel(dependencies.xapi);
	}

	function endSession() {
		clearSessionTimeout();
		clearPageCloseTimeout();
		pendingNewPin = '';
		activeTextInputFeedbackId = '';
		isNoticeActive = false;
		isProtectedPanelOpen = false;
	}

	async function stop() {
		const activeFeedbackId = activeTextInputFeedbackId;
		const hadActiveNotice = isNoticeActive;
		const hadOpenPanel = isProtectedPanelOpen;
		endSession();

		if (activeFeedbackId) {
			await dependencies.companionUi.clearPinTextInput(dependencies.xapi, activeFeedbackId);
		}
		if (hadActiveNotice) {
			await dependencies.companionUi.clearPrompt(dependencies.xapi, PIN_FEEDBACK_IDS.notice);
		}
		if (hadOpenPanel) {
			try {
				await dependencies.companionUi.closeProtectedPanel(dependencies.xapi);
			} catch (error) {
				dependencies.utils.softError({
					Context: 'Failed to close the protected Companion UI while stopping PIN Mode',
					Error: error
				});
			}
		}
	}

	function clearSessionTimeout() {
		if (sessionTimeout) {
			clearTimeout(sessionTimeout);
			sessionTimeout = null;
		}
	}

	function clearPageCloseTimeout() {
		if (pageCloseTimeout) {
			clearTimeout(pageCloseTimeout);
			pageCloseTimeout = null;
		}
	}

	function getConfiguredDefaultState() {
		const pinModeConfig = dependencies.config || {};
		const defaults = pinModeConfig.defaults || {};
		const configuredState = {
			enabled: defaults.enabled,
			pin: defaults.pin
		};
		return {
			state: configuredState,
			valid: isValidState(configuredState)
		};
	}

	function createRecoveryState(configuredState) {
		return {
			enabled: typeof configuredState.enabled === 'boolean' ? configuredState.enabled : true,
			pin: isValidPin(configuredState.pin) ? configuredState.pin : RECOVERY_PIN
		};
	}

	function getState() {
		return state ? { enabled: state.enabled } : { enabled: false };
	}

	function isEnabled() {
		return !!(state && state.enabled);
	}

	function isUnhealthy() {
		const context = typeof callbacks.getRuntimeContext === 'function' ? callbacks.getRuntimeContext() : {};
		return !!context.isUnhealthy;
	}

	return {
		initialize,
		handlePanelClicked,
		handleWidgetAction,
		handleTextInputResponse,
		handlePageOpened,
		handlePageClosed,
		handlePromptResponse,
		isEnabled,
		getState,
		stop
	};
}

function isMissingMemoryValue(error) {
	return !!(error && error.code === 'msfv2.r.3');
}

function isValidState(value) {
	return !!(value && typeof value === 'object' && !Array.isArray(value) && typeof value.enabled === 'boolean' && isValidPin(value.pin));
}

function isValidPin(value) {
	return typeof value === 'string' && PIN_PATTERN.test(value);
}

function copyState(value) {
	return {
		enabled: value.enabled,
		pin: value.pin
	};
}

function isPinFeedbackId(feedbackId) {
	return feedbackId === PIN_FEEDBACK_IDS.access ||
		feedbackId === PIN_FEEDBACK_IDS.disable ||
		feedbackId === PIN_FEEDBACK_IDS.editOld ||
		feedbackId === PIN_FEEDBACK_IDS.editNew ||
		feedbackId === PIN_FEEDBACK_IDS.editConfirm;
}

function delay(milliseconds) {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function getErrorCode(error) {
	return error && (error.code || error.name) ? String(error.code || error.name) : 'Unknown';
}

const pinMode = {
	create: createPinMode
};

export { pinMode };
