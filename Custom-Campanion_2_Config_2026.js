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
 * Date Created:            July 09, 2026
 * Revised:                 July 27, 2026
 * Version:                 0.1.2.60
 *
 * Description:             User-facing configuration for the Custom Companion solution on supported Companion Devices.
 *                          This file provides settings intended to be edited for deployment-specific behavior.
 *
 * Documentation:           https://github.com/ctg-tme/Custom_Companion_2026/blob/main/docs/technical-reference.md
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro, Board Pro G2, Board Pro G3, Desk Pro, Desk, Desk Mini, Desk Pro G2
 *
 * Code Dependencies:       None
 *
 * AI Generation:           Percentage: 95% (estimated)
 *                          Model(s): OpenAI Codex (GPT-5 family)
 *                          Instruction File(s): AGENTS.md,
 *                          https://github.com/ctg-tme/Bobbys_Macro_AI_Agents/blob/main/AGENTS.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

const projectVersion = '0.1.2.60';

const config = {
  CompanionDeviceInformation: {
    host: '',                            // The Host Address or IP of this device. This is passed to Parent Room Devices in order to facilitate back-and-forth communication.
    username: 'custom-companion',        // The Username to this device. This is passed to Parent Room Devices in order to facilitate back-and-forth communication. We recommend setting up a new user named `custom-companion` for this role to assist with the audit log when troubleshooting.
    password: ''                         // The Password to this device. This is passed to Parent Room Devices in order to facilitate back-and-forth communication.
  },
  pinMode: {
    defaults: {
      enabled: true,                     // Enables PIN Mode when its durable state is first initialized. It does not override changes made using the Companion Device UI.
      pin: '0000'                        // Default PIN. Must be 4–8 digits. This is the initial PIN set on a new installation.
    }
  },
  UserInterface: {
    WebWidget: {
      urlOverride: '',                   // Optional WebWidget base URL. Blank selects the built-in https://ctg-tme.github.io/Simple-WebWidget/ fallback.
      CompanionWidget: {
        enabled: true,                   // Enables Custom Companion WebWidget. This widget is based on the Simple-WebWidget solution, allowing for a richer companion experience for the user operating this system.
        restoreStandaloneExisting: false, // Retains the user's original WebWidget while in Standalone mode, but enables the Companion WebWidget when Paired.
        weather: {
          mode: false,                   // Shows weather information in the Companion WebWidget.
          latitude: '',                  // Latitude used for Companion WebWidget weather.
          longitude: '',                 // Longitude used for Companion WebWidget weather.
          temperatureUnit: 'fahrenheit'  // Weather temperature display unit.
        },
        time: {
          mode: false,                   // Shows time information in the Companion WebWidget.
          timeZone: ''                   // IANA time zone used by the Companion WebWidget.
        },
        Standalone: {
          userGuidance: 'Use Companion Device Select to register or select a Parent Room Device.', // Directs the user where to interact with this solution. Leave blank to remove.
          iconUrl: 'https://ctg-tme.github.io/Custom_Companion_2026/icons/custom-companion-512.png' // WebWidget image shown in Standalone.
        },
        Paired: {
          userGuidance: 'Use Companion Device Select to choose Standalone or another Parent Room Device.', // Directs the user where to interact with this solution while Paired. Leave blank to remove.
          iconUrl: 'https://ctg-tme.github.io/Custom_Companion_2026/icons/custom-companion-512.png' // WebWidget image shown while Paired.
        }
      }
    }
  }
};

export { config, projectVersion };
