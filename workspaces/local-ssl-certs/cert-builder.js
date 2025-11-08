import * as child_process from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import process from "node:process";
import { join } from "node:path";
import * as cli from "@squaredle/util/cli";
import { spawnAsync } from "@squaredle/util/process-util";
import { CertInfo } from "./cert-info.js";

/**
 * @typedef {Object} CertOptionsConfig
 * @property {string|undefined} [org] - The organization name ("Acme").
 * @property {string|undefined} [countryName] - The country name ("US)".
 * @property {string|undefined} [keyType] - The type of key to generate
 *     (rsa).
 * @property {string|undefined} [keyCipher] - The cipher to use for encrypted
 *     private keys (aes256).
 * @property {boolean|undefined} [safeMode] - Whether to prompt before
 *     overwriting existing keys and certs (true).
 */

export class CertOptions {
  /** @param {CertOptionsConfig=} options */
  constructor(options = {}) {
    this.org = options.org || "Acme";
    this.countryName = options.countryName || "US";
    this.keyType = options.keyType || "rsa";
    this.keyCipher = options.keyCipher || "aes256";
    this.safeMode = options.safeMode ?? true;
  }
}

export class CertBuilder {
  /** @type {CertOptions} */
  options;

  /** @private {?CertInfo} */ #rootCAInfo = null;
  /** @private {?string} */ #persistentRootCAKeyPath = null;

  /** @private {Array} */ #newCAs = [];

  /** @private {?string} */ #tempDir = null;

  static #constructing = false;

  /** @type {function(...args: any[]): void} */
  #log = console.info.bind(console);

