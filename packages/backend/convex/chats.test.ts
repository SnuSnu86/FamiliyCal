import { checkStorageQuota } from "./chats";
import { ConvexError } from "convex/values";

describe("checkStorageQuota", () => {
  let mockDb: any;
  let mockStorage: any;
  let mockCtx: any;

  beforeEach(() => {
    const mockQuery = {
      withIndex: jest.fn().mockReturnThis(),
      filter: jest.fn().mockReturnThis(),
      collect: jest.fn().mockResolvedValue([]),
      first: jest.fn().mockResolvedValue(null),
    };
    mockDb = {
      get: jest.fn(),
      patch: jest.fn(),
      query: jest.fn().mockReturnValue(mockQuery),
      system: {
        get: jest.fn().mockResolvedValue({ size: 200 }),
      },
    };
    mockStorage = {
      delete: jest.fn(),
      getMetadata: jest.fn(),
    };
    mockCtx = {
      db: mockDb,
      storage: mockStorage,
    };
  });

  test("does nothing if storageId is undefined", async () => {
    await checkStorageQuota(mockCtx, {}, "family_1", undefined, 100);
    expect(mockDb.get).not.toHaveBeenCalled();
    expect(mockDb.patch).not.toHaveBeenCalled();
    expect(mockStorage.delete).not.toHaveBeenCalled();
  });

  test("successfully updates storage if within quota and user limits", async () => {
    mockDb.get.mockResolvedValue({
      _id: "family_1",
      storageQuota: 1000,
      storageUsed: 500,
    });

    await checkStorageQuota(mockCtx, { storageLimit: 300 }, "family_1", "storage_1", 200);

    expect(mockDb.get).toHaveBeenCalledWith("family_1");
    expect(mockDb.patch).toHaveBeenCalledWith("family_1", { storageUsed: 700 });
    expect(mockStorage.delete).not.toHaveBeenCalled();
  });

  test("throws STORAGE_LIMIT_EXCEEDED and deletes file when family quota is exceeded", async () => {
    mockDb.get.mockResolvedValue({
      _id: "family_1",
      storageQuota: 1000,
      storageUsed: 900,
    });

    try {
      await checkStorageQuota(mockCtx, { storageLimit: 300 }, "family_1", "storage_1", 200);
      throw new Error("Should have thrown STORAGE_LIMIT_EXCEEDED");
    } catch (error: any) {
      expect(error).toBeInstanceOf(ConvexError);
      expect(error.data.code).toBe("STORAGE_LIMIT_EXCEEDED");
    }

    expect(mockDb.get).toHaveBeenCalledWith("family_1");
    expect(mockStorage.delete).toHaveBeenCalledWith("storage_1");
    expect(mockDb.patch).not.toHaveBeenCalled();
  });

  test("throws USER_LIMIT_EXCEEDED and deletes file when user limit is exceeded", async () => {
    mockDb.get.mockResolvedValue({
      _id: "family_1",
      storageQuota: 1000,
      storageUsed: 500,
    });

    try {
      await checkStorageQuota(mockCtx, { storageLimit: 100 }, "family_1", "storage_1", 200);
      throw new Error("Should have thrown USER_LIMIT_EXCEEDED");
    } catch (error: any) {
      expect(error).toBeInstanceOf(ConvexError);
      expect(error.data.code).toBe("USER_LIMIT_EXCEEDED");
    }

    expect(mockDb.get).toHaveBeenCalledWith("family_1");
    expect(mockStorage.delete).toHaveBeenCalledWith("storage_1");
    expect(mockDb.patch).not.toHaveBeenCalled();
  });
});
