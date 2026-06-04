import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  decryptMessage,
  decryptPrivateKey,
  deriveMasterKey,
  deriveSharedSecret,
  encryptMessage,
  encryptPrivateKey,
  exportPublicKey,
  generateE2EKeyPair,
  importPublicKey,
} from "./crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

async function testDeriveMasterKey() {
  const salt = new Uint8Array(16).fill(7);
  const key = await deriveMasterKey("Str0ng!Passphrase", salt);
  const keyAgain = await deriveMasterKey("Str0ng!Passphrase", salt);
  assert.equal(key.byteLength, 32);
  assert.deepEqual(key, keyAgain);
}

async function testGenerateE2EKeyPairAndExportPublicKey() {
  const pair = await generateE2EKeyPair();
  assert.equal(pair.privateKey.type, "private");
  assert.equal(pair.publicKey.type, "public");
  const publicJwk = JSON.parse(await exportPublicKey(pair.publicKey));
  assert.equal(publicJwk.kty, "EC");
  assert.equal(publicJwk.crv, "P-256");
}

async function testEncryptDecryptMessageWithSharedSecret() {
  const alice = await generateE2EKeyPair();
  const bob = await generateE2EKeyPair();
  const bobPublicKey = await importPublicKey(await exportPublicKey(bob.publicKey));
  const aliceSecret = await deriveSharedSecret(alice.privateKey, bobPublicKey);
  const bobSecret = await deriveSharedSecret(bob.privateKey, alice.publicKey);

  const encrypted = await encryptMessage("Geheime Familiennachricht 🔒", aliceSecret);
  assert.match(encrypted.ciphertext, /^[A-Za-z0-9+/]+=*$/);
  assert.match(encrypted.iv, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(new Uint8Array(Buffer.from(encrypted.iv, "base64")).byteLength, 12);
  assert.notEqual(encrypted.ciphertext, "Geheime Familiennachricht 🔒");

  const decrypted = await decryptMessage(encrypted.ciphertext, encrypted.iv, bobSecret);
  assert.equal(decrypted, "Geheime Familiennachricht 🔒");
}

async function testDecryptMessageRejectsWrongSharedSecret() {
  const alice = await generateE2EKeyPair();
  const bob = await generateE2EKeyPair();
  const mallory = await generateE2EKeyPair();
  const aliceSecret = await deriveSharedSecret(alice.privateKey, bob.publicKey);
  const wrongSecret = await deriveSharedSecret(mallory.privateKey, bob.publicKey);
  const encrypted = await encryptMessage("Nicht für Mallory", aliceSecret);

  await assert.rejects(() => decryptMessage(encrypted.ciphertext, encrypted.iv, wrongSecret));
}

async function testEncryptDecryptPrivateKey() {
  const pair = await generateE2EKeyPair();
  const masterKey = await deriveMasterKey("An0ther!StrongPassphrase", new Uint8Array(16).fill(3));
  const encrypted = await encryptPrivateKey(pair.privateKey, masterKey);
  assert.match(encrypted.ciphertext, /^[A-Za-z0-9+/]+=*$/);
  assert.match(encrypted.iv, /^[A-Za-z0-9+/]+=*$/);
  assert.notEqual(encrypted.ciphertext, encrypted.iv);

  const decrypted = await decryptPrivateKey(encrypted.ciphertext, encrypted.iv, masterKey);
  assert.equal(decrypted.type, "private");
  const originalJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const restoredJwk = await crypto.subtle.exportKey("jwk", decrypted);
  assert.equal(restoredJwk.d, originalJwk.d);
  assert.equal(restoredJwk.crv, "P-256");
}

await testDeriveMasterKey();
await testGenerateE2EKeyPairAndExportPublicKey();
await testEncryptDecryptPrivateKey();
await testEncryptDecryptMessageWithSharedSecret();
await testDecryptMessageRejectsWrongSharedSecret();
console.log("crypto tests passed");
