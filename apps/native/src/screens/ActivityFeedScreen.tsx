import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api } from "@packages/backend/convex/_generated/api";
import { useConvex } from "convex/react";
import { useFamilyId } from "../hooks/useFamilyId";

type FeedEntry = {
  _id: string;
  type: string;
  summary: string;
  createdAt: number;
  metadata?: { fileSize?: number; storageDelta?: number };
};

const typeLabels: Record<string, string> = {
  chat_message: "Chat",
  event_comment: "Kommentar",
  calendar_event: "Kalender",
  memo_updated: "Memo",
  memo_deleted: "Memo",
  list_updated: "Liste",
  list_deleted: "Liste",
  album_updated: "Album",
  album_deleted: "Album",
  quota_updated: "Quota",
};

function formatTime(timestamp: number) {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function formatBytes(bytes?: number) {
  if (!bytes) return null;
  // A negative value is a storage delta from a shrink (e.g. album cleanup); show
  // it as freed space rather than a raw negative byte count.
  const negative = bytes < 0;
  const abs = Math.abs(bytes);
  const value = abs >= 1024 * 1024 ? `${(abs / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(abs / 1024)} KB`;
  return negative ? `${value} freigegeben` : value;
}

export default function ActivityFeedScreen() {
  const familyId = useFamilyId();
  const convex = useConvex();
  const [items, setItems] = useState<FeedEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (nextCursor: string | null = null, replace = false) => {
    if (!familyId) return;
    if (replace) setIsInitialLoading(true);
    else setIsLoadingMore(true);

    try {
      const result = await convex.query(api.activityFeed.list, {
        familyId: familyId as any,
        paginationOpts: { numItems: 25, cursor: nextCursor },
      });
      setItems((prev) => (replace ? result.page : [...prev, ...result.page]));
      setCursor(result.continueCursor);
      setHasMore(!result.isDone);
      setError(null);
    } catch (err) {
      // Surface query failures (e.g. FAMILY_ACCESS_DENIED, network) as an error
      // state instead of silently rendering an empty feed.
      setError(err instanceof Error ? err.message : "Aktivitäten konnten nicht geladen werden.");
    } finally {
      setIsInitialLoading(false);
      setIsLoadingMore(false);
    }
  }, [convex, familyId]);

  useEffect(() => {
    loadPage(null, true);
  }, [loadPage]);

  return (
    <View style={styles.container}>
      <Text style={styles.kicker}>FamilyCal</Text>
      <Text style={styles.title}>Aktivitäten</Text>

      {isInitialLoading ? (
        <View>
          <View style={styles.skeletonRow} />
          <View style={styles.skeletonRow} />
          <View style={styles.skeletonRow} />
        </View>
      ) : null}

      {!isInitialLoading && error ? (
        <View style={styles.errorState}>
          <Text style={styles.errorTitle}>Aktivitäten konnten nicht geladen werden</Text>
          <Text style={styles.muted}>{error}</Text>
          <TouchableOpacity style={styles.moreButton} onPress={() => loadPage(null, true)}>
            <Text style={styles.moreText}>Erneut versuchen</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!isInitialLoading && !error && items.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Keine Aktivitäten</Text>
          <Text style={styles.muted}>In den letzten 30 Tagen gibt es noch keine sichtbaren Familienaktivitäten.</Text>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const size = formatBytes(item.metadata?.fileSize ?? item.metadata?.storageDelta);
          return (
            <View style={styles.row}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{typeLabels[item.type]?.slice(0, 1) ?? "A"}</Text>
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowHeader}>
                  <Text style={styles.type}>{typeLabels[item.type] ?? "Aktivität"}</Text>
                  <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
                </View>
                <Text style={styles.summary}>{item.summary}</Text>
                {size ? <Text style={styles.muted}>{size}</Text> : null}
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          hasMore ? (
            <TouchableOpacity
              style={styles.moreButton}
              disabled={isLoadingMore}
              onPress={() => loadPage(cursor, false)}
            >
              {isLoadingMore ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.moreText}>Mehr laden</Text>}
            </TouchableOpacity>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F2EB", padding: 20 },
  kicker: { color: "#6F675E", letterSpacing: 2, textTransform: "uppercase" },
  title: { color: "#2D2D2D", fontSize: 28, fontWeight: "700", marginBottom: 18 },
  listContent: { paddingBottom: 32 },
  skeletonRow: { height: 78, backgroundColor: "#FBF9F5", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 8, marginBottom: 10 },
  emptyState: { backgroundColor: "#FBF9F5", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 8, padding: 18 },
  emptyTitle: { color: "#2D2D2D", fontSize: 18, fontWeight: "800", marginBottom: 6 },
  errorState: { backgroundColor: "#FBEDEA", borderColor: "#E7B7AE", borderWidth: 1, borderRadius: 8, padding: 18, marginBottom: 10 },
  errorTitle: { color: "#7A2018", fontSize: 18, fontWeight: "800", marginBottom: 6 },
  row: { minHeight: 78, flexDirection: "row", gap: 12, backgroundColor: "#FBF9F5", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 10 },
  badge: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#50603F", alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#FFFFFF", fontWeight: "900" },
  rowBody: { flex: 1 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 4 },
  type: { color: "#2D2D2D", fontWeight: "800" },
  time: { color: "#6F675E", fontSize: 12 },
  summary: { color: "#2D2D2D", marginBottom: 4 },
  muted: { color: "#6F675E" },
  moreButton: { minHeight: 48, borderRadius: 8, backgroundColor: "#50603F", alignItems: "center", justifyContent: "center", marginTop: 8 },
  moreText: { color: "#FFFFFF", fontWeight: "800" },
});
