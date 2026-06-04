import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

export type CaregiverSessionPayload = {
  familyId: string;
  role: "ROLE-005" | "ROLE-006";
  familyName?: string;
};

type CaregiverSessionToken = CaregiverSessionPayload & {
  exp: number;
};

function getSessionSecret() {
  const secret = process.env.CAREGIVER_SESSION_SECRET;
  if (!secret) throw new Error("CAREGIVER_SESSION_SECRET is required");
  return secret;
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

export function signToken(payload: CaregiverSessionPayload) {
  const tokenPayload: CaregiverSessionToken = {
    ...payload,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = encode(tokenPayload);
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string): CaregiverSessionPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CaregiverSessionToken;
    if (!payload.familyId || !payload.role || payload.exp <= Date.now()) return null;
    if (payload.role !== "ROLE-005" && payload.role !== "ROLE-006") return null;
    return {
      familyId: payload.familyId,
      role: payload.role,
      familyName: payload.familyName,
    };
  } catch {
    return null;
  }
}
