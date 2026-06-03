import { Q } from "@nozbe/watermelondb";
import withObservables from "@nozbe/with-observables";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useConvex, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";

import { database } from "../database";
import type { Album } from "../database/models/Album";
import type { List } from "../database/models/List";
import type { Memo } from "../database/models/Memo";
import { useFamilyId } from "../hooks/useFamilyId";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import {
  syncPendingAlbums,
  syncPendingLists,
  syncPendingMemos,
  reconcileMemos,
  reconcileLists,
  reconcileAlbums,
} from "../sync/memoListSync";

type TabKey = "memos" | "lists" | "albums";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "memos", label: "Memos" },
  { key: "lists", label: "Listen" },
  { key: "albums", label: "Alben" },
];

type Props = {
  familyId: string;
  memos: Memo[];
  lists: List[];
  albums: Album[];
};

function safeJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function StorageBar({ familyId }: { familyId: string }) {
  const status = useQuery(api.memos.getStorageStatus, { familyId: familyId as any });
  const quota = status?.storageQuota ?? 0;
  const used = status?.storageUsed ?? 0;
  const percent = quota > 0 ? Math.min(1, used / quota) : 0;

  return (
    <View style={styles.storageCard}>
      <Text style={styles.storageTitle}>Speicher</Text>
      <Text style={styles.storageMeta}>
        {formatBytes(used)} / {formatBytes(quota)}
        {status?.userStorageLimit ? ` · Limit: ${formatBytes(status.userStorageLimit)}` : ""}
      </Text>
      <View style={styles.storageTrack}>
        <View style={[styles.storageFill, { width: `${Math.round(percent * 100)}%` }]} />
      </View>
    </View>
  );
}

function SwipeToDeleteCard({
  title,
  subtitle,
  faded,
  onDelete,
  children,
}: {
  title: string;
  subtitle?: string;
  faded: boolean;
  onDelete: () => void;
  children?: React.ReactNode;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(faded ? 0.6 : 1.0)).current;
  const threshold = -80;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: faded ? 0.6 : 1.0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [faded, opacity]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 10 && Math.abs(gesture.dy) < 10,
        onPanResponderMove: (_, gesture) => {
          const dx = Math.min(0, gesture.dx);
          translateX.setValue(dx);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx < threshold) {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
            Alert.alert("Memo löschen?", "Möchtest du dieses Memo wirklich löschen?", [
              { text: "Abbrechen", style: "cancel" },
              { text: "Löschen", style: "destructive", onPress: onDelete },
            ]);
            return;
          }
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [onDelete, translateX]
  );

  return (
    <Animated.View style={[styles.card, { opacity, transform: [{ translateX }] }]} {...panResponder.panHandlers}>
      <Text style={styles.cardTitle}>{title}</Text>
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      {children}
      <Text style={styles.cardHint}>Wische nach links zum Löschen</Text>
    </Animated.View>
  );
}

