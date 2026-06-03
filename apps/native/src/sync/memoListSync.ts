import { Q } from "@nozbe/watermelondb";
import { api } from "@packages/backend/convex/_generated/api";
import {
  buildAlbumSyncPayload,
  buildListSyncPayload,
  buildMemoSyncPayload,
  mergeAlbumFields,
  mergeListFields,
  mergeMemoFields,
} from "@packages/shared";
import type { Album } from "../database/models/Album";
import type { List } from "../database/models/List";
import type { Memo } from "../database/models/Memo";

type MemoListDatabase = {
  collections: {
    get: (
      table: string
    ) => {
      query: (...conditions: unknown[]) => { fetch: () => Promise<any[]> };
      create: (recordBuilder: (record: any) => void) => Promise<any>;
    };
  };
  write: (writer: () => Promise<void>) => Promise<void>;
};

type ConvexClientLike = {
  mutation: (mutationRef: any, payload: Record<string, unknown>) => Promise<{
    serverId: string;
    serverRecord?: Record<string, unknown> | null;
    mergedFields?: Record<string, string>;
  }>;
};

export type MemoListSyncResult = {
  synced: Array<{ localId: string; serverId: string }>;
  errors: Array<{ localId: string; error: unknown }>;
};

function stringifyOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return "[]";
  }
}

function assignMemoFields(localMemo: Memo, record: Record<string, unknown>): void {
  const assignableFields: Array<keyof Memo & string> = ["familyId", "creatorId", "title", "content"];
  for (const field of assignableFields) {
    if (field in record && record[field] !== undefined) {
      (localMemo as unknown as Record<string, unknown>)[field] = record[field];
    }
  }
}

function assignListFields(localList: List, record: Record<string, unknown>): void {
  const assignableFields: Array<keyof List & string> = ["familyId", "creatorId", "title"];
  for (const field of assignableFields) {
    if (field in record && record[field] !== undefined) {
      (localList as unknown as Record<string, unknown>)[field] = record[field];
    }
  }

  if ("items" in record) {
    (localList as unknown as Record<string, unknown>).items = stringifyOrUndefined(record.items) ?? "[]";
  }
}

function assignAlbumFields(localAlbum: Album, record: Record<string, unknown>): void {
  const assignableFields: Array<keyof Album & string> = ["familyId", "creatorId", "name"];
  for (const field of assignableFields) {
    if (field in record && record[field] !== undefined) {
      (localAlbum as unknown as Record<string, unknown>)[field] = record[field];
    }
  }

  if ("photos" in record) {
    (localAlbum as unknown as Record<string, unknown>).photos = stringifyOrUndefined(record.photos) ?? "[]";
  }
}

export async function syncPendingMemos({
  db,
  convexClient,
}: {
  db: MemoListDatabase;
  convexClient: ConvexClientLike;
}): Promise<MemoListSyncResult> {
  const result: MemoListSyncResult = { synced: [], errors: [] };

  try {
    const deleted = (db.collections.get("memos") as any).deletedRecords || [];
    for (const record of deleted) {
      if (record.serverId) {
        try {
          await convexClient.mutation(api.memos.deleteMemo, { id: record.serverId, familyId: record.familyId });
        } catch (error) {
          console.warn("Server delete memo failed, will retry", error);
          continue;
        }
      }
      await record.destroyPermanently();
    }
  } catch (error) {
    console.warn("Deleted memos sync failed", error);
  }

  const memos = await db.collections
    .get("memos")
    .query(Q.or(Q.where("server_id", Q.eq(null)), Q.where("_status", Q.eq("updated"))))
    .fetch();

  for (const memo of memos) {
    try {
      const payload = buildMemoSyncPayload(memo as unknown as Record<string, unknown> & { id: string });
      const response = await convexClient.mutation(api.memos.syncMemo, payload as unknown as Record<string, unknown>);
      if (!response.serverId) {
        throw new Error(`Memo sync returned no serverId for local memo ${memo.id}`);
      }
      const serverRecord = response.serverRecord ?? { serverId: response.serverId };
      const { record } = mergeMemoFields(payload as unknown as Record<string, unknown>, serverRecord, payload.locallyChangedFields);

      await db.write(async () => {
        await memo.update((localMemo: Memo) => {
          localMemo.serverId = response.serverId;
          assignMemoFields(localMemo, record);
        });
      });

      result.synced.push({ localId: memo.id, serverId: response.serverId });
    } catch (error) {
      console.warn("Memo sync failed", { localId: memo.id, error });
      result.errors.push({ localId: memo.id, error });
    }
  }

  return result;
}

