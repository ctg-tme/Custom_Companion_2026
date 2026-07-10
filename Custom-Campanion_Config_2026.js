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

 * Date Created:            July 09, 2026
 * Revised:                 July 09, 2026
 * Version:                 1.0.1
 *
 * Description:             Shared configuration for the custom Companion Solution for Board Series endpoints with Wheel Kits.
 *                          This file provides a single source of truth for defaults used by board and room-reference macros.
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

const config = {
  version: '1.0.1',
  memory: {
    storageMacroName: 'Custom-Campanion'
  },
  pinProtection: {
    enabled: true,
    defaultPin: '0000',
    minLength: 4,
    maxLength: 8,
    pattern: '^\\d{4,8}$'
  },
  httpClient: {
    mode: 'On',
    allowInsecureHTTPS: false,
    maxConcurrentRequests: 3
  },
  parentDevices: {
    storageKey: 'parentDevices'
  }
};

export { config };