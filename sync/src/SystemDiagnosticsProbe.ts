import {execFile} from 'child_process';
import net from 'net';
import tls from 'tls';
import http from 'http';
import https from 'https';

export const PROBE_TIMEOUT_MS = 3000;
export interface ProbeDriver {
  dns(host: string): Promise<string[]>;
  tcp(address: string, port: number): Promise<void>;
  tls(address: string, port: number, hostname: string): Promise<void>;
  http(url: URL, address: string): Promise<{status: number; challenge: boolean; registry: boolean}>;
}
export function diagnosticCode(error: any): string {
  const code = String(error?.code || 'UNAVAILABLE');
  return /^(?:ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ERR_TLS_CERT_ALTNAME_INVALID|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|ERR_SSL_[A-Z_]+)$/.test(code) ? code : 'UNAVAILABLE';
}
function timeoutError() { return Object.assign(new Error('Timed out'), {code: 'ETIMEDOUT'}); }
export const nativeProbe: ProbeDriver = {
  dns(host) {
    // A bounded subprocess preserves OS hosts-file resolution and can be killed;
    // a timed-out getaddrinfo in the controller thread pool cannot be cancelled.
    return new Promise((resolve, reject) => execFile(process.execPath, ['-e',
      'require("dns").lookup(process.argv[1],{all:true},(e,a)=>{if(e){process.stderr.write(e.code);process.exitCode=1}else process.stdout.write(JSON.stringify(a.map(x=>x.address)))})', host],
    {timeout: PROBE_TIMEOUT_MS, maxBuffer: 8192, encoding: 'utf8'}, (error, out, err) => {
      if (error) { reject(Object.assign(new Error('DNS failed'), {code: error.killed ? 'ETIMEDOUT' : err})); return; }
      try { resolve(JSON.parse(out).filter((address: string) => net.isIP(address)).slice(0, 16)); } catch (_) { reject(new Error('DNS unavailable')); }
    }));
  },
  tcp(address, port) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({host: address, port});
      const timer = setTimeout(() => socket.destroy(timeoutError()), PROBE_TIMEOUT_MS);
      socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(); });
      socket.once('error', error => { clearTimeout(timer); socket.destroy(); reject(error); });
    });
  },
  tls(address, port, hostname) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({host: address, port, servername: net.isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: true, checkServerIdentity: (_host, cert) => tls.checkServerIdentity(hostname, cert)});
      const timer = setTimeout(() => socket.destroy(timeoutError()), PROBE_TIMEOUT_MS);
      socket.once('secureConnect', () => { clearTimeout(timer); socket.destroy(); resolve(); });
      socket.once('error', error => { clearTimeout(timer); socket.destroy(); reject(error); });
    });
  },
  http(url, address) {
    return new Promise((resolve, reject) => {
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.request({hostname: address, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: '/v2/', method: 'GET', headers: {Host: url.host, Accept: 'application/json'},
        agent: false, maxHeaderSize: 16384, servername: net.isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: true, checkServerIdentity: (_host: string, cert: tls.PeerCertificate) => tls.checkServerIdentity(hostname, cert)}, response => {
        clearTimeout(timer);
        const result = {status: response.statusCode || 0,
          challenge: /^Bearer\s|^Basic\s/i.test(String(response.headers['www-authenticate'] || '')),
          registry: response.headers['docker-distribution-api-version'] === 'registry/2.0'};
        response.destroy(); request.destroy(); resolve(result);
      });
      const timer = setTimeout(() => request.destroy(timeoutError()), PROBE_TIMEOUT_MS);
      request.once('error', error => { clearTimeout(timer); request.destroy(); reject(error); });
      request.end();
    });
  }
};
