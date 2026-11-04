'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),tls=require('node:tls');
const provenance=require('./provenance.json');
const denied=new Set(provenance.distrustedSha256);
function certificates(value){const result=value.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);if(!result?.length)throw Error('ca-certificates-required');return result;}
function check(values){
  if(!values.length)throw Error('ca-certificates-required');
  for(const value of values){const certificate=new crypto.X509Certificate(value);if(denied.has(certificate.fingerprint256.replaceAll(':','')))throw Error('ca-distrusted-certificate');}
  return values.length;
}
function system(){
  const file=process.env.SSL_CERT_FILE||'/etc/ssl/certs/ca-certificates.crt';
  const flags=[...(process.env.NODE_OPTIONS||'').split(/\s+/),...process.execArgv];
  if(!flags.includes('--use-openssl-ca')||flags.includes('--use-bundled-ca')||flags.includes('--use-system-ca'))throw Error('ca-node-openssl-mode-required');
  // Node's default list is empty in OpenSSL mode. Inspect the actual system
  // anchors instead; inspecting tls.rootCertificates would test unused builtins.
  const anchors=tls.getCACertificates('system'),extra=tls.getCACertificates('extra');
  if(extra.length)check(extra);
  return {systemCertificates:check(certificates(fs.readFileSync(file,'utf8'))),nodeCertificates:check(anchors),nodeCaMode:'openssl',bundleSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
}
module.exports={certificates,check,system,provenance};
if(require.main===module){try{console.log(JSON.stringify(system()));}catch(error){console.error(error.message);process.exitCode=1;}}
