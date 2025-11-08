import { spawnAsync } from "@squaredle/util/process-util";

export class CertInfo {
  #x509 = null;

  constructor(certPath, keyPath, password = null) {
    this.certPath = certPath;
    this.keyPath = keyPath;
    this.password = password;
  }

  /** @returns {Promise<string>} */
  async getDetails() {
    if (!this.#x509) {
      await this.#hydrate();
    }
    return this.#x509;
  }

  async #hydrate() {
    this.#x509 = {};
    const result = spawnAsync(
      "openssl",
      [
        "x509",
        "-in",
        this.certPath,
        "-text",
        "-ext",
        "subjectAltName",
        "-trustout",
        "-certopt",
        "no_header,no_version,no_serial,no_validity,no_pubkey,no_sigdump",
        "-noout",
      ],
      {
        stdio: ["inherit", "pipe", "inherit"],
      },
    );
    this.#x509 = await result.promise;
  }
}
