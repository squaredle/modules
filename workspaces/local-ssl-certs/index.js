#!/usr/bin/env node

import { CertBuilder, CertOptions } from "./cert-builder.js";
// import { Cli } from "@squaredle/util/cli";
import { program } from "commander";
import { CertInfo } from "./cert-info.js";

program
  .command("print")
  .description("Prints information about the given certificates")
  .argument("<certs...>", "Certificates to display information about")
  .action(async (certs) => {
    // Queue all fetches in parallel, then await-print them in order.
    const promises = [];
    for (const cert of certs) {
      const certInfo = new CertInfo(cert, null);
      promises.push(certInfo.getDetails());
    }
    for (let i = 0; i < promises.length; i++) {
      const details = await promises[i];
      console.log(`Certificate: ${certs[i]}`);
      console.log(details.stdout);
    }
  });

program
  .command("validate <crt> <key>")
  .description("Validates the given certificate and key pair")
  .argument(
    "[hostnames...]",
    "Hostnames to verify exist in the SSL certificate",
  )
  .option("-v, --verbose", "Enable verbose output")
  .action(async (crt, key, hostnames, options) => {
    const certInfo = new CertInfo(crt, key);
    await CertBuilder.validateSslCert(
      certInfo,
      hostnames,
      !!options["verbose"],
    );
    console.log("Certificate validation successful.");
  });

program
  .command("issue")
  .description("Issue SSL certificates for the given hostnames")
  .argument("<directory>", "Directory to load/save SSL certificates")
  .argument("<hostnames...>", "Hostnames to include in the SSL certificate")
  .option("-n, --name <name>", "Organization name [Acme]")
  .option(
    "-r, --root <path>",
    "Path to load/save CA private key (by default, one will be auto-generated and deleted)",
  )
  .option("-v, --verbose", "Enable verbose output")
  .option("-y, --yes", "Assume yes for prompts to overwrite existing files")
  .action(async (directory, hostnames, options) => {
    const builder = await CertBuilder.create(
      directory,
      options["root"] ?? null,
      new CertOptions({
        org: options["name"] ?? "Acme",
        safeMode: !options["yes"],
      }),
      !!options["verbose"],
    );

    await builder.issueSslCert(hostnames);
  });

program.parse();