  /**
   * @param {CertOptions} options
   * @param {string} certDir
   * @param {?string} rootCAKeyPath Leave null to create a temporary root CA
   *   private key (most secure).
   * @param {boolean} verbose
   */
  constructor(certDir, options, rootCAKeyPath, verbose) {
    if (!CertBuilder.#constructing) {
      throw new Error("Use CertBuilder.create() to create an instance");
    }
    if (typeof rootCAKeyPath === "string") {
      this.#persistentRootCAKeyPath = rootCAKeyPath;
      console.log(this.#persistentRootCAKeyPath);
    } else if (rootCAKeyPath !== null) {
      throw new Error("Root CA key path must be specified or null.");
    }
    this.options = options;
    this.certDir = certDir;
    if (!verbose) this.#log = () => {};
    const nameConstraints = "critical,permitted;DNS:.test";
    this.sharedConfig = {
      // Options for the req command:
      req: {
        // Use this config file's fields instead of prompting for them:
        prompt: "no",

        // Section names to reference:
        distinguished_name: "root_distinguished_name",
      },

      root_distinguished_name: {
        organizationName: this.options.org,
        commonName: this.options.org + " Root Dev CA",
        countryName: this.options.countryName,
      },

      // Distinguished name fields:
      req_distinguished_name: {
        organizationName: this.options.org,
        commonName: this.options.org + " Intermediate Dev CA",
        countryName: this.options.countryName,
      },

      // Extensions to add to the self-signed root CA cert:
      root_cert_extensions: {
        basicConstraints: "critical,CA:TRUE",
        // nameConstraints: nameConstraints,
        keyUsage: "critical,keyCertSign",
        extendedKeyUsage: "serverAuth,clientAuth",
        subjectKeyIdentifier: "hash",
        subjectAltName: "dirName:root_distinguished_name",
      },

      // Extensions to add to the intermediate cert:
      cert_extensions: {
        basicConstraints: "critical,CA:TRUE",
        nameConstraints: nameConstraints,
        keyUsage: "critical,keyCertSign",
        extendedKeyUsage: "serverAuth,clientAuth",
        subjectKeyIdentifier: "hash",
        subjectAltName: "dirName:req_distinguished_name",
        authorityKeyIdentifier: "keyid:always",
      },

      // Extensions to add to SSL certs:
      ssl_cert_extensions: {
        basicConstraints: "critical,CA:FALSE",
        // nameConstraints: nameConstraints,
        keyUsage: "critical,digitalSignature,keyEncipherment",
        extendedKeyUsage: "serverAuth,clientAuth",
        subjectKeyIdentifier: "hash",
        subjectAltName: "dirName:req_distinguished_name",
        authorityKeyIdentifier: "keyid:always",
      },
    };

    process.on("exit", () => this.#cleanUp());
  }

  /**
   * @param {string} certDir Directory to read/write certs from/to.
   * @param {?string} persistentRootCAKeyPath If null, the root CA private key
   *   is only temporary (most secure). If set, the root CA will be loaded from
   *   and saved to this path.
   * @param {?CertOptions=} certOptions
   * @param {boolean=} verbose
   * @return {Promise<CertBuilder>}
   */
  static async create(
    certDir,
    persistentRootCAKeyPath,
    certOptions = null,
    verbose = false,
  ) {
    if (certOptions === null) {
      certOptions = new CertOptions();
    }
    try {
      child_process.execSync("openssl version");
    } catch (_) {
      throw new Error("openssl command not available.");
    }
    this.#constructing = true;
    const builder = new CertBuilder(
      certDir,
      certOptions,
      persistentRootCAKeyPath,
      verbose,
    );
    this.#constructing = false;
    fs.mkdirSync(builder.certDir, { recursive: true, mode: 0o700 });
    builder.#writeConfFile(await builder.#getConfFile(), builder.sharedConfig);
    return builder;
  }

  /**
   * Validates that the given SSL cert is valid for the given hostnames.
   * @param {CertInfo} certInfo
   * @param {Array<string>} hostnames
   * @param {boolean=} verbose
   * @returns {Promise<void>}
   */
  static async validateSslCert(certInfo, hostnames, verbose = false) {
    const log = verbose ? console.log.bind(console) : () => {};
    log(`Validating SSL cert ${certInfo.certPath} for hostnames:`, hostnames);

    const runOpenSSL = async (...args) => {
      log(`% openssl ${args.join(" ")}`);
      const command = spawnAsync("openssl", args, {
        stdio: ["ignore", "pipe", "inherit"],
      });
      return command.promise;
    };

    // Basic validations:
    await runOpenSSL(
      "x509",
      "-in",
      certInfo.certPath,
      "-noout",
      "-checkend",
      "0",
    );
    await runOpenSSL("rsa", "-in", certInfo.keyPath, "-noout", "-check");
    await runOpenSSL(
      "verify",
      ...(verbose ? ["-verbose"] : []),
      "-purpose",
      "sslserver",
      certInfo.certPath,
    );

    // Check expiration date.
    const dateCommand = await runOpenSSL(
      "x509",
      "-enddate",
      "-noout",
      "-in",
      certInfo.certPath,
    );
    const match = dateCommand.stdout.match(/notAfter=(.+)/);
    if (match) {
      const notAfter = new Date(match[1]);
      const now = new Date();
      if (now >= notAfter) {
        throw new Error(`Certificate expired on ${notAfter.toUTCString()}`);
      }
      // 14 days
      if (notAfter - now < 14 * 24 * 60 * 60 * 1000) {
        console.warn(
          `Warning: Certificate expires on ${notAfter.toUTCString()}`,
        );
      }
      log(`Certificate valid until ${notAfter.toUTCString()}`);
    } else {
      throw new Error("Could not parse certificate expiration date.");
    }

    const subjCommand = await runOpenSSL(
      "x509",
      "-noout",
      "-subject",
      "-in",
      certInfo.certPath,
    );

    const altNamesCommand = await runOpenSSL(
      "x509",
      "-noout",
      "-ext",
      "subjectAltName",
      "-in",
      certInfo.certPath,
    );

    const names = [];
    const cnMatch = subjCommand.stdout.match(/subject=.*CN\s*=\s*([^/,\n]+)/);
    if (!cnMatch) {
      throw new Error("Could not find common name (CN) in certificate.");
    }
    names.push(cnMatch[1].trim());

    const dnsMatches = altNamesCommand.stdout.matchAll(/DNS:([^,\n]+)/g);
    names.push(...dnsMatches.map((match) => match[1].trim()));

    log("Common name and subject alt names:", names);
    const missingNames = hostnames.filter(
      (hostname) => !names.includes(hostname),
    );
    if (missingNames.length > 0) {
      throw new Error(
        `Some hostnames not found in certificate: ${missingNames.join(", ")}`,
      );
    }

    // Check that the private key matches the cert.
    const keyCommand = await runOpenSSL(
      "x509",
      "-noout",
      "-modulus",
      "-in",
      certInfo.certPath,
    );
    const modCert = keyCommand.stdout.trim();

    const privKeyCommand = await runOpenSSL(
      "rsa",
      "-noout",
      "-modulus",
      "-in",
      certInfo.keyPath,
    );
    const modKey = privKeyCommand.stdout.trim();
    if (modCert !== modKey) {
      throw new Error("Certificate and private key do not match.");
    }
  }

  /*
   * Creates the root CA key pair and self-signed cert.
   * The key, password, and cert are used to sign other certs.
   */
  async createRootCA() {
    const certName = this.sharedConfig.root_distinguished_name.commonName;
    let privKeyPath;
    if (this.#persistentRootCAKeyPath) {
      privKeyPath = this.#persistentRootCAKeyPath;
    } else {
      privKeyPath = join(await this.#getTempDir(), `$certName.key`);
    }

    const certInfo = new CertInfo(
      join(this.certDir, `${certName}.crt`),
      privKeyPath,
    );

    if (this.options.safeMode) {
      const existingFiles = [certInfo.keyPath, certInfo.certPath].filter(
        (path) => fs.existsSync(path),
      );

      if (
        existingFiles.length > 0 &&
        !(await cli.confirm(
          `Files exist:\n  ${existingFiles.join(
            "\n  ",
          )}\nOverwrite existing files ?`,
        ))
      ) {
        console.warn("Aborting.");
        process.exit(1);
      }
    }

    if (this.#persistentRootCAKeyPath) {
      const promptPassword = await import("@squaredle/util/password-prompt");
      certInfo.password = await promptPassword.passwordPrompt(
        "Create a password for the root CA: ",
        "Confirm password: ",
      );
    } else {
      certInfo.password = crypto.randomBytes(32).toString("hex");
    }

    this.#log(`Creating self-signed root CA cert`);
    try {
      const req = spawnAsync(
        "openssl",
        [
          // Create a new self-signed cert.
          "req",
          "-x509",
          "-new",
          "-newkey",
          this.options.keyType,
          "-keyout",
          certInfo.keyPath,

          // Pipe the password to stdin, rather than passing it on the command
          // line (where it could be read by other processes).
          "-passout",
          "stdin",

          "-out",
          certInfo.certPath,

          // Certify for 9999 days:
          "-days",
          "9999",
          "-config",
          await this.#getConfFile(),
          "-extensions",
          "root_cert_extensions",
          // "-extensions",
          // "root_name_constraints",

          `-text`,
        ],
        { stdio: "pipe" },
      );
      req.childProcess.stdin.write(certInfo.password);
      req.childProcess.stdin.end();
      req.childProcess.stderr.pipe(process.stderr);
      await req.promise;
      this.#rootCAInfo = certInfo;
      this.#newCAs.push(certInfo.certPath);
    } catch (err) {
      console.error("Error creating root CA cert:", err);
      console.log(err.cmd);
      process.exit(1);
    }
  }

  /**
   * @param {string} name for the cert and related files
   * @param {CertInfo} issuer
   * @param {string|Array<string>=} hostnames The hostname(s), for SSL
   *     certificates. Leave null for intermediate CA certs.
   * @return {?CertInfo} Newly issued cert info.
   */
  async issueSignedCert(name, issuer, hostnames = null) {
    const pathPrefix = join(this.certDir, name);
    const certInfo = new CertInfo(`${pathPrefix}.crt`, `${pathPrefix}.key`);

    if (this.options.safeMode) {
      for (const path of [certInfo.keyPath, certInfo.certPath]) {
        if (fs.existsSync(path)) {
          if (!(await cli.confirm(`Overwrite existing file ${path}?`))) {
            console.warn("Aborting.");
            return null;
          }
        }
      }
    }

    let subjAltName;
    if (hostnames?.length > 0) {
      if (typeof hostnames === "string") hostnames = [hostnames];
      subjAltName = hostnames.map((hostname) => `DNS:${hostname}`);
    } else {
      this.#newCAs.push(certInfo.certPath);
    }

    const tempDir = await this.#getTempDir();

    try {
      const args = [
        "req",
        "-batch",

        // Request a new cert:
        "-new",
        "-newkey",
        this.options.keyType,
        "-nodes",
        "-keyout",
        certInfo.keyPath,

        "-out",
        join(tempDir, "req.csr"),

        "-config",
        await this.#getConfFile(),

        // Set request subject name:
        "-subj",
        `/C=US/O=${this.options.org}/CN=${name}`,

        // Print result in text form:
        "-text",
      ];

      // Is this even needed for the CSR?
      // if (hostnames) {
      //   args.push("-addext", `subjectAltName=${subjAltName.join(",")}`);
      // }
      const req = spawnAsync("openssl", args);
      await req.promise;
    } catch (err) {
      console.error("Error creating cert request:", err);
      console.log(err.cmd);
      process.exit(1);
    }

    this.#log(`Signing requested cert using issuer ${issuer.certPath}`);
    try {
      const args = [
        "x509",

        // Sign the intermediate CA cert with our root CA:
        "-req",
        "-in",
        join(tempDir, "req.csr"),
        "-CA",
        issuer.certPath,
        "-CAkey",
        issuer.keyPath,
        "-CAserial",
        join(tempDir, "ca.srl"),
        "-CAcreateserial",

        "-extensions",
        "cert_extensions",

        "-days",
        9999,
        "-trustout",
        "-out",
        `${pathPrefix}.crt`,

        // Print result in text form:
        "-text",
      ];

      if (subjAltName) {
        const extFile = join(tempDir, "ssl_extensions.conf");
        const extensions = Object.assign(
          {},
          this.sharedConfig.ssl_cert_extensions,
        );
        extensions.subjectAltName = subjAltName.join(",");
        const config = {
          cert_extensions: extensions,
        };
        this.#writeConfFile(extFile, config);
        args.push("-extfile", extFile);
      } else {
        args.push("-extfile", await this.#getConfFile());
      }

      if (issuer.password) {
        args.push("-passin", "stdin");
      }
      const command = spawnAsync("openssl", args, {
        stdio: "pipe",
      });
      if (issuer.password) {
        command.childProcess.stdin.write(issuer.password);
        command.childProcess.stdin.end();
        command.childProcess.stderr.pipe(process.stderr);
        command.childProcess.stdout.pipe(process.stdout);
      }
      await command.promise;
    } catch (err) {
      console.error("Error signing cert:\n");
      console.error(err);
      console.log(err.cmd);
      process.exit(1);
    }
    return certInfo;
  }

  /**
   * @param {string|Array<string>} hostnames The hostname(s).
   * @param {CertInfo=} issuer The issuer cert info. If not provided, looks for
   *     the intermediate CA cert.
   * @return {?CertInfo} Newly issued cert info.
   */
  async issueSslCert(hostnames, issuer = null) {
    if (typeof hostnames === "string") hostnames = [hostnames];

    if (!issuer) {
      const intermediateName =
        this.sharedConfig.req_distinguished_name.commonName;
      const intermediatePath = join(this.certDir, intermediateName);
      issuer = await this.#loadCertKeyPair(
        `${intermediatePath}.key`,
        `${intermediatePath}.crt`,
      );
      if (!issuer) {
        // Intermediate CA cert not found. Create one now.
        // First, check for the root CA.
        if (!this.#rootCAInfo && !(await this.#loadRootCA())) {
          console.log(
            "Root CA not found at",
            join(
              this.certDir,
              `${this.sharedConfig.root_distinguished_name.commonName}.crt`,
            ),
          );
          if (!(await cli.confirm("Create one now?", true))) {
            console.warn("Aborting.");
            process.exit(1);
          }
          await this.createRootCA();
        }

        console.log(`Intermediate CA not found at ${intermediatePath}.crt`);
        if (
          !(await cli.confirm(
            "Intermediate CA not found. Create one now?",
            true,
          ))
        ) {
          console.warn("Aborting.");
          process.exit(1);
        }
        issuer = await this.issueSignedCert(intermediateName, this.#rootCAInfo);
      }
    }
    this.#log("Requesting SSL cert");
    return this.issueSignedCert(hostnames[0], issuer, hostnames);
  }

  /**
   * @param {?string=} password
   * @return {{publicKey: string, privateKey: string}}
   */
  createKeyPair(password = null) {
    const options = {
      modulusLength: 2048, // for rsa/dsa
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
    };
    if (password) {
      options.privateKeyEncoding.cipher = this.options.keyCipher;
      options.privateKeyEncoding.passphrase = password;
    }
    const rootCAKeyPair = crypto.generateKeyPairSync(
      this.options.keyType,
      options,
    );
    return {
      publicKey: rootCAKeyPair.publicKey,
      privateKey: rootCAKeyPair.privateKey,
    };
  }

  /**
   * Loads the certificate key and cert.
   * @param {string} keyPath The path to the private key.
   * @param {string} certPath The path to the certificate.
   * @return {Promise<?CertInfo>}
   */
  async #loadCertKeyPair(keyPath, certPath) {
    const certInfo = new CertInfo(certPath, keyPath);
    return Promise.all([
      fs.promises.readFile(certInfo.keyPath, "utf-8"),
      fs.promises.readFile(certInfo.certPath, "utf-8"),
    ]).then(
      () => certInfo,
      (err) => {
        if (err.code === "ENOENT") return null;
        throw new Error(`Unexpected error loading cert files: ${err.message}`);
      },
    );
  }

  /**
   * Loads the root CA. Returns true if successful.
   * @return {Promise<boolean>}
   */
  async #loadRootCA() {
    if (!this.#persistentRootCAKeyPath) return false;
    this.#rootCAInfo = await this.#loadCertKeyPair(
      this.#persistentRootCAKeyPath,
      join(
        this.certDir,
        `${this.sharedConfig.root_distinguished_name.commonName}.crt`,
      ),
    );
    return !!this.#rootCAInfo;
  }

  async #getTempDir() {
    if (!this.#tempDir) {
      this.#tempDir = await fsPromises.mkdtemp(
        join(os.tmpdir(), "local-ssl-certs-"),
      );
      this.#log("Created temp dir:", this.#tempDir);
    }
    return this.#tempDir;
  }

