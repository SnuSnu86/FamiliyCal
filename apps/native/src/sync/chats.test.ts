import { checkStorageQuota } from "../../../../packages/backend/convex/chats";

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
    };
    mockStorage = {
      delete: jest.fn(),
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

    await checkStorageQuota(mockCtx, { clerkId: "user_1", storageLimit: 300 }, "family_1", "storage_1", 200);

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

    await expect(
      checkStorageQuota(mockCtx, { clerkId: "user_1", storageLimit: 300 }, "family_1", "storage_1", 200)
    ).rejects.toMatchObject({ data: expect.objectContaining({ code: "STORAGE_LIMIT_EXCEEDED" }) });

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

    await expect(
      checkStorageQuota(mockCtx, { clerkId: "user_1", storageLimit: 100 }, "family_1", "storage_1", 200)
    ).rejects.toMatchObject({ data: expect.objectContaining({ code: "USER_LIMIT_EXCEEDED" }) });

    expect(mockDb.get).toHaveBeenCalledWith("family_1");
    expect(mockStorage.delete).toHaveBeenCalledWith("storage_1");
    expect(mockDb.patch).not.toHaveBeenCalled();
  });

  test("checks existing user usage plus the new file size", async () => {
    const chatQuery = {
      withIndex: jest.fn().mockReturnThis(),
      collect: jest.fn().mockResolvedValue([{ fileSize: 90 }]),
    };
    const albumQuery = {
      withIndex: jest.fn().mockReturnThis(),
      collect: jest.fn().mockResolvedValue([]),
    };
    const allAlbumsQuery = {
      collect: jest.fn().mockResolvedValue([]),
    };

    mockDb.get.mockResolvedValue({
      _id: "family_1",
      storageQuota: 1000,
      storageUsed: 100,
    });
    mockDb.query
      .mockReturnValueOnce(chatQuery)
      .mockReturnValueOnce(albumQuery)
      .mockReturnValueOnce(allAlbumsQuery)
      .mockReturnValueOnce({ filter: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({ collect: jest.fn().mockResolvedValue([]) });

    await expect(
      checkStorageQuota(mockCtx, { clerkId: "user_1", storageLimit: 100 }, "family_1", "storage_1", 20)
    ).rejects.toMatchObject({ data: expect.objectContaining({ code: "USER_LIMIT_EXCEEDED" }) });
  });
});
