# Dev Certificates

Easy creation of local trusted SSL certificates for developers.

## Quickstart

```shell
npx @squaredle/local-ssl-certs issue --name Acme dev-certs acme.test "*.acme.test"
```

## Usage

1. **Run**:

   ```shell
   npx @squaredle/local-ssl-certs issue --name Acme dev-certs acme.test
   ```

2. **Install** the resulting CA certificates:

   - The root CA certificate (ending in `.crt`) must be installed in your
     **Trusted Root Certification Authorities** store.
     - By default, the root CA's private key is deleted after creation so it
       can't be used against you.
   - The intermediate CA (also ending in `.crt`) must be installed in your
     **Intermediate Certification Authorities** store.
     - This certificate can only be used to sign certificates for `.test`
       domain names, so it's relatively safe to keep the private key around.
     - Alternatively, you may delete the intermediate private key, but
       you'll need to reissue and reinstall the root and intermediate CA
       certificates to generate new certificates later.
   - Installation varies by OS:

     - Windows: Open the root and intermediate `.crt` files and install each
       in its appropriate store (see above).
     - Mac: Open the root and intermidate `.crt` files in Keychain Access and
       install them in the System keychain, set to "Always Trust".
     - Linux: Varies by distribution. For Ubuntu:

       ```shell
       sudo cp dev-certs/root-ca.crt /usr/local/share/ca-certificates/
       sudo update-ca-certificates
       ```

3. **Configure** your local web server to use the generated certificate and key:

   - For example, if you're using `http-server`:

     ```shell
     npx http-server -S -C dev-certs/your-local-domain.test.crt -K dev-certs/your-local-domain.test.key
     ```

   - Or in an Apache VirtualHost:

     ```
     SSLEngine on
     SSLCertificateFile /path/to/dev-certs/your-local-domain.test.crt
     SSLCertificateKeyFile /path/to/dev-certs/your-local-domain.test.key
     ```

4. **Test** the SSL certificate:

   - You may need to restart your browser or device for new CAs to take effect.
   - Open your browser and navigate to `https://your-local-domain.test`.
   - If everything is set up correctly, you should see a secure connection
     without any warnings.
