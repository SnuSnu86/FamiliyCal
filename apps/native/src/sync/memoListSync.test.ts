import { syncPendingAlbums, syncPendingLists, syncPendingMemos } from "./memoListSync";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function createMemo(overrides: Record<string, unknown> = {}) {
  const memo = {
    id: "local_memo_1",
    serverId: undefined,
    familyId: "fam_1",
    creatorId: "user_1",
    title: "Memo",
    content: "Text",
    _raw: { _status: "created", _changed: "" },
    update: async (updater: (memo: any) => void) => updater(memo),
    ...overrides,
  } as any;
  return memo;
}

function createList(overrides: Record<string, unknown> = {}) {
  const list = {
    id: "local_list_1",
    serverId: undefined,
    familyId: "fam_1",
    creatorId: "user_1",
    title: "Liste",
    items: JSON.stringify([{ text: "Milch", completed: false }]),
    _raw: { _status: "updated", _changed: "items" },
    update: async (updater: (list: any) => void) => updater(list),
    ...overrides,
  } as any;
  return list;
}

function createAlbum(overrides: Record<string, unknown> = {}) {
  const album = {
    id: "local_album_1",
    serverId: undefined,
    familyId: "fam_1",
    creatorId: "user_1",
    name: "Album",
    photos: JSON.stringify([{ storageId: "s1", fileSize: 123, uploadedAt: 1 }]),
    _raw: { _status: "updated", _changed: "photos" },
    update: async (updater: (album: any) => void) => updater(album),
    ...overrides,
  } as any;
  return album;
}

function createDb(args: { memos?: any[]; lists?: any[]; albums?: any[] }) {
  const memos = args.memos ?? [];
  const lists = args.lists ?? [];
  const albums = args.albums ?? [];

  return {
    collections: {
      get: (table: string) => ({
        query: () => ({
          fetch: async () => {
            if (table === "memos") return memos.filter((m) => !m.serverId || m._raw?._status === "updated");
            if (table === "lists") return lists.filter((l) => !l.serverId || l._raw?._status === "updated");
            if (table === "albums") return albums.filter((a) => !a.serverId || a._raw?._status === "updated");
            return [];
          },
        }),
      }),
    },
    write: async (writer: () => Promise<void>) => writer(),
  } as any;
}

test("memo sync writes server_id and keeps local id", async () => {
  const memo = createMemo();
  const convexClient = {
    mutation: async (_mutationRef: unknown, payload: any) => {
      assert(payload.clientId === "local_memo_1", "payload should include idempotency clientId");
      return { serverId: "server_memo_1", serverRecord: { ...payload, serverId: "server_memo_1" } };
    },
  };

  const result = await syncPendingMemos({ db: createDb({ memos: [memo] }), convexClient: convexClient as any });
  assert(result.synced.length === 1, "one memo should sync");
  assert(memo.serverId === "server_memo_1", "server_id should be written locally");
  assert(memo.id === "local_memo_1", "local WatermelonDB id should not be replaced");
});

test("list sync stringifies merged items back to local model", async () => {
  const list = createList();
  const convexClient = {
    mutation: async (_mutationRef: unknown, payload: any) => {
      assert(Array.isArray(payload.items), "payload items should be an array");
      return { serverId: "server_list_1", serverRecord: { ...payload, serverId: "server_list_1", items: payload.items } };
    },
  };

  const result = await syncPendingLists({ db: createDb({ lists: [list] }), convexClient: convexClient as any });
  assert(result.synced.length === 1, "one list should sync");
  assert(list.serverId === "server_list_1", "server_id should be written locally");
  assert(typeof list.items === "string", "local list items should remain JSON string");
  const parsed = JSON.parse(list.items);
  assert(Array.isArray(parsed) && parsed.length === 1, "items should be a JSON array after sync");
});

test("album sync stringifies merged photos back to local model", async () => {
  const album = createAlbum();
  const convexClient = {
    mutation: async (_mutationRef: unknown, payload: any) => {
      assert(Array.isArray(payload.photos), "payload photos should be an array");
      return { serverId: "server_album_1", serverRecord: { ...payload, serverId: "server_album_1", photos: payload.photos } };
    },
  };

  const result = await syncPendingAlbums({ db: createDb({ albums: [album] }), convexClient: convexClient as any });
  assert(result.synced.length === 1, "one album should sync");
  assert(album.serverId === "server_album_1", "server_id should be written locally");
  assert(typeof album.photos === "string", "local album photos should remain JSON string");
  const parsed = JSON.parse(album.photos);
  assert(Array.isArray(parsed) && parsed.length === 1, "photos should be a JSON array after sync");
});

