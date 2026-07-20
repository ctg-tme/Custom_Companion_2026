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
 * Description:             Paired Environment policy controller for the Custom Companion Solution.
 *                          Owns call-feature policy, Companion Web Widget mode, paired microphone
 *                          and volume enforcement, and safe StandAlone volume restoration.
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
 * Paired Environment xAPI surface:
 * - Subscriptions: Config.UserInterface.Features.* paths listed in PAIRED_UI_FEATURE_POLICY,
 *   Config.UserInterface.Theme.Name, Status.Audio.Microphones.Mute, Status.Audio.Volume.
 * - Initial reads: the same UI feature paths, Config.UserInterface.Theme.Name,
 *   Status.Audio.Microphones.Mute, and Status.Audio.Volume.
 * - Conditional read: Config.Audio.DefaultVolume only when safe restoration is requested.
 * - Commands: Command.Audio.Microphones.Mute, Command.Audio.Volume.Set,
 *   Command.UserInterface.Message.Prompt.Display, and Command.UserInterface.Message.Alert.Display.
 * - Companion Web Widget panel commands remain encapsulated by Custom-Campanion_4_UI_2026.
 */

const PAIRED_UI_FEATURE_POLICY = [
	{ key: 'aiNotes', path: ['UserInterface', 'Features', 'Call', 'AINotes'], pairedValue: 'Hidden' },
	{ key: 'audioMute', path: ['UserInterface', 'Features', 'Call', 'AudioMute'], pairedValue: 'Hidden' },
	{ key: 'cameraControls', path: ['UserInterface', 'Features', 'Call', 'CameraControls'], pairedValue: 'Hidden' },
	{ key: 'callEnd', path: ['UserInterface', 'Features', 'Call', 'End'], pairedValue: 'Hidden' },
	{ key: 'hdmiPassthrough', path: ['UserInterface', 'Features', 'Call', 'HdmiPassthrough'], pairedValue: 'Hidden' },
	{ key: 'googleMeet', path: ['UserInterface', 'Features', 'Call', 'JoinGoogleMeet'], pairedValue: 'Hidden' },
	{ key: 'microsoftTeamsCvi', path: ['UserInterface', 'Features', 'Call', 'JoinMicrosoftTeamsCVI'], pairedValue: 'Hidden' },
	{ key: 'microsoftTeamsDirectGuestJoin', path: ['UserInterface', 'Features', 'Call', 'JoinMicrosoftTeamsDirectGuestJoin'], pairedValue: 'Hidden' },
	{ key: 'webex', path: ['UserInterface', 'Features', 'Call', 'JoinWebex'], pairedValue: 'Hidden' },
	{ key: 'zoom', path: ['UserInterface', 'Features', 'Call', 'JoinZoom'], pairedValue: 'Hidden' },
	{ key: 'keypad', path: ['UserInterface', 'Features', 'Call', 'Keypad'], pairedValue: 'Hidden' },
	{ key: 'layoutControls', path: ['UserInterface', 'Features', 'Call', 'LayoutControls'], pairedValue: 'Hidden' },
	{ key: 'midCallControls', path: ['UserInterface', 'Features', 'Call', 'MidCallControls'], pairedValue: 'Hidden' },
	{ key: 'musicMode', path: ['UserInterface', 'Features', 'Call', 'MusicMode'], pairedValue: 'Hidden' },
	{ key: 'participantList', path: ['UserInterface', 'Features', 'Call', 'ParticipantList'], pairedValue: 'Auto' },
	{ key: 'selfviewControls', path: ['UserInterface', 'Features', 'Call', 'SelfviewControls'], pairedValue: 'Hidden' },
	{ key: 'simultaneousInterpretation', path: ['UserInterface', 'Features', 'Call', 'SimultaneousInterpretation'], pairedValue: 'Hidden' },
	{ key: 'call', path: ['UserInterface', 'Features', 'Call', 'Start'], pairedValue: 'Hidden' },
	{ key: 'videoMute', path: ['UserInterface', 'Features', 'Call', 'VideoMute'], pairedValue: 'Auto' },
	{ key: 'webcam', path: ['UserInterface', 'Features', 'Call', 'Webcam'], pairedValue: 'Hidden' },
	{ key: 'share', path: ['UserInterface', 'Features', 'Share', 'Start'], pairedValue: 'Hidden' },
	{ key: 'whiteboard', path: ['UserInterface', 'Features', 'Whiteboard', 'Start'], pairedValue: 'Auto' },
	{ key: 'scanToPair', path: ['BYOD', 'QRCodePairing'], pairedValue: 'Disabled' }
];

