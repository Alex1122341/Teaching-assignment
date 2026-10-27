'use strict';
// Browser stand-in for node:crypto, covering what the PAWS server modules use.
const { sha256Bytes, toHex } = require('../ids.js');
const { Buffer } = require('buffer');
const bytesOf = value => typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
function concat(parts) { const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
function encode(bytes, encoding) {
  const b = Buffer.from(bytes);
  if (!encoding) return b;
  if (encoding === 'hex') return toHex(bytes);
  if (encoding === 'base64') return b.toString('base64');
  if (encoding === 'base64url') return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b.toString(encoding);
}
function createHash(algorithm) {
  if (String(algorithm).toLowerCase() !== 'sha256') throw new Error(`Unsupported hash in the Frontend Demo: ${algorithm}`);
  const parts = [];
  return { update(value, enc) { parts.push(enc && typeof value === 'string' ? Buffer.from(value, enc) : bytesOf(value)); return this; }, digest(encoding) { return encode(sha256Bytes(concat(parts)), encoding); } };
}
function createHmac(algorithm, key) {
  if (String(algorithm).toLowerCase() !== 'sha256') throw new Error(`Unsupported HMAC in the Frontend Demo: ${algorithm}`);
  let k = bytesOf(key); if (k.length > 64) k = sha256Bytes(k);
  const block = new Uint8Array(64); block.set(k);
  const inner = block.map(b => b ^ 0x36), outer = block.map(b => b ^ 0x5c), parts = [];
  return { update(value) { parts.push(bytesOf(value)); return this; }, digest(encoding) { return encode(sha256Bytes(concat([outer, sha256Bytes(concat([inner, ...parts]))])), encoding); } };
}
const randomBytes = n => { const out = new Uint8Array(n); globalThis.crypto.getRandomValues(out); return Buffer.from(out); };
const randomUUID = () => globalThis.crypto.randomUUID();
function timingSafeEqual(a, b) { if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length'); let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
module.exports = { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual, webcrypto: globalThis.crypto };
