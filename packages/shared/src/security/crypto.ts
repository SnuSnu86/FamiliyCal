const MASTER_KEY_BYTES = 32;
const PBKDF2_ITERATIONS = 600_000;
const AES_GCM_IV_BYTES = 12;

function getCrypto(): Crypto {
  const cryptoImpl = globalThis.crypto;
  if (!cryptoImpl?.subtle || !cryptoImpl.getRandomValues) {
    throw new Error("Web Crypto API is required for E2EE key operations");
  }
  return cryptoImpl;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function computeKeyFingerprint(publicKeyString: string): Promise<string> {
  const { sha256 } = await import("@noble/hashes/sha2.js");
  return bytesToHex(sha256(utf8Bytes(publicKeyString)));
}

// Out-of-band verification compares public keys by value. JWK serialization is
// NOT canonical across platforms/libraries (field order, optional members like
// ext/key_ops/alg, base64url padding), so a raw string `===` on the JSON can
// reject two honest devices that hold the *same* key. The EC public point
// (crv + x + y, base64url per the JWK spec) uniquely identifies a P-256 key, so
// we canonicalize on those coordinates and compare canonical forms everywhere a
// key equality check feeds an MitM decision.
export function canonicalizePublicKey(serializedPublicKey: string): string {
  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(serializedPublicKey) as JsonWebKey;
  } catch {
    throw new Error("Public key is not valid JSON and cannot be canonicalized");
  }
  if (jwk.kty !== "EC" || !jwk.crv || !jwk.x || !jwk.y) {
    throw new Error("Unsupported public key format for canonicalization");
  }
  return `${jwk.crv}:${jwk.x}:${jwk.y}`;
}

// Convenience for sinks that want a boolean equality without try/catch noise.
// Returns false if either side is missing or unparseable (fail-closed: an
// unparseable key never counts as a match).
export function publicKeysMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  try {
    return canonicalizePublicKey(a) === canonicalizePublicKey(b);
  } catch {
    return false;
  }
}

async function importAesGcmKey(masterKey: Uint8Array): Promise<CryptoKey> {
  if (masterKey.byteLength !== MASTER_KEY_BYTES) {
    throw new Error("Master key must be 32 bytes for AES-GCM-256");
  }
  return getCrypto().subtle.importKey("raw", masterKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function generateRandomSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  getCrypto().getRandomValues(salt);
  return salt;
}

export function encodeBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}

export function decodeBase64(value: string): Uint8Array {
  return base64ToBytes(value);
}

export async function deriveMasterKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  if (salt.byteLength !== 16) throw new Error("Salt must be 16 bytes");
  const [{ pbkdf2Async }, { sha256 }] = await Promise.all([
    import("@noble/hashes/pbkdf2.js"),
    import("@noble/hashes/sha2.js"),
  ]);
  return pbkdf2Async(sha256, utf8Bytes(passphrase), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: MASTER_KEY_BYTES,
  });
}

export async function generateE2EKeyPair(): Promise<CryptoKeyPair> {
  return getCrypto().subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"],
  ) as Promise<CryptoKeyPair>;
}

export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const jwk = await getCrypto().subtle.exportKey("jwk", publicKey);
  return JSON.stringify(jwk);
}

export async function importPublicKey(serializedPublicKey: string): Promise<CryptoKey> {
  const jwk = JSON.parse(serializedPublicKey) as JsonWebKey;
  return getCrypto().subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

export async function importPrivateKey(serializedPrivateKey: string): Promise<CryptoKey> {
  const jwk = JSON.parse(serializedPrivateKey) as JsonWebKey;
  return getCrypto().subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
}

// Out-of-band verification must attest to the key material the device actually
// holds, not a value fetched from the (potentially compromised) server. We
// reconstruct the public key from the locally stored private JWK and serialize
// it through the same exportPublicKey path that produced the uploaded key, so
// the string is byte-identical to the honest server copy on the same platform.
export async function derivePublicKeyFromPrivate(serializedPrivateKey: string): Promise<string> {
  const jwk = JSON.parse(serializedPrivateKey) as JsonWebKey;
  const publicJwk: JsonWebKey = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true, key_ops: [] };
  const publicKey = await getCrypto().subtle.importKey("jwk", publicJwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
  return exportPublicKey(publicKey);
}

export async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  return getCrypto().subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptMessage(payload: string, aesKey: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const cryptoImpl = getCrypto();
  const iv = new Uint8Array(AES_GCM_IV_BYTES);
  cryptoImpl.getRandomValues(iv);
  const encrypted = await cryptoImpl.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, utf8Bytes(payload));
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptMessage(ciphertext: string, iv: string, aesKey: CryptoKey): Promise<string> {
  const decrypted = await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    aesKey,
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

export async function encryptPrivateKey(
  privateKey: CryptoKey,
  masterKey: Uint8Array,
): Promise<{ ciphertext: string; iv: string }> {
  const cryptoImpl = getCrypto();
  const iv = new Uint8Array(AES_GCM_IV_BYTES);
  cryptoImpl.getRandomValues(iv);

  const jwk = await cryptoImpl.subtle.exportKey("jwk", privateKey);
  const plaintext = utf8Bytes(JSON.stringify(jwk));
  const aesKey = await importAesGcmKey(masterKey);
  const encrypted = await cryptoImpl.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext);

  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptPrivateKey(ciphertext: string, iv: string, masterKey: Uint8Array): Promise<CryptoKey> {
  const cryptoImpl = getCrypto();
  const aesKey = await importAesGcmKey(masterKey);
  const decrypted = await cryptoImpl.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    aesKey,
    base64ToBytes(ciphertext),
  );
  const jwk = JSON.parse(new TextDecoder().decode(decrypted)) as JsonWebKey;
  return cryptoImpl.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
}
