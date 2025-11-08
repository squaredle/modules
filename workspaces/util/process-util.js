import child_process from "node:child_process";

/**
 * Spawns a command asynchronously, returning a promise that resolves when the
 * command completes or rejects if it fails (non-zero exit code).
 * @param {string} command
 * @param {?Array<string>=} args
 * @param {Object=} options Options passed to `child_process.spawn`.
 *     If options.stdio has stdout set to "pipe", the promise will resolve with
 *     the stdout and stderr of the command.
 * @returns {!{
 *   promise: Promise<{stdout: string, stderr: string}|null>,
 *   childProcess: ChildProcessWithoutNullStreams,
 * }}
 */
export function spawnAsync(command, args = [], options = {}) {
  args = args ?? [];
  let childProcess;
  const promise = new Promise((resolve, reject) => {
    if (typeof options.stdio === "undefined") {
      options.stdio = "inherit";
    }
    childProcess = child_process.spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    childProcess.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    childProcess.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    childProcess.on("error", (err) => {
      reject(err);
    });
    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout,
          stderr,
        });
      } else {
        reject(
          new Error(
            `Command:\n  ${command} ${args
              .map((arg) => `"${arg}"`)
              .join(" ")}\n` + `failed with exit code ${code}`,
          ),
        );
      }
    });
  });
  return {
    promise,
    childProcess,
  };
}