export async function syncPendingLists({
  db,
  convexClient,
}: {
  db: MemoListDatabase;
  convexClient: ConvexClientLike;
}): Promise<MemoListSyncResult> {
  const result: MemoListSyncResult = { synced: [], errors: [] };

  try {
    const deleted = (db.collections.get("lists") as any).deletedRecords || [];
    for (const record of deleted) {
      if (record.serverId) {
        try {
          await convexClient.mutation(api.memos.deleteList, { id: record.serverId, familyId: record.familyId });
        } catch (error) {
          console.warn("Server delete list failed, will retry", error);
          continue;
        }
      }
      await record.destroyPermanently();
    }
  } catch (error) {
    console.warn("Deleted lists sync failed", error);
  }

  const lists = await db.collections
    .get("lists")
    .query(Q.or(Q.where("server_id", Q.eq(null)), Q.where("_status", Q.eq("updated"))))
    .fetch();

  for (const list of lists) {
    try {
      const payload = buildListSyncPayload(list as unknown as Record<string, unknown> & { id: string });
      const response = await convexClient.mutation(api.memos.syncList, payload as unknown as Record<string, unknown>);
      if (!response.serverId) {
        throw new Error(`List sync returned no serverId for local list ${list.id}`);
      }
      const serverRecord = response.serverRecord ?? { serverId: response.serverId };
      const { record } = mergeListFields(payload as unknown as Record<string, unknown>, serverRecord, payload.locallyChangedFields);

      await db.write(async () => {
        await list.update((localList: List) => {
          localList.serverId = response.serverId;
          assignListFields(localList, record);
        });
      });

      result.synced.push({ localId: list.id, serverId: response.serverId });
    } catch (error) {
      console.warn("List sync failed", { localId: list.id, error });
      result.errors.push({ localId: list.id, error });
    }
  }

  return result;
}

export async function syncPendingAlbums({
  db,
  convexClient,
}: {
  db: MemoListDatabase;
  convexClient: ConvexClientLike;
}): Promise<MemoListSyncResult> {
  const result: MemoListSyncResult = { synced: [], errors: [] };

  try {
    const deleted = (db.collections.get("albums") as any).deletedRecords || [];
    for (const record of deleted) {
      if (record.serverId) {
        try {
          await convexClient.mutation(api.memos.deleteAlbum, { id: record.serverId, familyId: record.familyId });
        } catch (error) {
          console.warn("Server delete album failed, will retry", error);
          continue;
        }
      }
      await record.destroyPermanently();
    }
  } catch (error) {
    console.warn("Deleted albums sync failed", error);
  }

  const albums = await db.collections
    .get("albums")
    .query(Q.or(Q.where("server_id", Q.eq(null)), Q.where("_status", Q.eq("updated"))))
    .fetch();

  for (const album of albums) {
    try {
      const payload = buildAlbumSyncPayload(album as unknown as Record<string, unknown> & { id: string });
      const response = await convexClient.mutation(api.memos.syncAlbum, payload as unknown as Record<string, unknown>);
      if (!response.serverId) {
        throw new Error(`Album sync returned no serverId for local album ${album.id}`);
      }
      const serverRecord = response.serverRecord ?? { serverId: response.serverId };
      const { record } = mergeAlbumFields(payload as unknown as Record<string, unknown>, serverRecord, payload.locallyChangedFields);

      await db.write(async () => {
        await album.update((localAlbum: Album) => {
          localAlbum.serverId = response.serverId;
          assignAlbumFields(localAlbum, record);
        });
      });

      result.synced.push({ localId: album.id, serverId: response.serverId });
    } catch (error) {
      console.warn("Album sync failed", { localId: album.id, error });
      result.errors.push({ localId: album.id, error });
    }
  }

  return result;
}

export function startMemoListAutoSync(args: {
  db: MemoListDatabase;
  convexClient: ConvexClientLike;
}) {
  const NetInfo = require("@react-native-community/netinfo").default;
  let running = false;

  const maybeSync = async () => {
    if (running) return;
    running = true;
    try {
      await syncPendingMemos(args);
      await syncPendingLists(args);
      await syncPendingAlbums(args);
    } finally {
      running = false;
    }
  };

  const unsubscribe = NetInfo.addEventListener((state: any) => {
    // Keep it simple: on reconnection, attempt syncing pending changes.
    if (state?.isConnected) void maybeSync();
  });

  // Fetch initial connection status and run synchronization if online
  NetInfo.fetch().then((state: any) => {
    if (state?.isConnected) void maybeSync();
  });

  return () => unsubscribe();
}

