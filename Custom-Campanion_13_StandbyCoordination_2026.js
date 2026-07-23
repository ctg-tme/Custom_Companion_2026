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
 * Revised:                 July 23, 2026
 * Version:                 1.0.1
 *
 * Description:             Standby Coordination controller for the Custom Companion Solution.
 *                          Owns Standalone standby preference restoration, delayed parent sync,
 *                          user bypass choices, prompts, timers, and immediate standby commands.
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

/*
 * Standby Coordination xAPI surface:
 * - Subscriptions and initial reads: Config.Standby.Control,
 *   Config.Standby.Halfwake.Mode, and Config.Time.OfficeHours.Enabled.
 * - Commands: Command.Standby.Activate, Command.Standby.Deactivate,
 *   and Command.Standby.Halfwake.
 * - Network read: DeviceComms parentStandbyStateRequest for the selected Parent Room Device.
 * - Standby prompts are encapsulated by Custom-Campanion_4_UI_2026.
 */

const STANDBY_CONFIGS = [
	{ key: 'standbyControl', path: ['Standby', 'Control'], pairedValue: 'Off' },
	{ key: 'standbyHalfwakeMode', path: ['Standby', 'Halfwake', 'Mode'], pairedValue: 'Manual' },
	{ key: 'officeHoursEnabled', path: ['Time', 'OfficeHours', 'Enabled'], pairedValue: 'False' }
];
const STANDBY_SYNC_PROMPT_ID = 'cc26_standby_sync';

