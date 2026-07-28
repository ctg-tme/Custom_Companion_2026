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
 * Revised:                 July 28, 2026
 * Version:                 0.1.0.10
 *
 * Description:             Paired Environment Policy controller for the Custom Companion solution.
 *                          Owns reversible local configuration policy, Companion Web Widget mode,
 *                          Paired microphone/volume/Do Not Disturb enforcement, and safe
 *                          Standalone restoration.
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
 * Paired Environment xAPI surface:
 * - Subscriptions: Config paths listed in PAIRED_UI_FEATURE_POLICY and
 *   PAIRED_ENVIRONMENT_CONFIG_POLICY, Config.Video.Input.Connector,
 *   Config.UserInterface.Theme.Name, Status.Proximity.Services.Availability,
 *   Status.Audio.Microphones.Mute, Status.Audio.Volume, and
 *   Event.UserInterface.Extensions.Widget.LayoutUpdated.
 * - Initial reads: the same configuration paths, Config.Provisioning.Mode,
 *   Config.Video.Input.Connector, Config.UserInterface.Theme.Name,
 *   Status.Proximity.Services.Availability, Status.Audio.Microphones.Mute,
 *   and Status.Audio.Volume.
 * - Conditional read: Config.Audio.DefaultVolume only when safe restoration is requested.
 * - Commands: Command.Audio.Microphones.Mute, Command.Audio.Volume.Set,
 *   Command.Conference.DoNotDisturb.Activate/Deactivate,
 *   Command.Proximity.Services.Activate/Deactivate,
 *   and Command.UserInterface.Message.Prompt.Display.
 * - Companion alerts and Web Widget panel commands remain encapsulated by
 *   Custom-Campanion_4_UI_2026.
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

const PAIRED_ENVIRONMENT_CONFIG_POLICY = [
	{ key: 'muteWarning', path: ['UserInterface', 'MuteWarning'], pairedValue: 'Disabled' },
	{ key: 'webexProximityMode', path: ['Webex', 'Proximity', 'Mode'], pairedValue: 'Off', registration: 'Cloud' },
	{ key: 'proximityMode', path: ['Proximity', 'Mode'], pairedValue: 'Off', registration: 'OnPremises' },
	{ key: 'airPlayMode', path: ['Video', 'Input', 'AirPlay', 'Mode'], pairedValue: 'Off' },
	{ key: 'miracastMode', path: ['Video', 'Input', 'Miracast', 'Mode'], pairedValue: 'Off' }
];

const RESTORE_VOLUME_PROMPT_ID = 'cc26_restore_volume';
const STANDALONE_VOLUME_RESTORED_ALERT_OWNER = 'paired-environment:standalone-volume-restored';

