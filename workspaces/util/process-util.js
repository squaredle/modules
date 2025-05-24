import child_process from "node:child_process";

/**
 * @param {string} command
 * @param {Array<string>=} args
 * @param {Object=} options Spawn options. If options.stdio has stdout set to
 *   "pipe", the promise will resolve with the stdout of the command.
 * @returns {!{
 *   promise: Promise<string|null>,
 *   childProcess: ChildProcessWithoutNullStreams,
 * }}
 */
export function spawnAsync(command, args = [], options = {}) {
  let childProcess;
  const promise = new Promise((resolve, reject) => {
    if (typeof options.stdio === "undefined") {
      options.stdio = "inherit";
    }
    childProcess = child_process.spawn(command, args, options);
    let stdout = childProcess.stdout ? "" : null;
    childProcess.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    childProcess.on("error", (err) => {
      reject(err);
    });
    childProcess.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(
            `Command:\n  ${command} ${args
              .map((arg) => `"${arg}"`)
              .join(" ")}\n` + `failed with exit code ${code}`,
          ),
        );
    });
  });
  return { promise, childProcess };
}