function createStandbyCoordination(options) {
	const dependencies = options || {};
	const callbacks = dependencies.callbacks || {};
	const policy = dependencies.policy || {};
	let standaloneConfig = {};
	let isApplyingConfig = false;
	let pendingSyncTimer = null;
	let pendingPromptRefreshTimer = null;
	let pendingSyncDeadline = 0;
	let pendingSyncState = '';
	let promptDismissed = false;
	let bypassUntil = 0;
	let bypassTimer = null;

	function setStandaloneConfig(value) {
		standaloneConfig = value || {};
	}

	async function initializeConfig() {
		let hasUpdates = false;
		for (let index = 0; index < STANDBY_CONFIGS.length; index++) {
			const standbyConfig = STANDBY_CONFIGS[index];
			if (standaloneConfig[standbyConfig.key] !== undefined) {
				continue;
			}
			const currentValue = await getConfigValue(standbyConfig);
			if (currentValue !== null) {
				standaloneConfig[standbyConfig.key] = currentValue;
				hasUpdates = true;
			}
		}

		if (hasUpdates) {
			await dependencies.mem.write(dependencies.storageKey, standaloneConfig);
		}
		registerConfigSubscriptions();
	}

	function registerConfigSubscriptions() {
		for (let index = 0; index < STANDBY_CONFIGS.length; index++) {
			const standbyConfig = STANDBY_CONFIGS[index];
			const node = getConfigNode(standbyConfig.path);
			if (!node || typeof node.on !== 'function') {
				dependencies.log.debug({ Message: 'Standby config subscription unavailable', Feature: standbyConfig.key, Path: standbyConfig.path.join('.') });
				continue;
			}

			node.on(value => {
				handleStandaloneConfigChange(standbyConfig, normalizeConfigEventValue(value)).catch(error => {
					dependencies.utils.softError({ Context: 'Failed to save Standalone standby config change', Feature: standbyConfig.key, Error: error });
				});
			});
		}
	}

	async function handleStandaloneConfigChange(standbyConfig, value) {
		const context = getRuntimeContext();
		if (isApplyingConfig || context.mode !== 'Standalone' || value === undefined || value === null) {
			return;
		}

		standaloneConfig[standbyConfig.key] = value;
		await dependencies.mem.write(dependencies.storageKey, standaloneConfig);
		dependencies.log.debug({ Message: 'Saved Standalone standby preference', Feature: standbyConfig.key, Value: value });
	}

	async function applyMode(mode) {
		isApplyingConfig = true;
		try {
			for (let index = 0; index < STANDBY_CONFIGS.length; index++) {
				const standbyConfig = STANDBY_CONFIGS[index];
				const value = mode === 'Standalone' ? standaloneConfig[standbyConfig.key] : standbyConfig.pairedValue;
				if (value !== undefined && value !== null) {
					await setConfigValue(standbyConfig, value);
				}
			}
		} finally {
			isApplyingConfig = false;
		}
	}

	async function handleMessage(message) {
		const context = getRuntimeContext();
		if (message.Serial !== context.activeParentSerial) {
			dependencies.log.debug({ Message: 'Ignored standby sync from a non-active Parent Room Device', SendingParentSerial: message.Serial, ActiveParentSerial: context.activeParentSerial });
			return;
		}

		const state = message.Payload && message.Payload.State;
		if (pendingSyncTimer) {
			await scheduleSync(state);
			return;
		}
		await applyImmediateSync(state);
	}

	async function scheduleSelectedParentSync(parentDevice) {
		try {
			const state = await dependencies.deviceComms.parentStandbyStateRequest(dependencies.xapi, parentDevice, dependencies.httpClientConfig);
			await scheduleSync(state);
			dependencies.log.info({ Message: 'Selected Parent Room Device standby state fetched', Host: parentDevice.host, State: state });
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to fetch selected Parent Room Device standby state', Host: parentDevice.host, Error: error.code || error.message || 'Unknown Parent Room Device standby state error', ErrorContext: error.Context || {} });
		}
	}

	async function applyImmediateSync(state) {
		if (state === 'EnteringStandby') {
			dependencies.log.debug({ Message: 'Ignored Parent Room Device standby transition state', State: state });
			return;
		}
		if (isBypassActive()) {
			dependencies.log.debug({ Message: 'Ignored Parent Room Device standby sync while bypass is active', State: state, BypassUntil: new Date(bypassUntil).toISOString() });
			return;
		}
		await applySyncState(state);
	}

	async function scheduleSync(state) {
		if (state === 'EnteringStandby') {
			dependencies.log.debug({ Message: 'Ignored Parent Room Device standby transition state', State: state });
			return;
		}
		if (isBypassActive()) {
			dependencies.log.debug({ Message: 'Ignored Parent Room Device standby sync while bypass is active', State: state, BypassUntil: new Date(bypassUntil).toISOString() });
			return;
		}

		pendingSyncState = state;
		if (!pendingSyncTimer) {
			pendingSyncDeadline = Date.now() + policy.applyDelayMs;
			promptDismissed = false;
			pendingSyncTimer = setTimeout(() => {
				applyPendingSync().catch(error => {
					dependencies.utils.softError({ Context: 'Failed to apply pending standby sync', State: pendingSyncState, Error: error });
				});
			}, policy.applyDelayMs);
		}
		await refreshPrompt();
	}

	async function applyPendingSync() {
		const state = pendingSyncState;
		clearSyncTimers();
		await applySyncState(state);
	}

	async function applySyncState(state) {
		switch (state) {
			case 'Off':
				await dependencies.xapi.Command.Standby.Deactivate();
				break;
			case 'Standby':
				await dependencies.xapi.Command.Standby.Activate();
				break;
			case 'Halfwake':
				await dependencies.xapi.Command.Standby.Halfwake();
				break;
			case 'EnteringStandby':
				dependencies.log.debug({ Message: 'Ignored Parent Room Device standby transition state', State: state });
				break;
			default:
				dependencies.log.debug({ Message: 'Unknown Parent Room Device standby state ignored', State: state });
		}
	}

	async function handlePromptResponse(event) {
		if (!event || event.FeedbackId !== STANDBY_SYNC_PROMPT_ID) {
			return false;
		}

		switch (String(event.OptionId || event.Option || '')) {
			case '1':
				await activateBypass(policy.shortBypassMs);
				break;
			case '2':
				await activateBypass(policy.longBypassMs);
				break;
			case '3':
				promptDismissed = true;
				clearPromptRefreshTimer();
				await dependencies.companionUi.clearPrompt(dependencies.xapi, STANDBY_SYNC_PROMPT_ID);
				break;
		}
		return true;
	}

	async function refreshPrompt() {
		if (promptDismissed || !pendingSyncState) {
			return;
		}

		const remainingSeconds = Math.max(0, Math.ceil((pendingSyncDeadline - Date.now()) / 1000));
		await dependencies.companionUi.showStandbySyncPrompt(dependencies.xapi, {
			feedbackId: STANDBY_SYNC_PROMPT_ID,
			state: pendingSyncState,
			remainingSeconds: remainingSeconds
		});

		clearPromptRefreshTimer();
		if (remainingSeconds > 0) {
			pendingPromptRefreshTimer = setTimeout(() => {
				refreshPrompt().catch(error => {
					dependencies.utils.softError({ Context: 'Failed to refresh standby sync prompt', Error: error });
				});
			}, policy.promptRefreshMs);
		}
	}

	async function activateBypass(durationMs) {
		bypassUntil = Date.now() + durationMs;
		clearSyncTimers();
		clearBypassTimer();
		bypassTimer = setTimeout(() => {
			bypassUntil = 0;
			notifyInfoChanged().catch(error => {
				dependencies.utils.softError({ Context: 'Failed to clear expired standby bypass widget info', Error: error });
			});
		}, durationMs);
		await notifyInfoChanged();
		dependencies.log.info({ Message: 'Standby sync bypass activated', BypassUntil: new Date(bypassUntil).toISOString() });
	}

	function clear() {
		clearSyncTimers();
		clearBypassTimer();
		bypassUntil = 0;
	}

	function clearSyncTimers() {
		if (pendingSyncTimer) {
			clearTimeout(pendingSyncTimer);
		}
		clearPromptRefreshTimer();
		pendingSyncTimer = null;
		pendingSyncDeadline = 0;
		pendingSyncState = '';
		promptDismissed = false;
		dependencies.companionUi.clearPrompt(dependencies.xapi, STANDBY_SYNC_PROMPT_ID).catch(error => {
			dependencies.utils.softError({ Context: 'Failed to clear standby sync prompt', Error: error });
		});
	}

	function clearPromptRefreshTimer() {
		if (pendingPromptRefreshTimer) {
			clearTimeout(pendingPromptRefreshTimer);
		}
		pendingPromptRefreshTimer = null;
	}

	function clearBypassTimer() {
		if (bypassTimer) {
			clearTimeout(bypassTimer);
		}
		bypassTimer = null;
	}

	function isBypassActive() {
		if (!bypassUntil) {
			return false;
		}
		if (Date.now() < bypassUntil) {
			return true;
		}
		bypassUntil = 0;
		clearBypassTimer();
		return false;
	}

	function getInfoText() {
		if (!isBypassActive()) {
			return '';
		}
		return `Standby sync bypass until ${formatTime(new Date(bypassUntil))}`;
	}

	async function getConfigValue(configItem) {
		const node = getConfigNode(configItem.path);
		if (!node || typeof node.get !== 'function') {
			dependencies.log.debug({ Message: 'UI feature config get unavailable', Feature: configItem.key, Path: configItem.path.join('.') });
			return null;
		}
		try {
			return await node.get();
		} catch (error) {
			dependencies.log.debug({ Message: 'UI feature config get failed', Feature: configItem.key, Path: configItem.path.join('.'), Error: error.message || error.code || 'Unknown get error' });
			return null;
		}
	}

	async function setConfigValue(configItem, value) {
		const node = getConfigNode(configItem.path);
		if (!node || typeof node.set !== 'function') {
			dependencies.log.debug({ Message: 'UI feature config set unavailable', Feature: configItem.key, Path: configItem.path.join('.') });
			return;
		}
		try {
			await node.set(value);
		} catch (error) {
			dependencies.log.warn({ Message: 'UI feature config set failed', Feature: configItem.key, Path: configItem.path.join('.'), Value: value, Error: error.message || error.code || 'Unknown set error' });
		}
	}

	function getConfigNode(path) {
		let node = dependencies.xapi.Config;
		for (let index = 0; index < path.length; index++) {
			if (!node || node[path[index]] === undefined) {
				return null;
			}
			node = node[path[index]];
		}
		return node;
	}

	function normalizeConfigEventValue(value) {
		return value && typeof value === 'object' && value.Value !== undefined ? value.Value : value;
	}

	function formatTime(date) {
		const hours = date.getHours();
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const suffix = hours >= 12 ? 'PM' : 'AM';
		const displayHours = hours % 12 || 12;
		return `${displayHours}:${minutes} ${suffix}`;
	}

	function getRuntimeContext() {
		return callbacks.getRuntimeContext ? callbacks.getRuntimeContext() : {};
	}

	async function notifyInfoChanged() {
		if (callbacks.onInfoChanged) {
			await callbacks.onInfoChanged(getInfoText());
		}
	}

	return {
		setStandaloneConfig,
		initializeConfig,
		applyMode,
		handleMessage,
		scheduleSelectedParentSync,
		handlePromptResponse,
		clear,
		getInfoText
	};
}

const standbyCoordination = {
	create: createStandbyCoordination
};

export { standbyCoordination };