function MemosScreen({ familyId, memos, lists, albums }: Props) {
  const convexClient = useConvex();
  const isOnline = useNetworkStatus();
  const [tab, setTab] = useState<TabKey>("memos");
  const isSyncingRef = useRef(false);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);

  // Subscribe to Convex queries
  const serverMemos = useQuery(api.memos.listMemos, { familyId: familyId as any });
  const serverLists = useQuery(api.memos.listLists, { familyId: familyId as any });
  const serverAlbums = useQuery(api.memos.listAlbums, { familyId: familyId as any });

  // Reconcile server data to WatermelonDB
  useEffect(() => {
    if (isOnline && serverMemos) {
      reconcileMemos(database as any, serverMemos, familyId).catch((err) =>
        console.warn("Reconcile memos failed", err)
      );
    }
  }, [isOnline, serverMemos, familyId]);

  useEffect(() => {
    if (isOnline && serverLists) {
      reconcileLists(database as any, serverLists, familyId).catch((err) =>
        console.warn("Reconcile lists failed", err)
      );
    }
  }, [isOnline, serverLists, familyId]);

  useEffect(() => {
    if (isOnline && serverAlbums) {
      reconcileAlbums(database as any, serverAlbums, familyId).catch((err) =>
        console.warn("Reconcile albums failed", err)
      );
    }
  }, [isOnline, serverAlbums, familyId]);

  // Sync-up trigger helper
  const triggerSync = () => {
    if (!isOnline || isSyncingRef.current) return;
    isSyncingRef.current = true;
    Promise.all([
      syncPendingMemos({ db: database as any, convexClient }),
      syncPendingLists({ db: database as any, convexClient }),
      syncPendingAlbums({ db: database as any, convexClient }),
    ])
      .catch((error) => console.warn("Background sync failed", error))
      .finally(() => {
        isSyncingRef.current = false;
      });
  };

  // Run synchronization on connect or mount
  useEffect(() => {
    triggerSync();
  }, [isOnline]);

  const createMemo = async () => {
    const title = draftTitle.trim();
    if (!title) return Alert.alert("Hinweis", "Bitte gib mindestens einen Titel ein.");

    await database.write(async () => {
      if (editingMemoId) {
        const memo = memos.find((m) => m.id === editingMemoId);
        if (memo) {
          await memo.update((record: any) => {
            record.title = title;
            record.content = draftContent.trim();
          });
        }
      } else {
        await database.collections.get("memos").create((memo: any) => {
          memo.familyId = familyId;
          memo.creatorId = "local";
          memo.title = title;
          memo.content = draftContent.trim();
        });
      }
    });

    setDraftTitle("");
    setDraftContent("");
    setEditingMemoId(null);
    triggerSync();
  };

  const deleteMemoLocal = async (memo: Memo) => {
    await database.write(async () => {
      await memo.markAsDeleted();
    });
    triggerSync();
  };

  const startEditMemo = (memo: Memo) => {
    setDraftTitle(memo.title);
    setDraftContent(memo.content);
    setEditingMemoId(memo.id);
  };

  const createList = async () => {
    await database.write(async () => {
      await database.collections.get("lists").create((list: any) => {
        list.familyId = familyId;
        list.creatorId = "local";
        list.title = "Einkaufsliste";
        list.items = "[]";
      });
    });
    triggerSync();
  };

  const toggleListItem = async (list: List, index: number) => {
    const items = safeJsonArray((list as any).items);
    if (!items[index]) return;
    items[index] = { ...items[index], completed: !items[index].completed };
    await database.write(async () => {
      await list.update((record: any) => {
        record.items = JSON.stringify(items);
      });
    });
    triggerSync();
  };

  const addListItem = async (list: List, text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const items = safeJsonArray((list as any).items);
    items.push({ text: clean, completed: false });
    await database.write(async () => {
      await list.update((record: any) => {
        record.items = JSON.stringify(items);
      });
    });
    triggerSync();
  };

  const createAlbum = async () => {
    await database.write(async () => {
      await database.collections.get("albums").create((album: any) => {
        album.familyId = familyId;
        album.creatorId = "local";
        album.name = "Album";
        album.photos = "[]";
      });
    });
    triggerSync();
  };

  const addAlbumPhotoPlaceholder = async (album: Album) => {
    const photos = safeJsonArray((album as any).photos);
    if (photos.length >= 100) {
      Alert.alert("Limit erreicht", "Dieses Album darf maximal 100 Fotos enthalten.");
      return;
    }
    photos.push({ storageId: `local-${Date.now()}`, fileSize: 0, uploadedAt: Date.now() });
    await database.write(async () => {
      await album.update((record: any) => {
        record.photos = JSON.stringify(photos);
      });
    });
    triggerSync();
  };

  const renderBody = () => {
    if (tab === "memos") {
      return (
        <View style={{ flex: 1 }}>
          <View style={styles.composer}>
            <TextInput value={draftTitle} onChangeText={setDraftTitle} placeholder="Memo-Titel" style={styles.input} />
            <TextInput value={draftContent} onChangeText={setDraftContent} placeholder="Notiz (optional)" style={[styles.input, styles.inputMultiline]} multiline />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity style={[styles.primaryButton, { flex: 1 }]} onPress={createMemo}>
                <Text style={styles.primaryText}>{editingMemoId ? "Memo speichern" : "Memo erstellen"}</Text>
              </TouchableOpacity>
              {editingMemoId ? (
                <TouchableOpacity
                  style={[styles.secondaryButton, { marginTop: 0, paddingHorizontal: 16 }]}
                  onPress={() => {
                    setDraftTitle("");
                    setDraftContent("");
                    setEditingMemoId(null);
                  }}
                >
                  <Text style={styles.secondaryText}>Abbrechen</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <FlatList
            data={memos}
            keyExtractor={(item: any) => item.id}
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) => {
              const raw = (item as any)._raw ?? {};
              const pending = !item.serverId || raw._status === "updated" || raw._status === "created";
              const faded = !isOnline && pending;
              return (
                <TouchableOpacity onPress={() => startEditMemo(item)} activeOpacity={0.8}>
                  <SwipeToDeleteCard title={item.title} subtitle={item.content} faded={faded} onDelete={() => deleteMemoLocal(item)} />
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>Noch keine Memos. Erstelle oben dein erstes.</Text>}
          />
        </View>
      );
    }

    if (tab === "lists") {
      return (
        <FlatList
          data={lists}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item }) => <ListCard list={item} onToggle={toggleListItem} onAdd={addListItem} isOnline={isOnline} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.empty}>Noch keine Listen.</Text>
              <TouchableOpacity style={styles.primaryButton} onPress={createList}>
                <Text style={styles.primaryText}>Liste erstellen</Text>
              </TouchableOpacity>
            </View>
          }
        />
      );
    }

    return (
      <FlatList
        data={albums}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => <AlbumCard album={item} onAddPhoto={() => addAlbumPhotoPlaceholder(item)} isOnline={isOnline} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.empty}>Noch keine Alben.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={createAlbum}>
              <Text style={styles.primaryText}>Album erstellen</Text>
            </TouchableOpacity>
          </View>
        }
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Memos & Listen</Text>
        <View style={styles.headerRow}>
          <View style={[styles.dot, { backgroundColor: isOnline ? "#7D9B84" : "#C06C5C" }]} />
          <Text style={styles.dotLabel}>{isOnline ? "online" : "offline"}</Text>
        </View>
      </View>

      <StorageBar familyId={familyId} />

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {renderBody()}
    </View>
  );
}

