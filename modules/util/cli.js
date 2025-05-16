import readline from "node:readline";
import process from "node:process";

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

  /**
   * @param {string} question
   * @return {Promise<string>}
   */
  prompt(question) {
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
  }
}
