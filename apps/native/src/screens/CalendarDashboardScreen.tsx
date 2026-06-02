import { Q } from "@nozbe/watermelondb";
import withObservables from "@nozbe/with-observables";
import { type Href, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useConvex } from "convex/react";

import { CalendarCard } from "../components/CalendarCard";
import { EventComments } from "../components/chat/EventComments";
import { StatusDot } from "../components/StatusDot";
import {
  formatDateLabel,
  getMonthGridDays,
  getOccurrenceKey,
  getVisibleRange,
  getWeekDays,
  groupEventsForView,
  toDateKey,
  type CalendarView,
} from "../calendar/calendarView";
import { database } from "../database";
import type { CalendarEvent } from "../database/models/CalendarEvent";
import { useFamilyId } from "../hooks/useFamilyId";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { syncPendingCalendarEvents } from "../sync/calendarSync";

type Props = { events: CalendarEvent[] };
const VIEWS: CalendarView[] = ["month", "week", "day", "agenda"];
const VIEW_LABELS: Record<CalendarView, string> = { month: "Monat", week: "Woche", day: "Tag", agenda: "Agenda" };

function CalendarDashboardScreen({ events }: Props) {
  const router = useRouter();
  const convexClient = useConvex();
  const isOnline = useNetworkStatus();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [focusedDate, setFocusedDate] = useState(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const wasOnlineRef = useRef(isOnline);
  const isSyncingRef = useRef(false);

  useEffect(() => {
    const cameOnline = !wasOnlineRef.current && isOnline;
    wasOnlineRef.current = isOnline;

    if (!cameOnline || isSyncingRef.current) return;

    isSyncingRef.current = true;
    syncPendingCalendarEvents({ db: database, convexClient })
      .catch((error) => console.warn("Calendar sync trigger failed", error))
      .finally(() => {
        isSyncingRef.current = false;
      });
  }, [convexClient, isOnline]);

  const visibleRange = useMemo(() => getVisibleRange(calendarView, focusedDate), [calendarView, focusedDate]);
  const groupedEvents = useMemo(() => groupEventsForView(events, calendarView, focusedDate), [events, calendarView, focusedDate]);
  const visibleEvents = useMemo(() => groupedEvents.flatMap((group) => group.events), [groupedEvents]);
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    groupedEvents.forEach((group) => map.set(group.dateKey, group.events));
    return map;
  }, [groupedEvents]);

  // Reconcile the current selection against fresh observable data so the context panel
  // never shows a stale snapshot (e.g. after a sync sets serverId) and clears when the
  // selected occurrence leaves the visible range.
  useEffect(() => {
    if (!selectedEvent) return;
    const key = getOccurrenceKey(selectedEvent);
    const fresh = visibleEvents.find((event) => getOccurrenceKey(event) === key) ?? null;
    if (fresh !== selectedEvent) setSelectedEvent(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEvents]);

  const selectEvent = (event: CalendarEvent) => {
    setSelectedEvent(event);
  };

  const shiftFocus = (direction: -1 | 1) => {
    setFocusedDate((current) => {
      const next = new Date(current);
      if (calendarView === "month") next.setUTCMonth(next.getUTCMonth() + direction);
      else if (calendarView === "week") next.setUTCDate(next.getUTCDate() + 7 * direction);
      else if (calendarView === "agenda") next.setUTCDate(next.getUTCDate() + 30 * direction);
      else next.setUTCDate(next.getUTCDate() + direction);
      return next;
    });
  };
  const goToday = () => setFocusedDate(new Date());

  const calendarContent = renderCalendarContent({
    calendarView,
    focusedDate,
    groupedEvents,
    eventsByDay,
    selectedEvent,
    onSelect: selectEvent,
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>Familienkalender</Text>
          <Text accessibilityLabel="Sichtbarer Kalenderzeitraum" style={styles.rangeLabel}>
            {formatDateLabel(visibleRange.start.slice(0, 10))} – {formatDateLabel(new Date(Date.parse(visibleRange.end) - 1).toISOString().slice(0, 10))}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Chats öffnen" style={styles.chatButton} onPress={() => router.push("/chats" as Href)}>
            <Text style={styles.chatButtonText}>Chats</Text>
          </TouchableOpacity>
          <StatusDot />
        </View>
      </View>

      <View style={styles.segmented} accessibilityLabel="Kalenderansicht umschalten">
        {VIEWS.map((view) => (
          <TouchableOpacity
            key={view}
            accessibilityRole="button"
            accessibilityLabel={`Zur ${VIEW_LABELS[view]}sansicht wechseln`}
            accessibilityState={{ selected: calendarView === view }}
            style={[styles.segment, calendarView === view && styles.segmentActive]}
            onPress={() => setCalendarView(view)}
          >
            <Text style={[styles.segmentText, calendarView === view && styles.segmentTextActive]}>{VIEW_LABELS[view]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.navRow} accessibilityLabel="Kalenderzeitraum navigieren">
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Vorheriger Zeitraum" style={styles.navButton} onPress={() => shiftFocus(-1)}>
          <Text style={styles.navButtonText}>◀</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Heutigen Zeitraum anzeigen" style={styles.navButton} onPress={goToday}>
          <Text style={styles.navButtonText}>Heute</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Nächster Zeitraum" style={styles.navButton} onPress={() => shiftFocus(1)}>
          <Text style={styles.navButtonText}>▶</Text>
        </TouchableOpacity>
      </View>

      {isTablet ? (
        <View style={styles.tabletLayout}>
          <View style={styles.sideColumn}>{renderQuickNav(calendarView, setCalendarView, () => router.push("/event-editor" as Href))}</View>
          <View style={styles.centerColumn}>{calendarContent}</View>
          <View style={styles.sideColumn}>{renderContextPanel(selectedEvent)}</View>
        </View>
      ) : (
        <View style={styles.phoneContent}>
          <View style={styles.phoneCalendar}>{calendarContent}</View>
          {selectedEvent ? <View style={styles.phoneContext}>{renderContextPanel(selectedEvent)}</View> : null}
        </View>
      )}

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Neuen Termin hinzufügen"
        style={styles.addButton}
        onPress={() => router.push("/event-editor" as Href)}
      >
        <Text style={styles.addButtonText}>Termin hinzufügen</Text>
      </TouchableOpacity>
    </View>
  );
}

function renderCalendarContent(args: {
  calendarView: CalendarView;
  focusedDate: Date;
  groupedEvents: ReturnType<typeof groupEventsForView<CalendarEvent>>;
  eventsByDay: Map<string, CalendarEvent[]>;
  selectedEvent: CalendarEvent | null;
  onSelect: (event: CalendarEvent) => void;
}) {
  if (args.calendarView === "agenda") {
    const rows = args.groupedEvents.flatMap((group) => [{ type: "header" as const, id: group.dateKey, label: group.label }, ...group.events.map((event) => ({ type: "event" as const, id: `${group.dateKey}-${getOccurrenceKey(event)}`, event }))]);
    return (
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) =>
          item.type === "header" ? <Text style={styles.sectionHeader}>{item.label}</Text> : <CalendarCard event={item.event} selected={isEventSelected(args.selectedEvent, item.event)} onPress={args.onSelect} />
        }
        ListEmptyComponent={<EmptyState text="Noch keine Termine für diese Agenda eingetragen. Tippe auf das '+'-Symbol, um deinen ersten Termin anzulegen." />}
      />
    );
  }

  if (args.calendarView === "month") {
    const days = getMonthGridDays(args.focusedDate);
    return (
      <ScrollView contentContainerStyle={styles.monthGrid}>
        {days.map((day) => renderDayCell(day, args.eventsByDay.get(day) ?? [], args.selectedEvent, args.onSelect, true))}
      </ScrollView>
    );
  }

  if (args.calendarView === "week") {
    return (
      <ScrollView contentContainerStyle={styles.weekGrid}>
        {getWeekDays(args.focusedDate).map((day) => renderDayCell(day, args.eventsByDay.get(day) ?? [], args.selectedEvent, args.onSelect, false))}
      </ScrollView>
    );
  }

  const dayKey = toDateKey(args.focusedDate);
  const events = args.eventsByDay.get(dayKey) ?? [];
  return (
    <ScrollView contentContainerStyle={styles.dayList}>
      <Text style={styles.sectionHeader}>{formatDateLabel(dayKey)}</Text>
      {events.length === 0 ? <EmptyState text="Noch keine Termine für diesen Tag eingetragen. Tippe auf das '+'-Symbol, um deinen ersten Termin anzulegen." /> : events.map((event) => <CalendarCard key={getOccurrenceKey(event)} event={event} selected={isEventSelected(args.selectedEvent, event)} onPress={args.onSelect} />)}
    </ScrollView>
  );
}

function renderDayCell(day: string, events: CalendarEvent[], selectedEvent: CalendarEvent | null, onSelect: (event: CalendarEvent) => void, compact: boolean) {
  return (
    <View key={day} style={[styles.dayCell, compact && styles.monthCell]}>
      <Text style={styles.dayLabel}>{formatDateLabel(day)}</Text>
      {events.slice(0, compact ? 2 : undefined).map((event) => (
        <CalendarCard key={getOccurrenceKey(event)} event={event} compact selected={isEventSelected(selectedEvent, event)} onPress={onSelect} />
      ))}
      {events.length === 0 ? <Text style={styles.miniEmpty}>frei</Text> : null}
      {compact && events.length > 2 ? <Text style={styles.moreText}>+{events.length - 2} weitere</Text> : null}
    </View>
  );
}

function renderQuickNav(currentView: CalendarView, setView: (view: CalendarView) => void, addEvent: () => void) {
  return (
    <View accessibilityLabel="Schnellnavigation Kalender" style={styles.panel}>
      <Text style={styles.panelTitle}>Schnellnavigation</Text>
      {VIEWS.map((view) => (
        <TouchableOpacity key={view} style={[styles.navAction, currentView === view && styles.navActionActive]} onPress={() => setView(view)}>
          <Text style={styles.navActionText}>{VIEW_LABELS[view]}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.navAction} onPress={addEvent}>
        <Text style={styles.navActionText}>+ Termin</Text>
      </TouchableOpacity>
    </View>
  );
}

function renderContextPanel(event: CalendarEvent | null) {
  return (
    <View accessibilityLabel="Kontextpanel Kalendertermin" style={styles.panel}>
      <Text style={styles.panelTitle}>Details</Text>
      {event ? (
        <>
          <Text style={styles.contextTitle}>{event.title}</Text>
          <Text style={styles.contextText}>{new Date(event.startDate).toLocaleString()} – {new Date(event.endDate).toLocaleString()}</Text>
          {event.description ? <Text style={styles.contextText}>{event.description}</Text> : null}
          <EventComments calendarEventId={event.serverId} />
        </>
      ) : (
        <Text style={styles.contextText}>Wähle einen Termin aus, um Details zu sehen.</Text>
      )}
    </View>
  );
}

function isEventSelected(selected: CalendarEvent | null, event: CalendarEvent): boolean {
  return selected ? getOccurrenceKey(selected) === getOccurrenceKey(event) : false;
}

function EmptyState({ text }: { text: string }) {
  return <Text accessibilityLabel="Leerer Kalenderstatus" style={styles.empty}>{text}</Text>;
}

const enhance = (withObservables as any)(["familyId"], ({ familyId }: { familyId: string }) => ({
  events: database.collections.get("calendar_events").query(Q.where("family_id", familyId), Q.sortBy("start_date", Q.asc)).observe(),
}));

const EnhancedDashboard = enhance(CalendarDashboardScreen);

export default function CalendarDashboardRoute() {
  const familyId = useFamilyId();

  if (!familyId) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.heading}>Familienkalender</Text>
          <StatusDot />
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.empty}>Familie wird geladen …</Text>
        </View>
      </View>
    );
  }

  return <EnhancedDashboard familyId={familyId} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F2EB" },
  header: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { color: "#2A2720", fontSize: 24, fontWeight: "700" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  chatButton: { minHeight: 44, justifyContent: "center", borderRadius: 12, paddingHorizontal: 14, backgroundColor: "#7D9B84" },
  chatButtonText: { color: "#FFFFFF", fontWeight: "700" },
  rangeLabel: { color: "#5C7C8A", marginTop: 4 },
  segmented: { flexDirection: "row", marginHorizontal: 16, marginBottom: 12, borderRadius: 14, backgroundColor: "#E2DDD5", padding: 4 },
  segment: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  segmentActive: { backgroundColor: "#FBF9F5" },
  segmentText: { color: "#2A2720", fontWeight: "600" },
  segmentTextActive: { color: "#5C7C8A" },
  navRow: { flexDirection: "row", marginHorizontal: 16, marginBottom: 12, gap: 8 },
  navButton: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", backgroundColor: "#FBF9F5" },
  navButtonText: { color: "#2A2720", fontWeight: "700", fontSize: 16 },
  phoneContent: { flex: 1 },
  phoneCalendar: { flex: 1 },
  phoneContext: { maxHeight: 420, marginHorizontal: 16, marginTop: 8 },
  tabletLayout: { flex: 1, flexDirection: "row", gap: 12, paddingHorizontal: 16 },
  sideColumn: { flex: 1 },
  centerColumn: { flex: 2 },
  panel: { flex: 1, borderRadius: 16, borderWidth: 1, borderColor: "#E2DDD5", backgroundColor: "#FBF9F5", padding: 12 },
  panelTitle: { color: "#2A2720", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  navAction: { minHeight: 48, justifyContent: "center", borderRadius: 12, paddingHorizontal: 12, marginBottom: 8, backgroundColor: "#F5F2EB" },
  navActionActive: { backgroundColor: "#DDE8D8" },
  navActionText: { color: "#2A2720", fontWeight: "600" },
  contextTitle: { color: "#2A2720", fontSize: 16, fontWeight: "700" },
  contextText: { color: "#2A2720", marginTop: 8 },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, paddingBottom: 16 },
  weekGrid: { paddingHorizontal: 12, paddingBottom: 16 },
  dayList: { paddingBottom: 16 },
  dayCell: { minHeight: 120, borderRadius: 14, borderWidth: 1, borderColor: "#E2DDD5", backgroundColor: "#FBF9F5", marginBottom: 8, padding: 8 },
  monthCell: { width: "14.285%", aspectRatio: 0.82, minHeight: 116, marginBottom: 0, borderRadius: 0 },
  dayLabel: { color: "#2A2720", fontWeight: "700", marginBottom: 4 },
  sectionHeader: { color: "#2A2720", fontSize: 16, fontWeight: "700", marginHorizontal: 16, marginTop: 12, marginBottom: 4 },
  miniEmpty: { color: "#8A8176", fontSize: 12 },
  moreText: { color: "#5C7C8A", fontSize: 12, fontWeight: "600", marginTop: 4 },
  emptyContainer: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  empty: { color: "#2A2720", textAlign: "center", padding: 24 },
  addButton: { margin: 16, borderRadius: 12, minHeight: 48, alignItems: "center", justifyContent: "center", backgroundColor: "#7D9B84" },
  addButtonText: { color: "#FFFFFF", fontWeight: "700" },
});