const RESTORE_VOLUME_PROMPT_ID = 'cc26_restore_volume';

function createPairedEnvironment(options) {
	const dependencies = options || {};
	const callbacks = dependencies.callbacks || {};
	const policy = dependencies.policy || {};
	let standaloneUiFeatureConfig = {};
	let userInterfaceThemeName = 'EveningFjord';
	let isApplyingUiFeatureConfig = false;
	let isEnforcingMicrophoneMute = false;
	let isEnforcingVolume = false;
	let isVolumeRestorePromptActive = false;

	function setStandaloneUiFeatureConfig(value) {
		standaloneUiFeatureConfig = value || {};
	}

	async function initializeUiFeatureMode() {
		userInterfaceThemeName = await getUserInterfaceThemeName();
		standaloneUiFeatureConfig = await ensureStandaloneUiFeatureConfig();
		registerStandaloneUiFeatureSubscriptions();
		registerUserInterfaceThemeSubscription();
	}

	function registerMediaHandlers() {
		const xapi = dependencies.xapi;
		if (!xapi.Status.Audio || !xapi.Status.Audio.Microphones || !xapi.Status.Audio.Microphones.Mute || typeof xapi.Status.Audio.Microphones.Mute.on !== 'function') {
			dependencies.utils.hardError({
				Code: 'CC26-MEDIA-MICROPHONE-SUBSCRIPTION',
				Component: 'PairedEnvironment',
				Context: 'Status.Audio.Microphones.Mute subscription is unavailable',
				Remediation: 'Verify the RoomOS xAPI path and supported device software, then restart the Macro Runtime.'
			});
		}
		if (!xapi.Status.Audio.Volume || typeof xapi.Status.Audio.Volume.on !== 'function') {
			dependencies.utils.hardError({
				Code: 'CC26-MEDIA-VOLUME-SUBSCRIPTION',
				Component: 'PairedEnvironment',
				Context: 'Status.Audio.Volume subscription is unavailable',
				Remediation: 'Verify the RoomOS xAPI path and supported device software, then restart the Macro Runtime.'
			});
		}

		xapi.Status.Audio.Microphones.Mute.on(value => {
			handleMicrophoneMuteState(value).catch(error => {
				dependencies.utils.softError({ Context: 'Failed to handle microphone mute state', Error: error });
			});
		});
		xapi.Status.Audio.Volume.on(value => {
			handleAudioVolumeState(value).catch(error => {
				dependencies.utils.softError({ Context: 'Failed to handle audio volume state', Error: error });
			});
		});
	}

	async function enforceInitialMediaState() {
		let context = getRuntimeContext();
		if (context.mode !== 'Paired' || context.isUnhealthy) {
			return;
		}

		try {
			await handleMicrophoneMuteState(await dependencies.xapi.Status.Audio.Microphones.Mute.get());
		} catch (error) {
			await reportRequiredMediaFailure('CC26-MEDIA-MICROPHONE-READ', 'Failed to read Status.Audio.Microphones.Mute while entering Paired', error);
			return;
		}

		context = getRuntimeContext();
		if (context.isUnhealthy) {
			return;
		}

		try {
			await handleAudioVolumeState(await dependencies.xapi.Status.Audio.Volume.get());
		} catch (error) {
			await reportRequiredMediaFailure('CC26-MEDIA-VOLUME-READ', 'Failed to read Status.Audio.Volume while entering Paired', error);
		}
	}

	async function handleMicrophoneMuteState(value) {
		const context = getRuntimeContext();
		if (context.mode !== 'Paired' || context.isUnhealthy || isEnforcingMicrophoneMute) {
			return;
		}
		if (String(getXapiValue(value) || '').toLowerCase() === 'on') {
			return;
		}

		isEnforcingMicrophoneMute = true;
		try {
			await dependencies.xapi.Command.Audio.Microphones.Mute();
			dependencies.log.info({ Message: 'Paired microphone mute enforced' });
		} catch (error) {
			await reportRequiredMediaFailure('CC26-MEDIA-MICROPHONE-ENFORCE', 'Failed to enforce Command.Audio.Microphones.Mute while Paired', error);
		} finally {
			isEnforcingMicrophoneMute = false;
		}
	}

	async function handleAudioVolumeState(value) {
		const context = getRuntimeContext();
		if (context.mode !== 'Paired' || context.isUnhealthy || isEnforcingVolume) {
			return;
		}
		const currentVolume = Number(getXapiValue(value));
		if (!Number.isFinite(currentVolume)) {
			await reportRequiredMediaFailure('CC26-MEDIA-VOLUME-READ', 'Status.Audio.Volume did not return a numeric level while Paired', new Error('Audio volume was not numeric'));
			return;
		}
		if (currentVolume === policy.requiredVolumeLevel) {
			return;
		}

		isEnforcingVolume = true;
		try {
			await dependencies.xapi.Command.Audio.Volume.Set({ Level: policy.requiredVolumeLevel });
			dependencies.log.info({ Message: 'Paired audio volume enforced', Level: policy.requiredVolumeLevel });
		} catch (error) {
			await reportRequiredMediaFailure('CC26-MEDIA-VOLUME-ENFORCE', 'Failed to enforce Command.Audio.Volume.Set while Paired', error);
		} finally {
			isEnforcingVolume = false;
		}
	}

	async function applyUiFeatureMode(mode) {
		isApplyingUiFeatureConfig = true;
		try {
			for (let index = 0; index < PAIRED_UI_FEATURE_POLICY.length; index++) {
				const feature = PAIRED_UI_FEATURE_POLICY[index];
				let value = mode === 'StandAlone' ? standaloneUiFeatureConfig[feature.key] : feature.pairedValue;
				const context = getRuntimeContext();
				if (mode === 'Paired' && feature.key === 'callEnd' && context.callEndOverride) {
					value = context.callEndOverride;
				}

				if (value !== undefined && value !== null) {
					await setUiFeatureConfigValue(feature, value);
				}
			}
			await applyRuntimeWebWidget(mode);
		} finally {
			isApplyingUiFeatureConfig = false;
		}
	}

	async function applyRuntimeWebWidget(mode) {
		const context = getRuntimeContext();
		const activeMode = mode || context.mode;
		if (!shouldManageWebWidget()) {
			return;
		}

		const webWidgetConfig = dependencies.userInterfaceConfig.WebWidget || {};
		const companionWidgetConfig = webWidgetConfig.CompanionWidget || {};
		const standaloneWebWidget = getStandaloneWebWidget();
		const shouldRestoreExistingWebWidget = !!(companionWidgetConfig.restoreStandaloneExisting && activeMode === 'StandAlone' && standaloneWebWidget && standaloneWebWidget.url);
		const url = shouldRestoreExistingWebWidget ? standaloneWebWidget.url : dependencies.companionUi.buildCompanionWebWidgetUrl({
			mode: activeMode,
			roomName: context.activeParentName,
			themeName: userInterfaceThemeName,
			urlOverride: webWidgetConfig.urlOverride,
			runtimeInfo3: context.runtimeInfo3,
			webWidgetConfig: companionWidgetConfig
		});

		try {
			dependencies.log.info({ Message: 'Companion Web Widget URL computed', Mode: activeMode, RestoreExistingWebWidget: !!shouldRestoreExistingWebWidget, UrlOverrideUsed: !!webWidgetConfig.urlOverride, Url: url });
			if (shouldRestoreExistingWebWidget) {
				await dependencies.companionUi.removeCompanionWebWidget(dependencies.xapi);
				await dependencies.companionUi.saveWebWidget(dependencies.xapi, standaloneWebWidget);
			} else {
				await dependencies.companionUi.saveCompanionWebWidget(dependencies.xapi, url);
			}
			dependencies.log.info({ Message: 'Companion Web Widget mode applied', Mode: activeMode, RestoredStandaloneWidget: !!shouldRestoreExistingWebWidget, UrlLength: url.length });
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to apply Companion Web Widget mode', Mode: activeMode, Error: error.message || error.code || 'Unknown Web Widget error' });
		}
	}

	async function clearRestorePrompt() {
		isVolumeRestorePromptActive = false;
		await dependencies.companionUi.clearPrompt(dependencies.xapi, RESTORE_VOLUME_PROMPT_ID);
	}

	async function handlePromptResponse(event) {
		if (!event || event.FeedbackId !== RESTORE_VOLUME_PROMPT_ID) {
			return false;
		}

		const context = getRuntimeContext();
		if (!isVolumeRestorePromptActive || context.mode !== 'StandAlone') {
			return true;
		}

		isVolumeRestorePromptActive = false;
		const option = String(event.OptionId || event.Option || '');
		if (option !== '1') {
			dependencies.log.info({ Message: 'StandAlone volume restoration declined or dismissed; volume left unchanged', Option: option || 'Dismissed' });
			return true;
		}

		await restoreDefaultVolumeAndNotify();
		return true;
	}

	async function handleStandaloneRelease(hadActiveCall) {
		if (hadActiveCall) {
			await showRestoreVolumePrompt();
			return;
		}
		await restoreDefaultVolumeAndNotify();
	}

	async function showRestoreVolumePrompt() {
		try {
			await dependencies.xapi.Command.UserInterface.Message.Prompt.Display({
				Title: 'Restore Volume?',
				Text: 'This board is now running Stand Alone while a call is active. Restore the device default volume?',
				FeedbackId: RESTORE_VOLUME_PROMPT_ID,
				'Option.1': 'Restore Volume',
				'Option.2': 'Keep Current',
				'Option.3': 'Dismiss',
				Duration: 30
			});
			isVolumeRestorePromptActive = true;
		} catch (error) {
			isVolumeRestorePromptActive = false;
			dependencies.log.error({
				Code: 'CC26-VOLUME-RESTORE-PROMPT',
				Component: 'PairedEnvironment',
				Context: 'Failed to display the StandAlone volume restoration prompt',
				Remediation: 'Volume was left unchanged. Diagnose UserInterface.Message.Prompt if the user needs this choice.',
				Error: error
			});
		}
	}

	async function restoreDefaultVolumeAndNotify() {
		let defaultVolume;
		try {
			defaultVolume = Number(getXapiValue(await dependencies.xapi.Config.Audio.DefaultVolume.get()));
			if (!Number.isFinite(defaultVolume)) {
				throw new Error('Audio DefaultVolume was not numeric');
			}
			await dependencies.xapi.Command.Audio.Volume.Set({ Level: defaultVolume });
			dependencies.log.info({ Message: 'StandAlone default volume restored', Level: defaultVolume, MicrophonesRemainMuted: true });
		} catch (error) {
			dependencies.log.error({
				Code: 'CC26-VOLUME-RESTORE',
				Component: 'PairedEnvironment',
				Context: 'Failed to restore Audio.DefaultVolume after entering StandAlone',
				Remediation: 'Volume was left unchanged. Diagnose Config.Audio.DefaultVolume and Command.Audio.Volume.Set.',
				Error: error
			});
			return;
		}

		try {
			await dependencies.xapi.Command.UserInterface.Message.Alert.Display({
				Title: 'Companion Released',
				Text: 'Volume was restored to the device default. Microphones remain muted; unmute when ready.',
				Duration: 10
			});
		} catch (error) {
			dependencies.log.warn({
				Code: 'CC26-MICROPHONE-MUTE-NOTICE',
				Component: 'PairedEnvironment',
				Context: 'Default volume was restored, but the microphone mute reminder could not be displayed',
				Error: error
			});
		}
	}

	async function ensureStandaloneUiFeatureConfig() {
		let hasUpdates = false;

		for (let index = 0; index < PAIRED_UI_FEATURE_POLICY.length; index++) {
			const feature = PAIRED_UI_FEATURE_POLICY[index];
			if (standaloneUiFeatureConfig[feature.key] !== undefined) {
				continue;
			}
			const currentValue = await getUiFeatureConfigValue(feature);
			if (currentValue !== null) {
				standaloneUiFeatureConfig[feature.key] = currentValue;
				hasUpdates = true;
			}
		}

		if (shouldManageWebWidget() && !shouldRestoreStandaloneWebWidget() && (standaloneUiFeatureConfig.webWidget !== undefined || standaloneUiFeatureConfig.webWidgetUrl !== undefined)) {
			delete standaloneUiFeatureConfig.webWidget;
			delete standaloneUiFeatureConfig.webWidgetUrl;
			hasUpdates = true;
			dependencies.log.info({ Message: 'Removed stale standalone Web Widget restore memory because restoreStandaloneExisting is disabled' });
		}

		const context = getRuntimeContext();
		if (shouldManageWebWidget() && shouldRestoreStandaloneWebWidget() && context.mode === 'StandAlone' && standaloneUiFeatureConfig.webWidgetUrl === undefined) {
			try {
				const currentWebWidget = await dependencies.companionUi.getCurrentWebWidget(dependencies.xapi);
				standaloneUiFeatureConfig.webWidget = currentWebWidget && !dependencies.companionUi.isCompanionWebWidget(currentWebWidget) ? currentWebWidget : null;
				standaloneUiFeatureConfig.webWidgetUrl = standaloneUiFeatureConfig.webWidget ? standaloneUiFeatureConfig.webWidget.url : '';
				hasUpdates = true;
			} catch (error) {
				dependencies.log.warn({ Message: 'Failed to save original standalone Web Widget URL', Error: error.message || error.code || 'Unknown Web Widget status error' });
			}
		}

		if (hasUpdates) {
			await dependencies.mem.write(dependencies.storageKey, standaloneUiFeatureConfig);
		}
		return standaloneUiFeatureConfig;
	}

	function registerStandaloneUiFeatureSubscriptions() {
		for (let index = 0; index < PAIRED_UI_FEATURE_POLICY.length; index++) {
			const feature = PAIRED_UI_FEATURE_POLICY[index];
			const node = getXapiConfigNode(feature.path);
			if (!node || typeof node.on !== 'function') {
				dependencies.log.debug({ Message: 'UI feature config subscription unavailable', Feature: feature.key, Path: feature.path.join('.') });
				continue;
			}

			node.on(value => {
				handleStandaloneUiFeatureChange(feature, normalizeConfigEventValue(value)).catch(error => {
					dependencies.utils.softError({ Context: 'Failed to save standalone UI feature config change', Feature: feature.key, Error: error });
				});
			});
		}
	}

	async function handleStandaloneUiFeatureChange(feature, value) {
		const context = getRuntimeContext();
		if (isApplyingUiFeatureConfig || context.mode !== 'StandAlone' || value === undefined || value === null) {
			return;
		}
		standaloneUiFeatureConfig[feature.key] = value;
		await dependencies.mem.write(dependencies.storageKey, standaloneUiFeatureConfig);
		dependencies.log.info({ Message: 'Saved standalone UI feature preference', Feature: feature.key, Value: value });
	}

	async function getUserInterfaceThemeName() {
		try {
			return await dependencies.xapi.Config.UserInterface.Theme.Name.get();
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to fetch UserInterface Theme Name', Error: error.message || error.code || 'Unknown theme get error' });
			return 'EveningFjord';
		}
	}

	function registerUserInterfaceThemeSubscription() {
		const node = getXapiConfigNode(['UserInterface', 'Theme', 'Name']);
		if (!node || typeof node.on !== 'function') {
			dependencies.log.debug({ Message: 'UserInterface Theme Name subscription unavailable' });
			return;
		}

		node.on(value => {
			handleUserInterfaceThemeChange(normalizeConfigEventValue(value)).catch(error => {
				dependencies.utils.softError({ Context: 'Failed to apply UserInterface theme change', Error: error });
			});
		});
	}

	async function handleUserInterfaceThemeChange(value) {
		userInterfaceThemeName = value || 'EveningFjord';
		await applyRuntimeWebWidget();
		dependencies.log.info({ Message: 'Applied Companion Web Widget theme update', Theme: userInterfaceThemeName });
	}

	async function getUiFeatureConfigValue(feature) {
		const node = getXapiConfigNode(feature.path);
		if (!node || typeof node.get !== 'function') {
			dependencies.log.debug({ Message: 'UI feature config get unavailable', Feature: feature.key, Path: feature.path.join('.') });
			return null;
		}
		try {
			return await node.get();
		} catch (error) {
			dependencies.log.debug({ Message: 'UI feature config get failed', Feature: feature.key, Path: feature.path.join('.'), Error: error.message || error.code || 'Unknown get error' });
			return null;
		}
	}

	async function setUiFeatureConfigValue(feature, value) {
		const node = getXapiConfigNode(feature.path);
		if (!node || typeof node.set !== 'function') {
			dependencies.log.debug({ Message: 'UI feature config set unavailable', Feature: feature.key, Path: feature.path.join('.') });
			return;
		}
		try {
			await node.set(value);
		} catch (error) {
			dependencies.log.warn({ Message: 'UI feature config set failed', Feature: feature.key, Path: feature.path.join('.'), Value: value, Error: error.message || error.code || 'Unknown set error' });
		}
	}

	function getXapiConfigNode(path) {
		let node = dependencies.xapi.Config;
		for (let index = 0; index < path.length; index++) {
			if (!node || node[path[index]] === undefined) {
				return null;
			}
			node = node[path[index]];
		}
		return node;
	}

	function shouldManageWebWidget() {
		const config = dependencies.userInterfaceConfig;
		return !!(config && config.WebWidget && config.WebWidget.CompanionWidget && config.WebWidget.CompanionWidget.enabled);
	}

	function shouldRestoreStandaloneWebWidget() {
		const config = dependencies.userInterfaceConfig;
		return !!(config && config.WebWidget && config.WebWidget.CompanionWidget && config.WebWidget.CompanionWidget.restoreStandaloneExisting);
	}

	function getStandaloneWebWidget() {
		if (standaloneUiFeatureConfig.webWidget && standaloneUiFeatureConfig.webWidget.url) {
			return standaloneUiFeatureConfig.webWidget;
		}
		if (standaloneUiFeatureConfig.webWidgetUrl) {
			return {
				url: standaloneUiFeatureConfig.webWidgetUrl,
				name: 'Web Widget',
				panelId: 'cc26OriginalWebWidget',
				refreshInterval: 0
			};
		}
		return null;
	}

	function normalizeConfigEventValue(value) {
		return value && typeof value === 'object' && value.Value !== undefined ? value.Value : value;
	}

	function getXapiValue(value) {
		if (value && typeof value === 'object' && value.Value !== undefined) {
			return value.Value;
		}
		return value;
	}

	function getRuntimeContext() {
		return callbacks.getRuntimeContext ? callbacks.getRuntimeContext() : {};
	}

	async function reportRequiredMediaFailure(code, context, error) {
		if (callbacks.onRequiredMediaFailure) {
			await callbacks.onRequiredMediaFailure(code, context, error);
		}
	}

	return {
		setStandaloneUiFeatureConfig,
		initializeUiFeatureMode,
		registerMediaHandlers,
		enforceInitialMediaState,
		applyUiFeatureMode,
		applyRuntimeWebWidget,
		clearRestorePrompt,
		handlePromptResponse,
		handleStandaloneRelease
	};
}

const pairedEnvironment = {
	create: createPairedEnvironment
};

export { pairedEnvironment };
