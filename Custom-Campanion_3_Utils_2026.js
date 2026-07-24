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
 * Revised:                 July 24, 2026
 * Version:                 1.0.2
 *
 * Description:             Shared structured logging plus soft and hard diagnostic boundaries.
 *
 * Documentation:           https://github.com/ctg-tme/Custom_Companion_2026/blob/main/docs/technical-reference.md
 *
 * Software Platforms:      RoomOS
 *
 * Hardware Platforms:      Board Pro, Board Pro G2, Board Pro G3, Desk Pro, Desk, Desk Mini, Desk Pro G2;
 *                          compatible RoomOS Parent Room Devices
 *
 * Code Dependencies:       None
 *
 * AI Generation:           Percentage: 95% (estimated)
 *                          Model(s): OpenAI Codex (GPT-5 family)
 *                          Instruction File(s): AGENTS.md,
 *                          https://github.com/ctg-tme/Bobbys_Macro_AI_Agents/blob/main/AGENTS.md
 *                          Disclaimer: AI-assisted code should be reviewed and tested by qualified engineers before deployment.
 */

class Logger {
	constructor(suffix = '') {
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
	const diagnostic = options || {};
	const msg = {};
	const keys = Object.keys(diagnostic);
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index];
		msg[key] = key === 'Error' ? summarizeError(diagnostic[key]) : diagnostic[key];
	}

	log.error(msg);
}

function summarizeError(error) {
	if (!error || typeof error !== 'object') {
		return error || 'Unknown error';
	}
	const summary = {};
	if (error.name) {
		summary.Name = String(error.name);
	}
	if (error.message) {
		summary.Message = String(error.message);
	}
	if (error.code) {
		summary.Code = String(error.code);
	}
	if (error.Context) {
		summary.Context = error.Context;
	}
	return Object.keys(summary).length ? summary : error;
}


function hardError(options) {
	const diagnostic = options || {};
	const error = diagnostic.Error instanceof Error
		? diagnostic.Error
		: new Error(diagnostic.Context || 'Custom Companion hard error');

	error.Diagnostic = diagnostic;
	if (diagnostic.Code && !error.code) {
		error.code = diagnostic.Code;
	}

	log.error(diagnostic);
	throw error;
}

const utils = {
	softError,
	hardError,
	Logger
};

export { utils };
