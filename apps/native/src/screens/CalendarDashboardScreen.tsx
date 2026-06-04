import { Q } from "@nozbe/watermelondb";
import withObservables from "@nozbe/with-observables";
import { type Href, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";

import { CalendarCard } from "../components/CalendarCard";
import { DailyDigestCard } from "../components/DailyDigestCard";
import { EventComments } from "../components/chat/EventComments";
import { StatusDot } from "../components/StatusDot";
import { VetoBadge } from "../components/VetoBadge";
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
  const currentUser = useQuery(api.users.getCurrentUser);
  const ensureEventThread = useMutation(api.chats.ensureEventThread);
  const clearVeto = useMutation(api.calendarEvents.clearVeto);
  const requestSchedulingSuggestions = useMutation(api.agents.requestSchedulingSuggestions);
  const getLocalDateStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [todayDateStr, setTodayDateStr] = useState(getLocalDateStr);
  const dailyDigest = useQuery(api.agents.getDailyDigest, { dateStr: todayDateStr });
  const requestDailyDigest = useMutation(api.agents.requestDailyDigest);
  const isOnline = useNetworkStatus();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [focusedDate, setFocusedDate] = useState(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [vetoDraftEvent, setVetoDraftEvent] = useState<CalendarEvent | null>(null);
  const [vetoReason, setVetoReason] = useState("");
  const [schedulingModalOpen, setSchedulingModalOpen] = useState(false);
  const [schedulingTitle, setSchedulingTitle] = useState("");
  const [schedulingDuration, setSchedulingDuration] = useState("60");
  const [schedulingStart, setSchedulingStart] = useState(() => new Date().toISOString());
  const [schedulingEnd, setSchedulingEnd] = useState(() => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
  const [isSubmittingScheduling, setIsSubmittingScheduling] = useState(false);
  const wasOnlineRef = useRef(isOnline);
  const isSyncingRef = useRef(false);
  const requestingDigestRef = useRef<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setTodayDateStr((current) => {
        const next = getLocalDateStr();
        return current !== next ? next : current;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (dailyDigest === null && requestingDigestRef.current !== todayDateStr) {
      requestingDigestRef.current = todayDateStr;
      requestDailyDigest({ dateStr: todayDateStr }).catch((error) => {
        console.warn("Daily digest request failed", error);
        // Do not reset requestingDigestRef.current to null immediately to prevent infinite retry loops
      });
    }
  }, [dailyDigest, requestDailyDigest, todayDateStr]);

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

  const syncCalendarChanges = () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    syncPendingCalendarEvents({ db: database, convexClient })
      .catch((error) => console.warn("Calendar sync trigger failed", error))
      .finally(() => {
        isSyncingRef.current = false;
      });
  };

  const approveDraftEvent = async (event: CalendarEvent) => {
    const originalDraftTitle = event.title;
    await database.write(async () => {
      await event.update((localEvent) => {
        localEvent.status = "confirmed";
        localEvent.title = localEvent.title.replace(/^\[Vorschlag\]\s*/, "");
      });
      const siblingDrafts = events.filter((candidate) =>
        candidate.id !== event.id &&
        candidate.status === "draft" &&
        candidate.creatorId === "scheduling-agent" &&
        candidate.title === originalDraftTitle
      );
      for (const sibling of siblingDrafts) {
        await sibling.markAsDeleted();
      }
    });
    syncCalendarChanges();
  };

  const declineDraftEvent = (event: CalendarEvent) => {
    const originalDraftTitle = event.title;
    Alert.alert("Vorschlag ablehnen", "Möchtest du diesen Vorschlag wirklich ablehnen?", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Ja, ablehnen",
        style: "destructive",
        onPress: async () => {
          await database.write(async () => {
            await event.markAsDeleted();
            if (event.creatorId === "scheduling-agent") {
              const siblingDrafts = events.filter((candidate) =>
                candidate.id !== event.id &&
                candidate.status === "draft" &&
                candidate.creatorId === "scheduling-agent" &&
                candidate.title === originalDraftTitle
              );
              for (const sibling of siblingDrafts) {
                await sibling.markAsDeleted();
              }
            }
          });
          setSelectedEvent(null);
          syncCalendarChanges();
        },
      },
    ]);
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

  const canReviewDrafts = currentUser?.role === "ROLE-001" || currentUser?.role === "ROLE-002";
  const isChild = currentUser?.role === "ROLE-004";
  const sanitizeDate = (s: string) => s.includes("Z") || s.includes("+") ? s : s + "Z";
  const closeSchedulingModal = () => {
    setSchedulingModalOpen(false);
    setSchedulingTitle("");
    setSchedulingDuration("60");
  };
  const submitSchedulingRequest = async () => {
    const title = schedulingTitle.trim();
    const durationMinutes = Number.parseInt(schedulingDuration, 10);
    if (!currentUser?.familyId || !title || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      Alert.alert("Angaben prüfen", "Bitte gib Titel, Dauer und Wunschzeitraum korrekt ein.");
      return;
    }
    const sanitizedStart = sanitizeDate(schedulingStart.trim());
    const sanitizedEnd = sanitizeDate(schedulingEnd.trim());
    const startParsed = Date.parse(sanitizedStart);
    const endParsed = Date.parse(sanitizedEnd);
    if (Number.isNaN(startParsed) || Number.isNaN(endParsed) || startParsed >= endParsed) {
      Alert.alert("Datum ungültig", "Bitte gib einen gültigen Start- und Endzeitpunkt im ISO-Format (z.B. YYYY-MM-DDTHH:MM:SSZ) an.");
      return;
    }
    if (isSubmittingScheduling) return;
    setIsSubmittingScheduling(true);
    try {
      await requestSchedulingSuggestions({
        familyId: currentUser.familyId as any,
        title,
        durationMinutes,
        preferredTimeRange: { start: sanitizedStart, end: sanitizedEnd },
      });
      closeSchedulingModal();
      Alert.alert("Terminvorschläge werden generiert", "Der Scheduling Agent legt gleich drei Vorschläge als Entwürfe an.");
    } catch (error) {
      console.warn("Scheduling request failed", error);
      Alert.alert("Fehler", "Vorschläge konnten nicht generiert werden.");
    } finally {
      setIsSubmittingScheduling(false);
    }
  };

  const raiseLocalVeto = (event: CalendarEvent) => {
    setVetoDraftEvent(event);
    setVetoReason(event.vetoReason ?? "");
  };

  const submitLocalVeto = async () => {
    const reason = vetoReason.trim();
    if (!vetoDraftEvent || !reason) {
      Alert.alert("Grund fehlt", "Bitte gib einen kurzen Grund für deinen Einspruch an.");
      return;
    }
    if (!currentUser) {
      Alert.alert("Fehler", "Benutzerdaten werden noch geladen. Bitte versuche es gleich noch einmal.");
      return;
    }
    await database.write(async () => {
      await vetoDraftEvent.update((localEvent) => {
        localEvent.vetoStatus = "vetoed";
        localEvent.vetoReason = reason;
        localEvent.vetoChildId = currentUser.clerkId ?? (currentUser._id ? String(currentUser._id) : undefined);
      });
    });
    setVetoDraftEvent(null);
    setVetoReason("");
    syncCalendarChanges();
  };

  const openClarificationChat = async (event: CalendarEvent) => {
    if (!event.serverId) {
      Alert.alert("Noch nicht synchronisiert", "Der Klärungs-Chat ist verfügbar, sobald der Termin synchronisiert ist.");
      return;
    }
    try {
      const thread = await ensureEventThread({ calendarEventId: event.serverId as any });
      if (thread?._id) {
        router.push(`/chat/${thread._id}` as Href);
      } else {
        router.push("/chats" as Href);
      }
    } catch (error) {
      console.warn("Failed to open clarification chat", error);
      Alert.alert("Fehler", "Der Klärungs-Chat konnte nicht geöffnet werden.");
    }
  };

  const clearEventVeto = async (event: CalendarEvent) => {
    await database.write(async () => {
      await event.update((localEvent) => {
        localEvent.vetoStatus = null as any;
        localEvent.vetoReason = null as any;
        localEvent.vetoChildId = null as any;
      });
    });
    syncCalendarChanges();
  };

  const calendarContent = renderCalendarContent({
    calendarView,
    focusedDate,
    groupedEvents,
    eventsByDay,
    selectedEvent,
    onSelect: selectEvent,
  });

  const openSchedulingModal = () => {
    const now = new Date();
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    setSchedulingStart(now.toISOString());
    setSchedulingEnd(nextWeek.toISOString());
    setSchedulingModalOpen(true);
  };

  return (
    <View accessibilityLabel="Kalenderdashboard" style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>Familienkalender</Text>
          <Text accessibilityLabel="Sichtbarer Kalenderzeitraum" style={styles.rangeLabel}>
            {formatDateLabel(visibleRange.start.slice(0, 10))} – {formatDateLabel(new Date(Date.parse(visibleRange.end) - 1).toISOString().slice(0, 10))}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Kalender synchronisieren" style={styles.chatButton} onPress={syncCalendarChanges}>
            <Text style={styles.chatButtonText}>Sync</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Chats öffnen" style={styles.chatButton} onPress={() => router.push("/chats" as Href)}>
            <Text style={styles.chatButtonText}>Chats</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Spracheingabe öffnen" style={styles.chatButton} onPress={() => router.push("/voice-input" as Href)}>
            <Text style={styles.chatButtonText}>🎙</Text>
          </TouchableOpacity>
          <StatusDot />
        </View>
      </View>

      <DailyDigestCard digest={dailyDigest} loading={dailyDigest === undefined || dailyDigest === null} dateStr={todayDateStr} />

      {canReviewDrafts ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Terminvorschläge generieren" style={styles.schedulingButton} onPress={openSchedulingModal}>
          <Text style={styles.schedulingButtonText}>Terminvorschläge generieren</Text>
        </TouchableOpacity>
      ) : null}

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
          <View style={styles.sideColumn}>{renderContextPanel(selectedEvent, { canReviewDrafts, isChild, onApprove: approveDraftEvent, onDecline: declineDraftEvent, onRaiseVeto: raiseLocalVeto, onOpenClarificationChat: openClarificationChat, onClearVeto: clearEventVeto })}</View>
        </View>
      ) : (
        <View style={styles.phoneContent}>
          <View style={styles.phoneCalendar}>{calendarContent}</View>
          {selectedEvent ? <View style={styles.phoneContext}>{renderContextPanel(selectedEvent, { canReviewDrafts, isChild, onApprove: approveDraftEvent, onDecline: declineDraftEvent, onRaiseVeto: raiseLocalVeto, onOpenClarificationChat: openClarificationChat, onClearVeto: clearEventVeto })}</View> : null}
        </View>
      )}

      <Modal transparent visible={schedulingModalOpen} animationType="fade" onRequestClose={() => setSchedulingModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.vetoModal}>
            <Text style={styles.panelTitle}>Terminvorschläge generieren</Text>
            <TextInput accessibilityLabel="Titel für Terminvorschläge" style={styles.vetoInput} value={schedulingTitle} onChangeText={setSchedulingTitle} placeholder="Titel" placeholderTextColor="#8A8176" />
            <TextInput accessibilityLabel="Dauer in Minuten" style={styles.vetoInput} value={schedulingDuration} onChangeText={setSchedulingDuration} keyboardType="number-pad" placeholder="Dauer in Minuten" placeholderTextColor="#8A8176" />
            <TextInput accessibilityLabel="Start des Wunschzeitraums" style={styles.vetoInput} value={schedulingStart} onChangeText={setSchedulingStart} placeholder="Start ISO" placeholderTextColor="#8A8176" />
            <TextInput accessibilityLabel="Ende des Wunschzeitraums" style={styles.vetoInput} value={schedulingEnd} onChangeText={setSchedulingEnd} placeholder="Ende ISO" placeholderTextColor="#8A8176" />
            <View style={styles.draftActions}>
              <TouchableOpacity accessibilityRole="button" disabled={isSubmittingScheduling} style={[styles.draftActionButton, styles.declineButton]} onPress={closeSchedulingModal}>
                <Text style={styles.draftActionText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" disabled={isSubmittingScheduling} style={[styles.draftActionButton, styles.approveButton]} onPress={submitSchedulingRequest}>
                <Text style={styles.draftActionText}>{isSubmittingScheduling ? "Generiere..." : "Generieren"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={!!vetoDraftEvent} animationType="fade" onRequestClose={() => setVetoDraftEvent(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.vetoModal}>
            <Text style={styles.panelTitle}>Einspruch erheben</Text>
            <Text style={styles.contextText}>Warum passt dieser Termin für dich nicht?</Text>
            <TextInput
              accessibilityLabel="Grund für Einspruch eingeben"
              style={styles.vetoInput}
              value={vetoReason}
              onChangeText={setVetoReason}
              placeholder="Kurzer Grund …"
              placeholderTextColor="#8A8176"
              multiline
            />
            <View style={styles.draftActions}>
              <TouchableOpacity accessibilityRole="button" style={[styles.draftActionButton, styles.declineButton]} onPress={() => setVetoDraftEvent(null)}>
                <Text style={styles.draftActionText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={[styles.draftActionButton, styles.vetoButton]} onPress={submitLocalVeto}>
                <Text style={styles.draftActionText}>Absenden</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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

function renderContextPanel(
  event: CalendarEvent | null,
  actions: {
    canReviewDrafts: boolean;
    isChild: boolean;
    onApprove: (event: CalendarEvent) => void;
    onDecline: (event: CalendarEvent) => void;
    onRaiseVeto: (event: CalendarEvent) => void;
    onOpenClarificationChat: (event: CalendarEvent) => void;
    onClearVeto: (event: CalendarEvent) => void;
  },
) {
  const showDraftReviewActions = event?.status === "draft" && actions.canReviewDrafts;
  const showParentVetoActions = event?.vetoStatus === "vetoed" && actions.canReviewDrafts;

  return (
    <View accessibilityLabel="Kontextpanel Kalendertermin" style={styles.panel}>
      <Text style={styles.panelTitle}>Details</Text>
      {event ? (
        <>
          <Text style={styles.contextTitle}>{event.title}</Text>
          <Text style={styles.contextText}>{new Date(event.startDate).toLocaleString()} – {new Date(event.endDate).toLocaleString()}</Text>
          {event.description ? <Text style={styles.contextText}>{event.description}</Text> : null}
          {event.vetoStatus === "vetoed" ? (
            <View style={styles.vetoPanel}>
              <VetoBadge />
              {event.vetoReason ? <Text style={styles.contextText}>Grund: {event.vetoReason}</Text> : null}
            </View>
          ) : null}
          {actions.isChild ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Einspruch gegen Termin erheben" style={[styles.draftActionButton, styles.vetoButton]} onPress={() => actions.onRaiseVeto(event)}>
              <Text style={styles.draftActionText}>Einspruch erheben</Text>
            </TouchableOpacity>
          ) : null}
          {showParentVetoActions ? (
            <View style={styles.draftActions} accessibilityLabel="Einspruch klären">
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Klärungs-Chat öffnen" style={[styles.draftActionButton, styles.approveButton]} onPress={() => actions.onOpenClarificationChat(event)}>
                <Text style={styles.draftActionText}>Klärungs-Chat öffnen</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Einspruch aufheben" style={[styles.draftActionButton, styles.declineButton]} onPress={() => actions.onClearVeto(event)}>
                <Text style={styles.draftActionText}>Einspruch aufheben</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {showDraftReviewActions ? (
            <View style={styles.draftActions} accessibilityLabel="Terminvorschlag prüfen">
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Terminvorschlag bestätigen" style={[styles.draftActionButton, styles.approveButton]} onPress={() => actions.onApprove(event)}>
                <Text style={styles.draftActionText}>Bestätigen</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Terminvorschlag ablehnen" style={[styles.draftActionButton, styles.declineButton]} onPress={() => actions.onDecline(event)}>
                <Text style={styles.draftActionText}>Ablehnen</Text>
              </TouchableOpacity>
            </View>
          ) : null}
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
  chatButton: { minHeight: Platform.OS === "android" ? 48 : 44, justifyContent: "center", borderRadius: 12, paddingHorizontal: 14, backgroundColor: "#7D9B84" },
  chatButtonText: { color: "#FFFFFF", fontWeight: "700" },
  schedulingButton: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, minHeight: 48, alignItems: "center", justifyContent: "center", backgroundColor: "#5C7C8A" },
  schedulingButtonText: { color: "#FFFFFF", fontWeight: "700" },
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
  modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "rgba(42,39,32,0.35)" },
  vetoModal: { width: "100%", maxWidth: 420, borderRadius: 16, borderWidth: 1, borderColor: "#E2DDD5", backgroundColor: "#FBF9F5", padding: 16 },
  vetoInput: { minHeight: 96, marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: "#E2DDD5", padding: 12, color: "#2A2720", backgroundColor: "#FFFFFF", textAlignVertical: "top" },
  vetoPanel: { marginTop: 12, gap: 6 },
  draftActions: { flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 4 },
  draftActionButton: { flex: 1, minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, paddingHorizontal: 12 },
  approveButton: { backgroundColor: "#7D9B84" },
  declineButton: { backgroundColor: "#C06C5C" },
  vetoButton: { marginTop: 12, backgroundColor: "#C06C5C" },
  draftActionText: { color: "#FFFFFF", fontWeight: "700" },
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
