import readline from "node:readline";
import process from "node:process";
import { program } from "commander";

export class Cli {
  constructor(usageMessage) {
    this._usageMessage = usageMessage;
  }

  usage(message = "") {
    if (message) {
      console.error(message + "\n");
    }
    console.log(this._usageMessage);
    process.exit(message ? 1 : 0);
  }
}

let promptManager = {
  runSync: (fn) => fn(),
};

export function setPromptManager(manager) {
  promptManager = manager;
}

/**
 * @param {string} question
 * @return {Promise<string>}
 */
export async function prompt(question) {
  return promptManager.runSync(() => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) =>
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      }),
    );
  });
}

/**
 * @param question
 * @param {boolean=} assumeTrue Make true the default if no answer is given
 * @returns {Promise<boolean>}
 */
export async function confirm(question, assumeTrue) {
  return promptManager.runSync(() => {
    const msg = `${question} (${assumeTrue ? "Y/n" : "y/N"}) `;
    return prompt(msg).then((answer) => {
      if (answer === "") {
        return assumeTrue === true;
      }
      return ["y", "yes"].includes(answer.trim().toLowerCase());
    });
  });
}

/**
 * Converts an array of key=value pairs into an object.
 * @param {Array<string>=} args
 * @returns {Record<string, string>}
 */
export function splitKeyValueArgs(args = []) {
  const obj = {};
  for (const pair of args) {
    // Split on the first `=`, allowing for `=` in values.
    const [key, ...valueParts] = pair.split("=");
    const value = valueParts.join("=");
    if (!key || !value) {
      program.error(`Invalid key-value pair: ${pair}`);
    }
    if (key in obj) {
      program.error(`Duplicate key: ${key}`);
    }
    obj[key] = value;
  }
  return obj;
}

export const ScreenCodes = {
  reset: "\x1b[0m",
  underline: "\x1b[4m",
};
if (!process.stdout.isTTY) {
  for (const code in ScreenCodes) {
    ScreenCodes[code] = "";
  }
}

/**
 * Gets an environment variable value, first checking the key prefixed with the
 *   given environment.
 * @param {string} key
 * @param {string} env
 * @return {string|undefined}
 */
export function getEnvVar(key, env) {
  const value = process.env[`${env.toUpperCase()}_${key}`] ?? undefined;
  return value ?? process.env[key] ?? undefined;
}
