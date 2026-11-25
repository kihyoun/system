import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import tls from 'node:tls';

export interface CaProvenance {
  format: string;
  bundle: string;
  sha256: string;
  distrustedSha256: string[];
  [key: string]: unknown;
}

export function readCaProvenance(directory: string): CaProvenance {
  const value: unknown = JSON.parse(
    fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'),
  );

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('ca-provenance-invalid');
  }

  const row = value as CaProvenance;

  if (
    row.format !== 'system-public-ca-bundle-v1' ||
    typeof row.bundle !== 'string' ||
    !/^[A-Za-z0-9_.-]+$/.test(row.bundle) ||
    ['.', '..'].includes(row.bundle) ||
    typeof row.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.sha256) ||
    !Array.isArray(row.distrustedSha256) ||
    row.distrustedSha256.some((value) => typeof value !== 'string' || !/^[A-F0-9]{64}$/.test(value))
  ) {
    throw Error('ca-provenance-invalid');
  }

  return row;
}

export function certificates(value: string): string[] {
  const result = value.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);

  if (!result?.length) {
    throw Error('ca-certificates-required');
  }

  return result;
}

export function check(values: readonly string[], provenance: CaProvenance): number {
  if (!values.length) {
    throw Error('ca-certificates-required');
  }

  const denied = new Set(provenance.distrustedSha256);
  for (const value of values) {
    const certificate = new crypto.X509Certificate(value);

    if (denied.has(certificate.fingerprint256.replaceAll(':', ''))) {
      throw Error('ca-distrusted-certificate');
    }
  }
  return values.length;
}

export function verifyBundle(checkout: string): { certificates: number; bundleSha256: string } {
  const directory = path.join(checkout, 'config/ca'),
    provenance = readCaProvenance(directory);
  const bytes = fs.readFileSync(path.join(directory, provenance.bundle));

  if (crypto.createHash('sha256').update(bytes).digest('hex') !== provenance.sha256) {
    throw Error('ca-bundle-sha256-mismatch');
  }

  return {
    certificates: check(certificates(bytes.toString('utf8')), provenance),
    bundleSha256: provenance.sha256,
  };
}

export function verifySystem(
  checkout: string,
  environment: NodeJS.ProcessEnv = process.env,
  execArguments = process.execArgv,
) {
  const provenance = readCaProvenance(path.join(checkout, 'config/ca'));
  const file = environment.SSL_CERT_FILE || '/etc/ssl/certs/ca-certificates.crt';
  const flags = [...(environment.NODE_OPTIONS || '').split(/\s+/), ...execArguments];

  if (
    !flags.includes('--use-openssl-ca') ||
    flags.includes('--use-bundled-ca') ||
    flags.includes('--use-system-ca')
  ) {
    throw Error('ca-node-openssl-mode-required');
  }

  const anchors = tls.getCACertificates('system'),
    extra = tls.getCACertificates('extra');

  if (extra.length) {
    check(extra, provenance);
  }

  return {
    systemCertificates: check(certificates(fs.readFileSync(file, 'utf8')), provenance),
    nodeCertificates: check(anchors, provenance),
    nodeCaMode: 'openssl',
    bundleSha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  };
}