function ListCard({
  list,
  onToggle,
  onAdd,
  isOnline,
}: {
  list: List;
  onToggle: (list: List, index: number) => void;
  onAdd: (list: List, text: string) => void;
  isOnline: boolean;
}) {
  const [draft, setDraft] = useState("");
  const items = safeJsonArray((list as any).items);

  const raw = (list as any)._raw ?? {};
  const pending = !list.serverId || raw._status === "updated" || raw._status === "created";
  const faded = !isOnline && pending;

  const opacity = useRef(new Animated.Value(faded ? 0.6 : 1.0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: faded ? 0.6 : 1.0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [faded, opacity]);

  return (
    <Animated.View style={[styles.card, { opacity }]}>
      <Text style={styles.cardTitle}>{list.title}</Text>
      {items.map((item, idx) => (
        <Pressable key={`${idx}-${item.text}`} onPress={() => onToggle(list, idx)} style={styles.listRow}>
          <View style={[styles.checkbox, item.completed && styles.checkboxChecked]} />
          <Text style={[styles.listText, item.completed && styles.listTextDone]}>{item.text}</Text>
        </Pressable>
      ))}
      <View style={styles.inlineRow}>
        <TextInput value={draft} onChangeText={setDraft} placeholder="Neues Item" style={[styles.input, { flex: 1 }]} />
        <TouchableOpacity
          style={styles.smallButton}
          onPress={() => {
            onAdd(list, draft);
            setDraft("");
          }}
        >
          <Text style={styles.smallButtonText}>+</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.cardHint}>Tippe auf ein Item, um es abzuhaken</Text>
    </Animated.View>
  );
}

