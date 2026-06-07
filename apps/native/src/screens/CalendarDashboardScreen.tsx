import { Ionicons } from "@expo/vector-icons";
import { Q } from "@nozbe/watermelondb";
import withObservables from "@nozbe/with-observables";
import { type Href, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";

import { CalendarCard } from "../components/CalendarCard";
import { DailyDigestCard } from "../components/DailyDigestCard";
import { EventComments } from "../components/chat/EventComments";
import { StatusDot } from "../components/StatusDot";
import { VetoBadge } from "../components/VetoBadge";
import { Fab } from "../components/ui/Fab";
import { IconButton } from "../components/ui/IconButton";
import { SegmentedControl } from "../components/ui/SegmentedControl";
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
import { colors, elevation, fonts, hitTarget, radius, spacing } from "../theme";

type Props = { events: CalendarEvent[] };
const VIEWS: CalendarView[] = ["month", "week", "day", "agenda"];
const VIEW_LABELS: Record<CalendarView, string> = { month: "Monat", week: "Woche", day: "Tag", agenda: "Agenda" };
const VIEW_SEGMENTS = VIEWS.map((view) => ({ value: view, label: VIEW_LABELS[view] }));

function CalendarDashboardScreen({ events }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const convexClient = useConvex();
  const currentUser = useQuery(api.users.getCurrentUser);
  const ensureEventThread = useMutation(api.chats.ensureEventThread);
  const clearVeto = useMutation(api.calendarEvents.clearVeto);
  const deleteEvent = useMutation(api.calendarEvents.deleteEvent);
  const requestSchedulingSuggestions = useMutation(api.agents.requestSchedulingSuggestions);
  const getLocalDateStr = useCallback(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const [todayDateStr, setTodayDateStr] = useState(getLocalDateStr);
  const dailyDigest = useQuery(api.agents.getDailyDigest, { dateStr: todayDateStr });
  const requestDailyDigest = useMutation(api.agents.requestDailyDigest);
  const virtualMembers = useQuery(api.virtualMembers.listByFamily, currentUser?.familyId ? { familyId: currentUser.familyId as any } : "skip");
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
  const [schedulingResourceId, setSchedulingResourceId] = useState<string | null>(null);
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
  }, [getLocalDateStr]);

  useEffect(() => {
    if (dailyDigest === null && requestingDigestRef.current !== todayDateStr) {
      requestingDigestRef.current = todayDateStr;
      requestDailyDigest({ dateStr: todayDateStr }).catch((error) => {
        console.warn("Daily digest request failed", error);
        setTimeout(() => {
          if (requestingDigestRef.current === todayDateStr) {
            requestingDigestRef.current = null;
          }
        }, 15000);
      });
    }
  }, [dailyDigest, requestDailyDigest, todayDateStr]);

  useEffect(() => {
    const cameOnline = !wasOnlineRef.current && isOnline;
    wasOnlineRef.current = isOnline;

    if (cameOnline) {
      requestingDigestRef.current = null;
    }

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
    await database.write(async () => {
      await event.update((localEvent) => {
        localEvent.status = "confirmed";
        localEvent.title = localEvent.title.replace(/^\[Vorschlag\]\s*/, "");
      });
      if (event.creatorId === "scheduling-agent" && event.clientId) {
        const batchId = event.clientId.replace(/-\d+$/, "");
        const siblingDrafts = events.filter((candidate) =>
          candidate.id !== event.id &&
          candidate.status === "draft" &&
          candidate.creatorId === "scheduling-agent" &&
          Boolean(candidate.clientId?.startsWith(batchId))
        );
        for (const sibling of siblingDrafts) {
          await sibling.markAsDeleted();
        }
      }
    });
    syncCalendarChanges();
  };

  const declineDraftEvent = (event: CalendarEvent) => {
    Alert.alert("Vorschlag ablehnen", "Möchtest du diesen Vorschlag wirklich ablehnen?", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Ja, ablehnen",
        style: "destructive",
        onPress: async () => {
          if (event.serverId && currentUser?.familyId) {
            try {
              await deleteEvent({ eventId: event.serverId as any, familyId: currentUser.familyId as any });
            } catch (error) {
              console.warn("Online draft delete failed, will sync offline", error);
            }
          }
          await database.write(async () => {
            await event.markAsDeleted();
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
    setSchedulingResourceId(null);
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
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
    if (!isoRegex.test(sanitizedStart) || !isoRegex.test(sanitizedEnd)) {
      Alert.alert("Datum ungültig", "Bitte gib einen gültigen Start- und Endzeitpunkt im ISO-Format (z.B. YYYY-MM-DDTHH:MM:SSZ) an.");
      return;
    }
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
        resourceId: schedulingResourceId ? schedulingResourceId as any : undefined,
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
    if (!isChild) {
      Alert.alert("Fehler", "Nur Kinder dürfen Einspruch gegen Termine erheben.");
      return;
    }
    if (reason.length > 500) {
      Alert.alert("Fehler", "Der Grund für den Einspruch darf maximal 500 Zeichen lang sein.");
      return;
    }
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

  const showFab = isTablet || !selectedEvent;

  return (
    <View accessibilityLabel="Kalenderdashboard" style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.appTitle}>Familienkalender</Text>
          <Text accessibilityLabel="Sichtbarer Kalenderzeitraum" style={styles.rangeLabel} numberOfLines={1}>
            {formatDateLabel(visibleRange.start.slice(0, 10))} – {formatDateLabel(new Date(Date.parse(visibleRange.end) - 1).toISOString().slice(0, 10))}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <View style={styles.statusDotWrap}><StatusDot /></View>
          <IconButton name="sync" variant="tinted" accessibilityLabel="Kalender synchronisieren" onPress={syncCalendarChanges} />
          <IconButton name="chatbubble-ellipses-outline" variant="tinted" accessibilityLabel="Chats öffnen" onPress={() => router.push("/chats" as Href)} />
          <IconButton name="mic" variant="solid" accessibilityLabel="Spracheingabe öffnen" onPress={() => router.push("/voice-input" as Href)} />
        </View>
      </View>

      <DailyDigestCard digest={dailyDigest} loading={dailyDigest === undefined} dateStr={todayDateStr} />

      {canReviewDrafts ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Terminvorschläge generieren" style={styles.schedulingButton} onPress={openSchedulingModal}>
          <Ionicons name="sparkles" size={16} color={colors.slate} />
          <Text style={styles.schedulingButtonText}>Terminvorschläge generieren</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.toolbar}>
        <SegmentedControl
          segments={VIEW_SEGMENTS}
          value={calendarView}
          onChange={(view) => setCalendarView(view)}
          accessibilityLabel="Kalenderansicht umschalten"
        />
        <View style={styles.navRow} accessibilityLabel="Kalenderzeitraum navigieren">
          <IconButton name="chevron-back" variant="tinted" accessibilityLabel="Vorheriger Zeitraum" onPress={() => shiftFocus(-1)} />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Heutigen Zeitraum anzeigen" style={styles.todayButton} onPress={goToday}>
            <Ionicons name="today-outline" size={16} color={colors.ink} />
            <Text style={styles.todayButtonText}>Heute</Text>
          </TouchableOpacity>
          <IconButton name="chevron-forward" variant="tinted" accessibilityLabel="Nächster Zeitraum" onPress={() => shiftFocus(1)} />
        </View>
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
          <View style={styles.sheet}>
            <Text style={styles.panelTitle}>Terminvorschläge generieren</Text>
            <TextInput accessibilityLabel="Titel für Terminvorschläge" style={styles.input} value={schedulingTitle} onChangeText={setSchedulingTitle} placeholder="Titel" placeholderTextColor={colors.inkFaint} />
            <TextInput accessibilityLabel="Dauer in Minuten" style={styles.input} value={schedulingDuration} onChangeText={setSchedulingDuration} keyboardType="number-pad" placeholder="Dauer in Minuten" placeholderTextColor={colors.inkFaint} />
            <TextInput accessibilityLabel="Start des Wunschzeitraums" style={styles.input} value={schedulingStart} onChangeText={setSchedulingStart} placeholder="Start ISO" placeholderTextColor={colors.inkFaint} />
            <TextInput accessibilityLabel="Ende des Wunschzeitraums" style={styles.input} value={schedulingEnd} onChangeText={setSchedulingEnd} placeholder="Ende ISO" placeholderTextColor={colors.inkFaint} />
            <View style={styles.resourceOptions}>
              <TouchableOpacity accessibilityRole="button" style={[styles.resourceOption, !schedulingResourceId && styles.resourceOptionSelected]} onPress={() => setSchedulingResourceId(null)}>
                <Text style={[styles.resourceOptionText, !schedulingResourceId && styles.resourceOptionTextSelected]}>Keine Ressource</Text>
              </TouchableOpacity>
              {(virtualMembers ?? []).filter((member: any) => member.type === "resource").map((resource: any) => (
                <TouchableOpacity key={String(resource._id)} accessibilityRole="button" style={[styles.resourceOption, schedulingResourceId === resource._id && styles.resourceOptionSelected]} onPress={() => setSchedulingResourceId(String(resource._id))}>
                  <Text style={[styles.resourceOptionText, schedulingResourceId === resource._id && styles.resourceOptionTextSelected]}>{resource.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.draftActions}>
              <TouchableOpacity accessibilityRole="button" disabled={isSubmittingScheduling} style={[styles.draftActionButton, styles.neutralButton]} onPress={closeSchedulingModal}>
                <Text style={styles.neutralButtonText}>Abbrechen</Text>
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
          <View style={styles.sheet}>
            <Text style={styles.panelTitle}>Einspruch erheben</Text>
            <Text style={styles.contextText}>Warum passt dieser Termin für dich nicht?</Text>
            <TextInput
              accessibilityLabel="Grund für Einspruch eingeben"
              style={[styles.input, styles.inputMultiline]}
              value={vetoReason}
              onChangeText={setVetoReason}
              placeholder="Kurzer Grund …"
              placeholderTextColor={colors.inkFaint}
              maxLength={500}
              multiline
            />
            <View style={styles.draftActions}>
              <TouchableOpacity accessibilityRole="button" style={[styles.draftActionButton, styles.neutralButton]} onPress={() => setVetoDraftEvent(null)}>
                <Text style={styles.neutralButtonText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={[styles.draftActionButton, styles.vetoButton]} onPress={submitLocalVeto}>
                <Text style={styles.draftActionText}>Absenden</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {showFab ? (
        <Fab
          onPress={() => router.push("/event-editor" as Href)}
          accessibilityLabel="Neuen Termin hinzufügen"
          label="Termin"
          bottomInset={insets.bottom}
        />
      ) : null}
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
        contentContainerStyle={styles.scrollPad}
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
  const isEmpty = events.length === 0;
  return (
    <View key={day} style={[styles.dayCell, compact && styles.monthCell, isEmpty && styles.dayCellEmpty]}>
      <Text style={[styles.dayLabel, compact && styles.monthDayLabel]}>{formatDateLabel(day)}</Text>
      {events.slice(0, compact ? 2 : undefined).map((event) => (
        <CalendarCard key={getOccurrenceKey(event)} event={event} compact selected={isEventSelected(selectedEvent, event)} onPress={onSelect} />
      ))}
      {isEmpty ? <Text style={styles.miniEmpty}>frei</Text> : null}
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
          <Text style={[styles.navActionText, currentView === view && styles.navActionTextActive]}>{VIEW_LABELS[view]}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={[styles.navAction, styles.navActionPrimary]} onPress={addEvent}>
        <Ionicons name="add" size={18} color={colors.onAccent} />
        <Text style={styles.navActionPrimaryText}>Termin</Text>
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
      <View style={styles.panelHandle} />
      <Text style={styles.panelTitle}>Details</Text>
      {event ? (
        <>
          <Text style={styles.contextTitle}>{event.title}</Text>
          <View style={styles.contextMetaRow}>
            <Ionicons name="time-outline" size={15} color={colors.slate} />
            <Text style={styles.contextMeta}>{new Date(event.startDate).toLocaleString()} – {new Date(event.endDate).toLocaleString()}</Text>
          </View>
          {event.description ? <Text style={styles.contextText}>{event.description}</Text> : null}
          {event.vetoStatus === "vetoed" ? (
            <View style={styles.vetoPanel}>
              <VetoBadge />
              {event.vetoReason ? <Text style={styles.contextText}>Grund: {event.vetoReason}</Text> : null}
            </View>
          ) : null}
          {actions.isChild ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Einspruch gegen Termin erheben" style={[styles.draftActionButton, styles.vetoButton, styles.fullButton]} onPress={() => actions.onRaiseVeto(event)}>
              <Text style={styles.draftActionText}>Einspruch erheben</Text>
            </TouchableOpacity>
          ) : null}
          {showParentVetoActions ? (
            <View style={styles.draftActions} accessibilityLabel="Einspruch klären">
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Klärungs-Chat öffnen" style={[styles.draftActionButton, styles.approveButton]} onPress={() => actions.onOpenClarificationChat(event)}>
                <Text style={styles.draftActionText}>Klärungs-Chat öffnen</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Einspruch aufheben" style={[styles.draftActionButton, styles.neutralButton]} onPress={() => actions.onClearVeto(event)}>
                <Text style={styles.neutralButtonText}>Einspruch aufheben</Text>
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
  return (
    <View accessibilityLabel="Leerer Kalenderstatus" style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons name="calendar-clear-outline" size={28} color={colors.sage} />
      </View>
      <Text style={styles.empty}>{text}</Text>
    </View>
  );
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
          <View style={styles.headerText}>
            <Text style={styles.appTitle}>Familienkalender</Text>
          </View>
          <View style={styles.statusDotWrap}><StatusDot /></View>
        </View>
        <View style={styles.emptyContainer}>
          <EmptyState text="Familie wird geladen …" />
        </View>
      </View>
    );
  }

  return <EnhancedDashboard familyId={familyId} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerText: { flex: 1 },
  appTitle: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 32, color: colors.ink },
  rangeLabel: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.slate, marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  statusDotWrap: { width: 16, height: 16, alignItems: "center", justifyContent: "center", marginRight: spacing.xs },

  schedulingButton: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    minHeight: 46,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.slateSoft,
    borderWidth: 1,
    borderColor: colors.slate,
  },
  schedulingButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.slate },

  toolbar: { paddingHorizontal: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  todayButton: {
    flex: 1,
    minHeight: hitTarget,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  todayButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },

  phoneContent: { flex: 1 },
  phoneCalendar: { flex: 1 },
  phoneContext: { maxHeight: 440, marginHorizontal: spacing.lg, marginTop: spacing.sm },
  tabletLayout: { flex: 1, flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg },
  sideColumn: { flex: 1 },
  centerColumn: { flex: 2 },

  panel: { flex: 1, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: spacing.lg, ...elevation.low },
  panelHandle: { alignSelf: "center", width: 36, height: 4, borderRadius: radius.pill, backgroundColor: colors.lineStrong, marginBottom: spacing.sm },
  panelTitle: { fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink, marginBottom: spacing.sm },
  navAction: { minHeight: hitTarget, flexDirection: "row", gap: spacing.sm, alignItems: "center", borderRadius: radius.md, paddingHorizontal: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.surfaceMuted },
  navActionActive: { backgroundColor: colors.sageSoft },
  navActionText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.inkSoft },
  navActionTextActive: { color: colors.sageDark },
  navActionPrimary: { backgroundColor: colors.sage, justifyContent: "center", marginTop: spacing.xs },
  navActionPrimaryText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.onAccent },

  contextTitle: { fontFamily: fonts.displaySemiBold, fontSize: 17, color: colors.ink },
  contextMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
  contextMeta: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.slate, flexShrink: 1 },
  contextText: { fontFamily: fonts.bodyRegular, fontSize: 15, lineHeight: 22, color: colors.inkSoft, marginTop: spacing.sm },

  modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.scrim },
  sheet: { width: "100%", maxWidth: 420, borderRadius: radius.xl, backgroundColor: colors.surface, padding: spacing.xl, ...elevation.high },
  input: { minHeight: hitTarget, marginTop: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontFamily: fonts.bodyRegular, fontSize: 15, color: colors.ink, backgroundColor: colors.surfaceMuted },
  inputMultiline: { minHeight: 96, textAlignVertical: "top" },
  vetoPanel: { marginTop: spacing.md, gap: spacing.xs },
  resourceOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  resourceOption: { minHeight: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, backgroundColor: colors.surfaceMuted },
  resourceOptionSelected: { borderColor: colors.sage, backgroundColor: colors.sageSoft },
  resourceOptionText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft },
  resourceOptionTextSelected: { color: colors.sageDark },

  draftActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  draftActionButton: { flex: 1, minHeight: hitTarget, minWidth: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, paddingHorizontal: spacing.md },
  fullButton: { flex: 0, marginTop: spacing.md },
  approveButton: { backgroundColor: colors.sage },
  declineButton: { backgroundColor: colors.clay },
  vetoButton: { backgroundColor: colors.clay },
  neutralButton: { backgroundColor: colors.surfaceSunken },
  draftActionText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.onAccent },
  neutralButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },

  scrollPad: { paddingBottom: 96 },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.md, paddingBottom: 96 },
  weekGrid: { paddingHorizontal: spacing.lg, paddingBottom: 96 },
  dayList: { paddingBottom: 96 },
  dayCell: { minHeight: 96, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, marginBottom: spacing.sm, padding: spacing.md, ...elevation.low },
  dayCellEmpty: { backgroundColor: colors.surfaceMuted },
  monthCell: { width: "14.285%", aspectRatio: 0.82, minHeight: 110, marginBottom: 0, borderRadius: radius.sm, padding: spacing.xs },
  dayLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink, marginBottom: spacing.xs },
  monthDayLabel: { fontSize: 11 },
  sectionHeader: { fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink, marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.xs },
  miniEmpty: { fontFamily: fonts.bodyMedium, color: colors.inkFaint, fontSize: 12 },
  moreText: { fontFamily: fonts.bodySemiBold, color: colors.slate, fontSize: 12, marginTop: spacing.xs },

  emptyContainer: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyState: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, gap: spacing.md },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.sageSoft },
  empty: { fontFamily: fonts.bodyRegular, fontSize: 15, lineHeight: 22, color: colors.inkSoft, textAlign: "center" },
});
