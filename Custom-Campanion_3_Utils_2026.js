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
 * Version:                 1.0.0
 *
 * Description:             A macro that facilitates a custom Companion Solution for Board Series endpoints with Wheel Kits
 *                          This utility module provides shared logging and error handling helpers for the solution.
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

class Logger {
  constructor(suffix = "") {
    this.suffix = suffix;
  }

  get prefix() { return `[${this.suffix}]`; }
  log(...args) { console.log(this.prefix, ...args); }
  info(...args) { console.info(this.prefix, ...args); }
  warn(...args) { console.warn(this.prefix, ...args); }
  error(...args) { console.error(this.prefix, ...args); }
  debug(...args) { console.debug(this.prefix, ...args); }
}

const log = new Logger('Custom-Campanion_Utils');

async function softError(options) {
  const msg = options;

  log.error(msg);
  return;
}


async function hardError(options) {
  const msg = options;

  log.error(msg);
  return;
}

const utils = {
  softError,
  hardError,
  Logger
}

export { utils }