export async function reconcileMemos(
  db: MemoListDatabase,
  serverMemos: any[],
  familyId: string
) {
  if (!serverMemos) return;
  const localMemos = await db.collections.get("memos").query(Q.where("family_id", familyId)).fetch();
  const localByServerId = new Map(localMemos.filter((m) => m.serverId).map((m) => [m.serverId, m]));
  const localByClientId = new Map(localMemos.map((m) => [m.id, m]));
  const serverIds = new Set(serverMemos.map((m) => m._id));

  await db.write(async () => {
    for (const serverMemo of serverMemos) {
      const serverId = serverMemo._id;
      const clientId = serverMemo.clientId;

      const localByServer = localByServerId.get(serverId);
      const localByClient = localByClientId.get(clientId);
      const localRecord = localByServer ?? localByClient;

      if (localRecord) {
        if (!localRecord.serverId) {
          await localRecord.update((rec: any) => {
            rec.serverId = serverId;
            assignMemoFields(rec, serverMemo);
            rec._raw._status = "synced";
          });
        } else {
          const status = localRecord._raw._status;
          if (status === "synced") {
            await localRecord.update((rec: any) => {
              assignMemoFields(rec, serverMemo);
            });
          }
        }
      } else {
        await db.collections.get("memos").create((rec: any) => {
          rec._raw.id = clientId;
          rec.serverId = serverId;
          assignMemoFields(rec, serverMemo);
          rec._raw._status = "synced";
        });
      }
    }

    for (const localMemo of localMemos) {
      if (localMemo.serverId && !serverIds.has(localMemo.serverId)) {
        await localMemo.destroyPermanently();
      }
    }
  });
}

export async function reconcileLists(
  db: MemoListDatabase,
  serverLists: any[],
  familyId: string
) {
  if (!serverLists) return;
  const localLists = await db.collections.get("lists").query(Q.where("family_id", familyId)).fetch();
  const localByServerId = new Map(localLists.filter((m) => m.serverId).map((m) => [m.serverId, m]));
  const localByClientId = new Map(localLists.map((m) => [m.id, m]));
  const serverIds = new Set(serverLists.map((m) => m._id));

  await db.write(async () => {
    for (const serverList of serverLists) {
      const serverId = serverList._id;
      const clientId = serverList.clientId;

      const localByServer = localByServerId.get(serverId);
      const localByClient = localByClientId.get(clientId);
      const localRecord = localByServer ?? localByClient;

      if (localRecord) {
        if (!localRecord.serverId) {
          await localRecord.update((rec: any) => {
            rec.serverId = serverId;
            assignListFields(rec, serverList);
            rec._raw._status = "synced";
          });
        } else {
          const status = localRecord._raw._status;
          if (status === "synced") {
            await localRecord.update((rec: any) => {
              assignListFields(rec, serverList);
            });
          }
        }
      } else {
        await db.collections.get("lists").create((rec: any) => {
          rec._raw.id = clientId;
          rec.serverId = serverId;
          assignListFields(rec, serverList);
          rec._raw._status = "synced";
        });
      }
    }

    for (const localList of localLists) {
      if (localList.serverId && !serverIds.has(localList.serverId)) {
        await localList.destroyPermanently();
      }
    }
  });
}

export async function reconcileAlbums(
  db: MemoListDatabase,
  serverAlbums: any[],
  familyId: string
) {
  if (!serverAlbums) return;
  const localAlbums = await db.collections.get("albums").query(Q.where("family_id", familyId)).fetch();
  const localByServerId = new Map(localAlbums.filter((m) => m.serverId).map((m) => [m.serverId, m]));
  const localByClientId = new Map(localAlbums.map((m) => [m.id, m]));
  const serverIds = new Set(serverAlbums.map((m) => m._id));

  await db.write(async () => {
    for (const serverAlbum of serverAlbums) {
      const serverId = serverAlbum._id;
      const clientId = serverAlbum.clientId;

      const localByServer = localByServerId.get(serverId);
      const localByClient = localByClientId.get(clientId);
      const localRecord = localByServer ?? localByClient;

      if (localRecord) {
        if (!localRecord.serverId) {
          await localRecord.update((rec: any) => {
            rec.serverId = serverId;
            assignAlbumFields(rec, serverAlbum);
            rec._raw._status = "synced";
          });
        } else {
          const status = localRecord._raw._status;
          if (status === "synced") {
            await localRecord.update((rec: any) => {
              assignAlbumFields(rec, serverAlbum);
            });
          }
        }
      } else {
        await db.collections.get("albums").create((rec: any) => {
          rec._raw.id = clientId;
          rec.serverId = serverId;
          assignAlbumFields(rec, serverAlbum);
          rec._raw._status = "synced";
        });
      }
    }

    for (const localAlbum of localAlbums) {
      if (localAlbum.serverId && !serverIds.has(localAlbum.serverId)) {
        await localAlbum.destroyPermanently();
      }
    }
  });
}

