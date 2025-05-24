import process from "node:process";
import readline from "node:readline";

async function promptOnce(prompt) {
  process.stdout.write(prompt);
  const rl = readline.createInterface({ input: process.stdin });
  process.stdin.setRawMode(true);

  let resolvePromise, rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  let password = "";
  const onKeypress = async (args) => {
    if (args[0] === "\r") {
      return resolvePromise(password);
    }

    // Abort on ctrl-c or ctrl-d:
    if (args[0] === "\u0003" || args[0] === "\u0004") {
      return rejectPromise(new Error("Aborted"));
    }

    // Handle terminal suspend:
    if (args[0] === "\u001A") {
      return process.kill(process.pid, "SIGTSTP");
    }

    // Handle backspace:
    if (args[0] === "\u007F") {
      if (password) {
        password = password.slice(0, -1);
        process.stdout.write("\b \b");
      }
      return;
    }

    password += args[0];
    process.stdout.write("*");
  };
  process.stdin.on("keypress", onKeypress);

  return promise.finally(() => {
    process.stdin.setRawMode(false);
    process.stdin.removeListener("keypress", onKeypress);
    rl.close();
    process.stdout.write("\n");
  });
}

/**
 * @param {string} prompt
 * @param {?string=} retypePrompt
 * @returns {Promise<unknown>}
 */
export async function passwordPrompt(prompt, retypePrompt = null) {
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      process.stdin.once("data", (data) => {
        resolve(data.toString().replace(/\r?\n$/, ""));
      });
      process.stdin.once("end", () => {
        reject(new Error("Process exited before password was entered"));
      });
    });
  }

  readline.emitKeypressEvents(process.stdin);
  const password = await promptOnce(prompt);
  if (retypePrompt) {
    const retypedPassword = await promptOnce(retypePrompt);
    if (password !== retypedPassword) {
      console.error("Passwords do not match");
      return passwordPrompt(prompt, retypePrompt);
    }
  }
  return password;
}