function createPairedEnvironment(options) {
	const dependencies = options || {};
	const callbacks = dependencies.callbacks || {};
	const policy = dependencies.policy || {};
	let standaloneUiFeatureConfig = {};
	let standaloneEnvironmentConfig = normalizeStandaloneEnvironmentConfig({});
	let userInterfaceThemeName = 'EveningFjord';
	let isApplyingUiFeatureConfig = false;
	let isApplyingEnvironmentConfig = false;
	let isEnforcingMicrophoneMute = false;
	let isEnforcingVolume = false;
	let isVolumeRestorePromptActive = false;
	let dndRefreshTimer = null;
	const subscribedConnectorIds = {};

	function setStandaloneUiFeatureConfig(value) {
		standaloneUiFeatureConfig = value || {};
	}

	function setStandaloneEnvironmentConfig(value) {
		standaloneEnvironmentConfig = normalizeStandaloneEnvironmentConfig(value);
	}

	async function initializeUiFeatureMode() {
		userInterfaceThemeName = await getUserInterfaceThemeName();
		if (getRuntimeContext().mode === 'Standalone') {
			await captureStandaloneConfig();
		}
		registerStandaloneUiFeatureSubscriptions();
		await registerStandaloneEnvironmentSubscriptions();
		registerStandaloneWebWidgetSubscription();
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
			dependencies.log.debug({ Message: 'Paired microphone mute enforced' });
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
			dependencies.log.debug({ Message: 'Paired audio volume enforced', Level: policy.requiredVolumeLevel });
		} catch (error) {
			await reportRequiredMediaFailure('CC26-MEDIA-VOLUME-ENFORCE', 'Failed to enforce Command.Audio.Volume.Set while Paired', error);
		} finally {
			isEnforcingVolume = false;
		}
	}

	async function applyUiFeatureMode(mode) {
		await applyDoNotDisturbMode(mode);
		if (mode === 'Standalone') {
			await captureStandaloneConfig({ onlyMissing: true });
		}
		isApplyingUiFeatureConfig = true;
		try {
			const featureUpdates = [];
			for (let index = 0; index < PAIRED_UI_FEATURE_POLICY.length; index++) {
				const feature = PAIRED_UI_FEATURE_POLICY[index];
				let value = mode === 'Standalone' ? standaloneUiFeatureConfig[feature.key] : feature.pairedValue;
				const context = getRuntimeContext();
				if (mode === 'Paired' && feature.key === 'callEnd' && context.callEndOverride) {
					value = context.callEndOverride;
				}

				if (mode === 'Paired' && standaloneUiFeatureConfig[feature.key] === undefined) {
					dependencies.log.warn({
						Message: 'Paired UI feature enforcement deferred because no Standalone value is preserved',
						Feature: feature.key,
						Path: feature.path.join('.')
					});
					continue;
				}
				if (value !== undefined && value !== null) {
					featureUpdates.push(setUiFeatureConfigValue(feature, value));
				}
			}
			await Promise.all(featureUpdates);
			await applyEnvironmentConfigMode(mode);
			await applyRuntimeWebWidget(mode);
		} finally {
			isApplyingUiFeatureConfig = false;
		}
	}

	async function captureStandaloneConfig(options = {}) {
		if (getRuntimeContext().mode !== 'Standalone') {
			return false;
		}

		await captureStandaloneUiFeatureConfig(options);
		await captureStandaloneEnvironmentConfig(options);
		return true;
	}

	async function applyEnvironmentConfigMode(mode) {
		const registration = await getRegistrationKind();
		isApplyingEnvironmentConfig = true;
		try {
			const configUpdates = [];
			for (let index = 0; index < PAIRED_ENVIRONMENT_CONFIG_POLICY.length; index++) {
				const configItem = PAIRED_ENVIRONMENT_CONFIG_POLICY[index];
				if (!doesConfigPolicyApply(configItem, registration)) {
					continue;
				}

				const standaloneValue = standaloneEnvironmentConfig.configurations[configItem.key];
				if (standaloneValue === undefined) {
					if (mode === 'Paired') {
						dependencies.log.warn({
							Message: 'Paired environment configuration enforcement deferred because no Standalone value is preserved',
							Configuration: configItem.key,
							Path: configItem.path.join('.')
						});
					}
					continue;
				}

				const value = mode === 'Standalone' ? standaloneValue : configItem.pairedValue;
				configUpdates.push(setEnvironmentConfigValue(configItem, value));
			}
			await Promise.all(configUpdates);
			await applyVideoInputConnectorMode(mode);
			await applyProximityServicesMode(mode);
		} finally {
			isApplyingEnvironmentConfig = false;
		}
	}

	async function captureStandaloneEnvironmentConfig(options = {}) {
		if (getRuntimeContext().mode !== 'Standalone') {
			return standaloneEnvironmentConfig;
		}

		const onlyMissing = !!options.onlyMissing;
		const registration = await getRegistrationKind();
		let hasUpdates = false;

		for (let index = 0; index < PAIRED_ENVIRONMENT_CONFIG_POLICY.length; index++) {
			const configItem = PAIRED_ENVIRONMENT_CONFIG_POLICY[index];
			if (!doesConfigPolicyApply(configItem, registration)) {
				continue;
			}
			if (onlyMissing && hasOwn(standaloneEnvironmentConfig.configurations, configItem.key)) {
				continue;
			}

			const currentValue = await getEnvironmentConfigValue(configItem);
			if (currentValue !== null && standaloneEnvironmentConfig.configurations[configItem.key] !== currentValue) {
				standaloneEnvironmentConfig.configurations[configItem.key] = currentValue;
				hasUpdates = true;
			}
		}

		const connectors = await getVideoInputConnectors();
		for (let index = 0; index < connectors.length; index++) {
			const connector = connectors[index];
			const connectorId = getConnectorId(connector);
			const inputSourceType = getConnectorInputSourceType(connector);
			if (!connectorId || inputSourceType === null || inputSourceType === 'camera' || !hasConnectorPresentationSelection(connector, connectorId)) {
				continue;
			}
			if (onlyMissing && hasOwn(standaloneEnvironmentConfig.connectorPresentationSelection, connectorId)) {
				continue;
			}

			const currentValue = getConnectorPresentationSelection(connector);
			if (currentValue !== null && standaloneEnvironmentConfig.connectorPresentationSelection[connectorId] !== currentValue) {
				standaloneEnvironmentConfig.connectorPresentationSelection[connectorId] = currentValue;
				hasUpdates = true;
			}
		}

		if (!onlyMissing || standaloneEnvironmentConfig.proximityServicesAvailability === undefined) {
			const availability = await getProximityServicesAvailability();
			if (availability !== null && standaloneEnvironmentConfig.proximityServicesAvailability !== availability) {
				standaloneEnvironmentConfig.proximityServicesAvailability = availability;
				hasUpdates = true;
			}
		}

		if (hasUpdates) {
			await dependencies.mem.write(dependencies.environmentStorageKey, standaloneEnvironmentConfig);
			dependencies.log.debug({
				Message: 'Saved Standalone Paired Environment preferences',
				ConnectorCount: Object.keys(standaloneEnvironmentConfig.connectorPresentationSelection).length,
				Registration: registration || 'Unknown'
			});
		}
		return standaloneEnvironmentConfig;
	}

	async function applyVideoInputConnectorMode(mode) {
		const connectors = await getVideoInputConnectors();
		const updates = [];
		for (let index = 0; index < connectors.length; index++) {
			const connector = connectors[index];
			const connectorId = getConnectorId(connector);
			const inputSourceType = getConnectorInputSourceType(connector);
			if (!connectorId || inputSourceType === null || inputSourceType === 'camera' || !hasConnectorPresentationSelection(connector, connectorId)) {
				continue;
			}

			const standaloneValue = standaloneEnvironmentConfig.connectorPresentationSelection[connectorId];
			if (standaloneValue === undefined) {
				if (mode === 'Paired') {
					dependencies.log.warn({
						Message: 'Paired connector presentation policy deferred because no Standalone value is preserved',
						ConnectorId: connectorId
					});
				}
				continue;
			}

			const value = mode === 'Standalone' ? standaloneValue : 'Manual';
			const currentValue = getConnectorPresentationSelection(connector);
			if (String(currentValue).toLowerCase() === String(value).toLowerCase()) {
				continue;
			}
			updates.push(setConnectorPresentationSelection(connectorId, value));
		}
		await Promise.all(updates);
	}

	async function applyProximityServicesMode(mode) {
		const originalAvailability = standaloneEnvironmentConfig.proximityServicesAvailability;
		if (originalAvailability === undefined) {
			if (mode === 'Paired') {
				dependencies.log.warn({ Message: 'Paired proximity service deactivation deferred because no Standalone availability is preserved' });
			}
			return;
		}

		const services = dependencies.xapi.Command.Proximity && dependencies.xapi.Command.Proximity.Services;
		if (!services) {
			dependencies.log.debug({ Message: 'Proximity Services commands unavailable' });
			return;
		}

		if (mode === 'Paired') {
			if (typeof services.Deactivate !== 'function') {
				dependencies.log.debug({ Message: 'Proximity Services Deactivate command unavailable' });
				return;
			}
			try {
				await services.Deactivate();
				dependencies.log.debug({ Message: 'Paired proximity services deactivated' });
			} catch (error) {
				dependencies.log.warn({ Message: 'Failed to deactivate proximity services while Paired', Error: error.message || error.code || 'Unknown proximity service error' });
			}
			return;
		}

		if (String(originalAvailability).toLowerCase() !== 'available') {
			dependencies.log.debug({ Message: 'Standalone proximity services left inactive because they were not originally Available', OriginalAvailability: originalAvailability });
			return;
		}
		const currentAvailability = await getProximityServicesAvailability();
		if (String(currentAvailability).toLowerCase() === 'available') {
			dependencies.log.debug({ Message: 'Standalone proximity services already Available' });
			return;
		}
		if (typeof services.Activate !== 'function') {
			dependencies.log.debug({ Message: 'Proximity Services Activate command unavailable' });
			return;
		}
		try {
			await services.Activate();
			dependencies.log.debug({ Message: 'Standalone proximity services reactivated' });
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to reactivate proximity services for Standalone', Error: error.message || error.code || 'Unknown proximity service error' });
		}
	}

	async function applyDoNotDisturbMode(mode) {
		clearDndRefreshTimer();
		if (mode === 'Paired') {
			await activateDoNotDisturbLease();
			return;
		}

		try {
			await dependencies.xapi.Command.Conference.DoNotDisturb.Deactivate();
			dependencies.log.debug({ Message: 'Paired Do Not Disturb Lease released for Standalone' });
		} catch (error) {
			await reportRequiredMediaFailure('CC26-DND-DEACTIVATE', 'Failed to deactivate Command.Conference.DoNotDisturb while entering Standalone', error);
		}
	}

	async function activateDoNotDisturbLease() {
		const context = getRuntimeContext();
		if (context.mode !== 'Paired' || context.isUnhealthy) {
			return;
		}

		try {
			await dependencies.xapi.Command.Conference.DoNotDisturb.Activate({ Timeout: policy.dndTimeoutMinutes });
			dependencies.log.debug({ Message: 'Paired Do Not Disturb Lease activated', TimeoutMinutes: policy.dndTimeoutMinutes });
		} catch (error) {
			await reportRequiredMediaFailure('CC26-DND-ACTIVATE', 'Failed to activate Command.Conference.DoNotDisturb while Paired', error);
			return;
		}

		clearDndRefreshTimer();
		dndRefreshTimer = setTimeout(() => {
			dndRefreshTimer = null;
			activateDoNotDisturbLease().catch(error => {
				dependencies.utils.softError({ Context: 'Failed to renew Paired Do Not Disturb Lease', Error: error });
			});
		}, policy.dndRefreshMs);
	}

	function clearDndRefreshTimer() {
		if (dndRefreshTimer) {
			clearTimeout(dndRefreshTimer);
			dndRefreshTimer = null;
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
		const shouldRestoreExistingWebWidget = !!(companionWidgetConfig.restoreStandaloneExisting && activeMode === 'Standalone' && standaloneWebWidget && standaloneWebWidget.url);
		const url = shouldRestoreExistingWebWidget ? standaloneWebWidget.url : dependencies.companionUi.buildCompanionWebWidgetUrl({
			mode: activeMode,
			parentRoomDeviceName: context.activeParentName,
			themeName: userInterfaceThemeName,
			urlOverride: webWidgetConfig.urlOverride,
			runtimeInfo3: context.runtimeInfo3,
			preserveRuntimeInfo3: context.isUnhealthy,
			webWidgetConfig: companionWidgetConfig
		});

		try {
			dependencies.log.debug({ Message: 'Companion Web Widget URL computed', Mode: activeMode, RestoreExistingWebWidget: !!shouldRestoreExistingWebWidget, UrlOverrideUsed: !!webWidgetConfig.urlOverride, Url: url });
			if (shouldRestoreExistingWebWidget) {
				await dependencies.companionUi.replaceWebWidget(dependencies.xapi, standaloneWebWidget);
			} else {
				await dependencies.companionUi.replaceCompanionWebWidget(dependencies.xapi, url);
			}
			dependencies.log.debug({ Message: 'Companion Web Widget mode applied', Mode: activeMode, RestoredStandaloneWidget: !!shouldRestoreExistingWebWidget, UrlLength: url.length });
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to apply Companion Web Widget mode', Mode: activeMode, Error: error.message || error.code || 'Unknown Web Widget error' });
		}
	}

	async function clearRestorePrompt() {
		if (!isVolumeRestorePromptActive) {
			return;
		}
		isVolumeRestorePromptActive = false;
		await dependencies.companionUi.clearPrompt(dependencies.xapi, RESTORE_VOLUME_PROMPT_ID);
	}

	async function handlePromptResponse(event) {
		if (!event || event.FeedbackId !== RESTORE_VOLUME_PROMPT_ID) {
			return false;
		}

		const context = getRuntimeContext();
		if (!isVolumeRestorePromptActive || context.mode !== 'Standalone') {
			return true;
		}

		isVolumeRestorePromptActive = false;
		const option = String(event.OptionId || event.Option || '');
		if (option !== '1') {
			dependencies.log.info({ Message: 'Standalone volume restoration declined or dismissed; volume left unchanged', Option: option || 'Dismissed' });
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
				Text: 'This Companion Device is now running Standalone while a call is active. Restore its default volume?',
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
				Context: 'Failed to display the Standalone volume restoration prompt',
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
			dependencies.log.info({ Message: 'Standalone default volume restored', Level: defaultVolume, MicrophonesRemainMuted: true });
		} catch (error) {
			dependencies.log.error({
				Code: 'CC26-VOLUME-RESTORE',
				Component: 'PairedEnvironment',
				Context: 'Failed to restore Audio.DefaultVolume after entering Standalone',
				Remediation: 'Volume was left unchanged. Diagnose Config.Audio.DefaultVolume and Command.Audio.Volume.Set.',
				Error: error
			});
			return;
		}

		try {
			await dependencies.companionUi.showOwnedAlert(dependencies.xapi, {
				ownerId: STANDALONE_VOLUME_RESTORED_ALERT_OWNER,
				title: 'Standalone Volume Restored',
				text: 'Volume was restored to the Companion Device default. Microphones remain muted; unmute when ready.',
				duration: 10
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

	async function captureStandaloneUiFeatureConfig(options = {}) {
		if (getRuntimeContext().mode !== 'Standalone') {
			return standaloneUiFeatureConfig;
		}

		const onlyMissing = !!options.onlyMissing;
		let hasUpdates = false;

		for (let index = 0; index < PAIRED_UI_FEATURE_POLICY.length; index++) {
			const feature = PAIRED_UI_FEATURE_POLICY[index];
			if (onlyMissing && standaloneUiFeatureConfig[feature.key] !== undefined) {
				continue;
			}
			const currentValue = await getUiFeatureConfigValue(feature);
			if (currentValue !== null && standaloneUiFeatureConfig[feature.key] !== currentValue) {
				standaloneUiFeatureConfig[feature.key] = currentValue;
				hasUpdates = true;
			}
		}

		if (shouldManageWebWidget() && !shouldRestoreStandaloneWebWidget() && (standaloneUiFeatureConfig.webWidget !== undefined || standaloneUiFeatureConfig.webWidgetUrl !== undefined)) {
			delete standaloneUiFeatureConfig.webWidget;
			delete standaloneUiFeatureConfig.webWidgetUrl;
			hasUpdates = true;
			dependencies.log.info({ Message: 'Removed stale Standalone Web Widget restore memory because restoreStandaloneExisting is disabled' });
		}

		const context = getRuntimeContext();
		if (shouldManageWebWidget() && shouldRestoreStandaloneWebWidget() && context.mode === 'Standalone' && !getStandaloneWebWidget()) {
			if (standaloneUiFeatureConfig.webWidget !== undefined || standaloneUiFeatureConfig.webWidgetUrl !== undefined) {
				delete standaloneUiFeatureConfig.webWidget;
				delete standaloneUiFeatureConfig.webWidgetUrl;
				hasUpdates = true;
				dependencies.log.info({ Message: 'Removed invalid Standalone Web Widget restore memory so capture can retry' });
			}
			try {
				const currentWebWidget = await dependencies.companionUi.getCurrentWebWidget(dependencies.xapi);
				if (currentWebWidget && !dependencies.companionUi.isCompanionWebWidget(currentWebWidget) && currentWebWidget.url) {
					standaloneUiFeatureConfig.webWidget = currentWebWidget;
					standaloneUiFeatureConfig.webWidgetUrl = currentWebWidget.url;
					hasUpdates = true;
					dependencies.log.info({ Message: 'Saved original Standalone Web Widget', PanelId: currentWebWidget.panelId });
				} else if (currentWebWidget && !dependencies.companionUi.isCompanionWebWidget(currentWebWidget)) {
					dependencies.log.warn({ Message: 'Current Standalone Web Widget was not saved because its inventory URL is unavailable', PanelId: currentWebWidget.panelId || '' });
				}
			} catch (error) {
				dependencies.log.warn({ Message: 'Failed to save original Standalone Web Widget', Error: error.message || error.code || 'Unknown Web Widget inventory error' });
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
					dependencies.utils.softError({ Context: 'Failed to save Standalone UI feature config change', Feature: feature.key, Error: error });
				});
			});
		}
	}

	async function handleStandaloneUiFeatureChange(feature, value) {
		const context = getRuntimeContext();
		if (isApplyingUiFeatureConfig || context.mode !== 'Standalone' || value === undefined || value === null) {
			return;
		}
		standaloneUiFeatureConfig[feature.key] = value;
		await dependencies.mem.write(dependencies.storageKey, standaloneUiFeatureConfig);
		dependencies.log.debug({ Message: 'Saved Standalone UI feature preference', Feature: feature.key, Value: value });
	}

	function registerStandaloneWebWidgetSubscription() {
		if (!shouldManageWebWidget() || !shouldRestoreStandaloneWebWidget()) {
			return;
		}

		const xapi = dependencies.xapi;
		const layoutUpdated = xapi && xapi.Event && xapi.Event.UserInterface && xapi.Event.UserInterface.Extensions
			&& xapi.Event.UserInterface.Extensions.Widget && xapi.Event.UserInterface.Extensions.Widget.LayoutUpdated;
		if (!layoutUpdated || typeof layoutUpdated.on !== 'function') {
			dependencies.log.debug({ Message: 'Standalone Web Widget layout subscription unavailable' });
			return;
		}

		layoutUpdated.on(() => {
			handleStandaloneWebWidgetLayoutUpdated().catch(error => {
				dependencies.utils.softError({ Context: 'Failed to save Standalone Web Widget change', Error: error });
			});
		});
	}

	async function handleStandaloneWebWidgetLayoutUpdated() {
		if (getRuntimeContext().mode !== 'Standalone') {
			return;
		}

		const currentWebWidget = await dependencies.companionUi.getCurrentWebWidget(dependencies.xapi);
		if (!currentWebWidget || dependencies.companionUi.isCompanionWebWidget(currentWebWidget) || !currentWebWidget.url) {
			return;
		}

		const savedWebWidget = getStandaloneWebWidget();
		if (webWidgetDefinitionsMatch(savedWebWidget, currentWebWidget)) {
			return;
		}

		standaloneUiFeatureConfig.webWidget = currentWebWidget;
		standaloneUiFeatureConfig.webWidgetUrl = currentWebWidget.url;
		await dependencies.mem.write(dependencies.storageKey, standaloneUiFeatureConfig);
		dependencies.log.info({ Message: 'Updated Standalone Web Widget preference', PanelId: currentWebWidget.panelId });
	}

	async function registerStandaloneEnvironmentSubscriptions() {
		for (let index = 0; index < PAIRED_ENVIRONMENT_CONFIG_POLICY.length; index++) {
			const configItem = PAIRED_ENVIRONMENT_CONFIG_POLICY[index];
			const node = getXapiConfigNode(configItem.path);
			if (!node || typeof node.on !== 'function') {
				dependencies.log.debug({ Message: 'Paired environment config subscription unavailable', Configuration: configItem.key, Path: configItem.path.join('.') });
				continue;
			}
			node.on(() => {
				handleEnvironmentSubscriptionChange('Configuration', configItem.key).catch(error => {
					dependencies.utils.softError({ Context: 'Failed to handle Paired environment configuration change', Configuration: configItem.key, Error: error });
				});
			});
		}

		const connectorCollection = getVideoInputConnectorCollection();
		await registerVideoInputConnectorSubscriptions();
		if (connectorCollection && typeof connectorCollection.on === 'function') {
			connectorCollection.on(() => {
				registerVideoInputConnectorSubscriptions()
					.then(() => handleEnvironmentSubscriptionChange('VideoInputConnector', ''))
					.catch(error => {
						dependencies.utils.softError({ Context: 'Failed to handle Video Input Connector configuration change', Error: error });
					});
			});
		} else {
			dependencies.log.debug({ Message: 'Video Input Connector configuration subscription unavailable' });
		}

		const provisioningMode = getXapiConfigNode(['Provisioning', 'Mode']);
		if (provisioningMode && typeof provisioningMode.on === 'function') {
			provisioningMode.on(() => {
				handleEnvironmentSubscriptionChange('ProvisioningMode', '').catch(error => {
					dependencies.utils.softError({ Context: 'Failed to handle Provisioning Mode change', Error: error });
				});
			});
		}

		const availability = getProximityServicesAvailabilityNode();
		if (availability && typeof availability.on === 'function') {
			availability.on(() => {
				handleEnvironmentSubscriptionChange('ProximityServicesAvailability', '').catch(error => {
					dependencies.utils.softError({ Context: 'Failed to handle Proximity Services Availability change', Error: error });
				});
			});
		} else {
			dependencies.log.debug({ Message: 'Proximity Services Availability subscription unavailable' });
		}
	}

	async function registerVideoInputConnectorSubscriptions() {
		const connectors = await getVideoInputConnectors();
		for (let index = 0; index < connectors.length; index++) {
			const connectorId = getConnectorId(connectors[index]);
			if (!connectorId || subscribedConnectorIds[connectorId]) {
				continue;
			}

			const connectorNode = getVideoInputConnectorNode(connectorId);
			const inputSourceType = connectorNode && connectorNode.InputSourceType;
			const presentationSelection = connectorNode && connectorNode.PresentationSelection;
			if (inputSourceType && typeof inputSourceType.on === 'function') {
				inputSourceType.on(() => {
					handleEnvironmentSubscriptionChange('ConnectorInputSourceType', connectorId).catch(error => {
						dependencies.utils.softError({ Context: 'Failed to handle Connector InputSourceType change', ConnectorId: connectorId, Error: error });
					});
				});
			}
			if (presentationSelection && typeof presentationSelection.on === 'function') {
				presentationSelection.on(() => {
					handleEnvironmentSubscriptionChange('ConnectorPresentationSelection', connectorId).catch(error => {
						dependencies.utils.softError({ Context: 'Failed to handle Connector PresentationSelection change', ConnectorId: connectorId, Error: error });
					});
				});
			}
			subscribedConnectorIds[connectorId] = true;
		}
	}

	async function handleEnvironmentSubscriptionChange(source, key) {
		if (isApplyingEnvironmentConfig) {
			return;
		}

		const mode = getRuntimeContext().mode;
		if (mode === 'Standalone') {
			await captureStandaloneEnvironmentConfig();
			return;
		}
		await applyEnvironmentConfigMode(mode);
		dependencies.log.debug({ Message: 'Reapplied Paired environment policy after configuration change', Source: source, Configuration: key || '' });
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
		dependencies.log.debug({ Message: 'Applied Companion Web Widget theme update', Theme: userInterfaceThemeName });
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

	async function getRegistrationKind() {
		const node = getXapiConfigNode(['Provisioning', 'Mode']);
		if (!node || typeof node.get !== 'function') {
			dependencies.log.debug({ Message: 'Provisioning Mode config get unavailable; proximity mode policy skipped' });
			return null;
		}
		try {
			const value = normalizeConfigEventValue(await node.get());
			return String(value).toLowerCase() === 'webex' ? 'Cloud' : 'OnPremises';
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to read Provisioning Mode; proximity mode policy skipped', Error: error.message || error.code || 'Unknown provisioning mode error' });
			return null;
		}
	}

	function doesConfigPolicyApply(configItem, registration) {
		return !configItem.registration || configItem.registration === registration;
	}

	async function getEnvironmentConfigValue(configItem) {
		const node = getXapiConfigNode(configItem.path);
		if (!node || typeof node.get !== 'function') {
			dependencies.log.debug({ Message: 'Paired environment config get unavailable', Configuration: configItem.key, Path: configItem.path.join('.') });
			return null;
		}
		try {
			return normalizeConfigEventValue(await node.get());
		} catch (error) {
			dependencies.log.debug({ Message: 'Paired environment config get failed', Configuration: configItem.key, Path: configItem.path.join('.'), Error: error.message || error.code || 'Unknown get error' });
			return null;
		}
	}

	async function setEnvironmentConfigValue(configItem, value) {
		const node = getXapiConfigNode(configItem.path);
		if (!node || typeof node.get !== 'function' || typeof node.set !== 'function') {
			dependencies.log.debug({ Message: 'Paired environment config set unavailable', Configuration: configItem.key, Path: configItem.path.join('.') });
			return;
		}
		try {
			const currentValue = normalizeConfigEventValue(await node.get());
			if (String(currentValue).toLowerCase() === String(value).toLowerCase()) {
				return;
			}
			await node.set(value);
		} catch (error) {
			dependencies.log.warn({ Message: 'Paired environment config set failed', Configuration: configItem.key, Path: configItem.path.join('.'), Value: value, Error: error.message || error.code || 'Unknown set error' });
		}
	}

	function getVideoInputConnectorCollection() {
		const video = dependencies.xapi.Config.Video;
		return video && video.Input ? video.Input.Connector : null;
	}

	async function getVideoInputConnectors() {
		const collection = getVideoInputConnectorCollection();
		if (!collection || typeof collection.get !== 'function') {
			dependencies.log.debug({ Message: 'Video Input Connector collection get unavailable' });
			return [];
		}
		try {
			return normalizeConnectorCollection(await collection.get());
		} catch (error) {
			dependencies.log.warn({ Message: 'Failed to read Video Input Connector configuration collection', Error: error.message || error.code || 'Unknown connector get error' });
			return [];
		}
	}

	function normalizeConnectorCollection(value) {
		const normalizedValue = getXapiValue(value);
		if (Array.isArray(normalizedValue)) {
			return normalizedValue.filter(connector => connector && typeof connector === 'object');
		}
		if (!normalizedValue || typeof normalizedValue !== 'object') {
			return [];
		}
		if (Array.isArray(normalizedValue.Connector)) {
			return normalizedValue.Connector.filter(connector => connector && typeof connector === 'object');
		}
		if (getConnectorId(normalizedValue)) {
			return [normalizedValue];
		}

		const connectors = [];
		const keys = Object.keys(normalizedValue);
		for (let index = 0; index < keys.length; index++) {
			const key = keys[index];
			const connector = normalizedValue[key];
			if (!connector || typeof connector !== 'object') {
				continue;
			}
			if (!getConnectorId(connector) && /^[0-9]+$/.test(key)) {
				connector.id = key;
			}
			if (getConnectorId(connector)) {
				connectors.push(connector);
			}
		}
		return connectors;
	}

	function getConnectorId(connector) {
		const value = connector && (connector.id !== undefined ? connector.id : connector.Id !== undefined ? connector.Id : connector.ID);
		const connectorId = String(getXapiValue(value) || '').trim();
		return /^[1-9][0-9]*$/.test(connectorId) ? connectorId : '';
	}

	function getConnectorInputSourceType(connector) {
		if (!connector || connector.InputSourceType === undefined) {
			return null;
		}
		return String(getXapiValue(connector.InputSourceType)).toLowerCase();
	}

	function getConnectorPresentationSelection(connector) {
		if (!connector || connector.PresentationSelection === undefined) {
			return null;
		}
		return normalizeConfigEventValue(connector.PresentationSelection);
	}

	function hasConnectorPresentationSelection(connector, connectorId) {
		const connectorNode = getVideoInputConnectorNode(connectorId);
		return connector && connector.PresentationSelection !== undefined && connectorNode && connectorNode.PresentationSelection && typeof connectorNode.PresentationSelection.set === 'function';
	}

	function getVideoInputConnectorNode(connectorId) {
		const collection = getVideoInputConnectorCollection();
		const numericId = Number(connectorId);
		return collection && Number.isInteger(numericId) && numericId > 0 ? collection[numericId] : null;
	}

	async function setConnectorPresentationSelection(connectorId, value) {
		const connectorNode = getVideoInputConnectorNode(connectorId);
		const presentationSelection = connectorNode && connectorNode.PresentationSelection;
		if (!presentationSelection || typeof presentationSelection.set !== 'function') {
			dependencies.log.debug({ Message: 'Connector PresentationSelection set unavailable', ConnectorId: connectorId });
			return;
		}
		try {
			await presentationSelection.set(value);
			dependencies.log.debug({ Message: 'Video Input Connector PresentationSelection applied', ConnectorId: connectorId, Value: value });
		} catch (error) {
			dependencies.log.warn({ Message: 'Connector PresentationSelection set failed', ConnectorId: connectorId, Value: value, Error: error.message || error.code || 'Unknown connector set error' });
		}
	}

	function getProximityServicesAvailabilityNode() {
		const proximity = dependencies.xapi.Status.Proximity;
		return proximity && proximity.Services ? proximity.Services.Availability : null;
	}

	async function getProximityServicesAvailability() {
		const node = getProximityServicesAvailabilityNode();
		if (!node || typeof node.get !== 'function') {
			dependencies.log.debug({ Message: 'Proximity Services Availability get unavailable' });
			return null;
		}
		try {
			return normalizeConfigEventValue(await node.get());
		} catch (error) {
			dependencies.log.debug({ Message: 'Proximity Services Availability get failed', Error: error.message || error.code || 'Unknown availability get error' });
			return null;
		}
	}

	function normalizeStandaloneEnvironmentConfig(value) {
		const source = value && typeof value === 'object' ? value : {};
		return {
			configurations: source.configurations && typeof source.configurations === 'object' ? source.configurations : {},
			connectorPresentationSelection: source.connectorPresentationSelection && typeof source.connectorPresentationSelection === 'object' ? source.connectorPresentationSelection : {},
			proximityServicesAvailability: source.proximityServicesAvailability
		};
	}

	function hasOwn(value, key) {
		return !!value && Object.prototype.hasOwnProperty.call(value, key);
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

	function webWidgetDefinitionsMatch(first, second) {
		return !!(first && second
			&& first.panelId === second.panelId
			&& first.name === second.name
			&& first.refreshInterval === second.refreshInterval
			&& first.url === second.url);
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
		setStandaloneEnvironmentConfig,
		captureStandaloneConfig,
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