  async #getConfFile() {
    return join(await this.#getTempDir(), "shared.conf");
  }

  /**
   * Writes a config file for use by openssl commands.
   * @param {string} path
   * @param {Object} sections
   */
  #writeConfFile(path, sections) {
    this.#log("Writing config file to", path);
    const conf = fs.openSync(path, "w+");
    for (const section of Object.getOwnPropertyNames(sections)) {
      fs.writeSync(conf, `[${section}]\n`);
      for (const [key, value] of Object.entries(sections[section])) {
        fs.writeSync(conf, `${key} = ${value}\n`);
      }
    }
    fs.closeSync(conf);
  }

  #cleanUp() {
    if (this.#tempDir) {
      this.#log("Cleaning up temp dir:", this.#tempDir);
      try {
        fs.rmSync(this.#tempDir, { recursive: true /*, force: true*/ });
      } catch (err) {
        console.error("Error cleaning up temp dir:", err);
        if (!this.#persistentRootCAKeyPath && !!this.#rootCAInfo?.keyPath) {
          console.error(
            "Could not delete root CA key file:",
            this.#rootCAInfo.keyPath,
          );
          console.error("Delete it manually before trusting the root CA.");
          process.exit(1);
        }
      }
    }

    if (this.#newCAs.length > 0) {
      console.log(
        "Install new CA certs:\n" +
          this.#newCAs.map((path) => `  + ${path}`).join("\n"),
      );
    }
  }
}