function AlbumCard({ album, onAddPhoto, isOnline }: { album: Album; onAddPhoto: () => void; isOnline: boolean }) {
  const photos = safeJsonArray((album as any).photos);

  const raw = (album as any)._raw ?? {};
  const pending = !album.serverId || raw._status === "updated" || raw._status === "created";
  const faded = !isOnline && pending;

  const opacity = useRef(new Animated.Value(faded ? 0.6 : 1.0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: faded ? 0.6 : 1.0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [faded, opacity]);

  return (
    <Animated.View style={[styles.card, { opacity }]}>
      <Text style={styles.cardTitle}>{album.name}</Text>
      <Text style={styles.cardSubtitle}>{photos.length} / 100 Fotos</Text>
      <TouchableOpacity style={styles.secondaryButton} onPress={onAddPhoto}>
        <Text style={styles.secondaryText}>Foto hinzufügen</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const enhance = (withObservables as any)(["familyId"], ({ familyId }: { familyId: string }) => ({
  memos: database.collections.get("memos").query(Q.where("family_id", familyId)).observe(),
  lists: database.collections.get("lists").query(Q.where("family_id", familyId)).observe(),
  albums: database.collections.get("albums").query(Q.where("family_id", familyId)).observe(),
}));

const EnhancedScreen = enhance(MemosScreen);

export default function MemosRoute() {
  const familyId = useFamilyId();
  if (!familyId) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>Familie wird geladen …</Text>
      </View>
    );
  }
  return <EnhancedScreen familyId={familyId} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F2EB" },
  header: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  title: { color: "#2A2720", fontSize: 24, fontWeight: "700" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotLabel: { color: "#6F675E", fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  storageCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", backgroundColor: "#FBF9F5", padding: 12 },
  storageTitle: { color: "#2A2720", fontWeight: "800" },
  storageMeta: { color: "#6F675E", marginTop: 4 },
  storageTrack: { height: 10, borderRadius: 999, backgroundColor: "#E2DDD5", marginTop: 10, overflow: "hidden" },
  storageFill: { height: 10, borderRadius: 999, backgroundColor: "#C89E58" },
  tabs: { flexDirection: "row", marginHorizontal: 16, marginBottom: 12, borderRadius: 12, backgroundColor: "#E2DDD5", padding: 4 },
  tab: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  tabActive: { backgroundColor: "#FBF9F5" },
  tabText: { color: "#2A2720", fontWeight: "700" },
  tabTextActive: { color: "#C89E58" },
  composer: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", backgroundColor: "#FBF9F5", padding: 12 },
  input: { minHeight: 48, backgroundColor: "white", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginBottom: 10 },
  inputMultiline: { minHeight: 80, paddingTop: 12 },
  primaryButton: { minHeight: 48, borderRadius: 12, backgroundColor: "#C89E58", alignItems: "center", justifyContent: "center" },
  primaryText: { color: "white", fontWeight: "800" },
  secondaryButton: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: "#C89E58", alignItems: "center", justifyContent: "center", marginTop: 10, backgroundColor: "white" },
  secondaryText: { color: "#C89E58", fontWeight: "800" },
  card: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", backgroundColor: "#FBF9F5", padding: 12 },
  offlineCard: { opacity: 0.6 },
  cardTitle: { color: "#2A2720", fontWeight: "900", fontSize: 16 },
  cardSubtitle: { color: "#6F675E", marginTop: 6 },
  cardHint: { color: "#6F675E", marginTop: 10, fontSize: 12 },
  empty: { color: "#2A2720", textAlign: "center", padding: 24 },
  emptyWrap: { paddingHorizontal: 16, paddingTop: 24 },
  listRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#C89E58", backgroundColor: "white" },
  checkboxChecked: { backgroundColor: "#C89E58" },
  listText: { color: "#2A2720", fontWeight: "600" },
  listTextDone: { textDecorationLine: "line-through", color: "#6F675E" },
  inlineRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 },
  smallButton: { width: 48, height: 48, borderRadius: 12, backgroundColor: "#C89E58", alignItems: "center", justifyContent: "center" },
  smallButtonText: { color: "white", fontWeight: "900", fontSize: 20 },
});
