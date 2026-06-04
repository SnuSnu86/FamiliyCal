import { strict as assert } from "node:assert";
import { describe, expect, test } from "@jest/globals";
import { ConvexError } from "convex/values";
import {
  CAREGIVER_PIN_TTL_MS,
  assertCanManageCaregiverPins,
  createCaregiverPinRecord,
  deleteFamilyPins,
  isActiveCaregiverPin,
  validateCaregiverPinRecord,
} from "./caregiverPins";

const familyId = "family_1";
const owner = { role: "ROLE-001", familyId };
const parent = { role: "ROLE-002", familyId };
const member = { role: "ROLE-003", familyId };
const child = { role: "ROLE-004", familyId };
const caregiver = { role: "ROLE-005", familyId };

function assertThrowsConvexError(fn: () => void, message: string) {
  try {
    fn();
    throw new Error("Expected ConvexError");
  } catch (error) {
    assert(error instanceof ConvexError, message);
  }
}

describe("caregiverPins", () => {
  test("allows only family owners and parents with a family", () => {
    assert.doesNotThrow(() => assertCanManageCaregiverPins(owner), "ROLE-001 may manage caregiver PINs");
    assert.doesNotThrow(() => assertCanManageCaregiverPins(parent), "ROLE-002 may manage caregiver PINs");
    assertThrowsConvexError(
      () => assertCanManageCaregiverPins(member),
      "ROLE-003 must not manage caregiver PINs",
    );
    assertThrowsConvexError(
      () => assertCanManageCaregiverPins(child),
      "ROLE-004 must not manage caregiver PINs",
    );
    assertThrowsConvexError(
      () => assertCanManageCaregiverPins(caregiver),
      "ROLE-005 must not manage caregiver PINs",
    );
    assertThrowsConvexError(
      () => assertCanManageCaregiverPins({ role: "ROLE-001" }),
      "users without a family must not manage caregiver PINs",
    );
  });

  test("creates six-digit PIN records with an exact 10-minute expiry", () => {
    const now = 1_000;
    const record = createCaregiverPinRecord({
      familyId,
      creatorId: "user_1",
      now,
      random: () => 0,
    });

    expect(record.pin).toBe("100000");
    expect(record.expiresAt).toBe(now + CAREGIVER_PIN_TTL_MS);
    expect(record.familyId).toBe(familyId);
    expect(record.creatorId).toBe("user_1");
    expect(isActiveCaregiverPin({ expiresAt: now + 1 }, now)).toBe(true);
    expect(isActiveCaregiverPin({ expiresAt: now }, now)).toBe(false);
  });

  test("deletes previous family PINs before regeneration", async () => {
    const deletedIds: string[] = [];
    await deleteFamilyPins(
      {
        db: {
          query: (table: string) => {
            expect(table).toBe("caregiverPins");
            return {
              withIndex: (index: string, build: (q: { eq: (field: string, value: string) => void }) => void) => {
                expect(index).toBe("by_familyId");
                build({
                  eq: (field, value) => {
                    expect(field).toBe("familyId");
                    expect(value).toBe(familyId);
                  },
                });
                return {
                  collect: async () => [{ _id: "pin_1" }, { _id: "pin_2" }],
                };
              },
            };
          },
          delete: async (id: string) => {
            deletedIds.push(id);
          },
        },
      } as any,
      familyId,
    );

    expect(deletedIds).toEqual(["pin_1", "pin_2"]);
  });

  test("validates an active PIN and returns family information", () => {
    const result = validateCaregiverPinRecord(
      {
        pin: "123456",
        familyId,
        expiresAt: 2_000,
        familyName: "Muster",
      },
      1_000,
    );

    expect(result).toEqual({
      valid: true,
      familyId,
      familyName: "Muster",
      role: "ROLE-005",
    });
  });

  test("rejects an expired PIN", () => {
    const result = validateCaregiverPinRecord(
      {
        pin: "123456",
        familyId,
        expiresAt: 1_000,
        familyName: "Muster",
      },
      1_000,
    );

    expect(result).toEqual({ valid: false, error: "PIN ist abgelaufen." });
  });

  test("rejects a missing PIN record", () => {
    expect(validateCaregiverPinRecord(null, 1_000)).toEqual({
      valid: false,
      error: "PIN wurde nicht gefunden.",
    });
  });
});
