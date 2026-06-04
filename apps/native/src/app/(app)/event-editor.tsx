import DateTimePicker from "@react-native-community/datetimepicker";
import { useUser } from "@clerk/expo";
import { calendarEventSchema } from "@packages/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useConvex } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Q } from "@nozbe/watermelondb";
import React, { useRef, useState } from "react";
import { Alert, Button, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";

import { database } from "../../database";
import { CalendarEvent } from "../../database/models/CalendarEvent";
import { useFamilyId } from "../../hooks/useFamilyId";
import { syncPendingCalendarEvents } from "../../sync/calendarSync";

const HOUR_MS = 60 * 60 * 1000;

type FormErrors = Partial<Record<"title" | "start_date" | "end_date" | "family_id" | "rrule" | "timezone_id" | "form", string>>;

export default function EventEditorScreen() {
  const router = useRouter();
  const { user } = useUser();
  const familyId = useFamilyId();
  const convexClient = useConvex();
  const params = useLocalSearchParams<{
    draftEventId?: string;
    title?: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    allDay?: string;
    floatingTime?: string;
    isPrivate?: string;
  }>();

  const syncCalendarEvent = useMutation(api.calendarEvents.syncCalendarEvent);
  const deleteEvent = useMutation(api.calendarEvents.deleteEvent);

  const [title, setTitle] = useState(params.title ?? "");
  const [description, setDescription] = useState(params.description ?? "");
  const [startDate, setStartDate] = useState<Date>(() => {
    if (params.startDate) {
      const parsed = Date.parse(params.startDate);
      if (!Number.isNaN(parsed)) return new Date(parsed);
    }
    return new Date();
  });
  const [endDate, setEndDate] = useState<Date>(() => {
    if (params.endDate) {
      const parsed = Date.parse(params.endDate);
      if (!Number.isNaN(parsed)) return new Date(parsed);
    }
    return new Date(Date.now() + HOUR_MS);
  });
  const [allDay, setAllDay] = useState(params.allDay === "true");
  const [isPrivate, setIsPrivate] = useState(params.isPrivate === "true");
  const [rrule, setRrule] = useState("");
  const [timezoneId, setTimezoneId] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const triggerSync = () => {
    syncPendingCalendarEvents({ db: database, convexClient })
      .catch((error) => console.warn("Sync trigger failed after editor action", error));
  };

  const confirm = async () => {
    if (!familyId) {
      setErrors({ family_id: "Keine aktive Familie gefunden." });
      return;
    }
    if (!user?.id) {
      setErrors({ form: "Kein angemeldeter Benutzer gefunden." });
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setErrors({});

    // All-day events adjustment
    let effectiveStart = startDate;
    let effectiveEnd = endDate;
    let floatingTime = params.floatingTime === "true";

    if (allDay) {
      const dayStart = new Date(startDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      effectiveStart = dayStart;
      effectiveEnd = dayEnd;
      floatingTime = true;
    }

    const data = {
      title,
      description: description || undefined,
      start_date: effectiveStart.toISOString(),
      end_date: effectiveEnd.toISOString(),
      all_day: allDay,
      is_private: isPrivate,
      rrule: rrule.trim() || undefined,
      timezone_id: floatingTime ? undefined : timezoneId,
    };

    const parsed = calendarEventSchema.safeParse(data);
    if (!parsed.success) {
      const nextErrors: FormErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FormErrors;
        nextErrors[key] = issue.message;
      }
      setErrors(nextErrors);
      savingRef.current = false;
      setSaving(false);
      return;
    }

    try {
      let responseServerId: string | null = null;
      try {
        const response = await syncCalendarEvent({
          serverId: params.draftEventId as any,
          familyId: familyId as any,
          clientId: params.draftEventId ? `confirmed-${params.draftEventId}` : `manual-${Date.now()}`,
          title,
          description: description || undefined,
          startDate: effectiveStart.toISOString(),
          endDate: effectiveEnd.toISOString(),
          allDay,
          rrule: rrule.trim() || undefined,
          timezoneId: floatingTime ? "UTC" : timezoneId,
          floatingTime,
          isPrivate,
          vetoStatus: undefined,
          vetoReason: undefined,
          vetoChildId: undefined,
          status: "confirmed",
          locallyChangedFields: ["title", "description", "startDate", "endDate", "allDay", "floatingTime", "isPrivate", "status"],
        });
        responseServerId = response?.serverId ?? null;
      } catch (err) {
        console.warn("Online sync failed during confirm, will sync offline", err);
      }

      await database.write(async () => {
        if (params.draftEventId) {
          const localDrafts = await database.get<CalendarEvent>("calendar_events").query(Q.where("server_id", params.draftEventId)).fetch();
          if (localDrafts.length > 0) {
            const localEvent = localDrafts[0];
            await localEvent.update((event) => {
              event.title = title;
              event.description = description || undefined;
              event.startDate = effectiveStart.toISOString();
              event.endDate = effectiveEnd.toISOString();
              event.allDay = allDay;
              event.floatingTime = floatingTime;
              event.isPrivate = isPrivate;
              event.status = "confirmed";
              if (responseServerId) {
                event.serverId = responseServerId;
              }
            });
            return;
          }
        }

        // Create new local event in the same transaction
        const events = database.get<CalendarEvent>("calendar_events");
        await events.create((event: CalendarEvent) => {
          event.serverId = responseServerId;
          event.familyId = familyId;
          event.creatorId = user.id;
          event.title = title;
          event.description = description || undefined;
          event.startDate = effectiveStart.toISOString();
          event.endDate = effectiveEnd.toISOString();
          event.allDay = allDay;
          event.rrule = rrule.trim() || undefined;
          event.timezoneId = floatingTime ? undefined : timezoneId;
          event.floatingTime = floatingTime;
          event.isPrivate = isPrivate;
          event.status = "confirmed";
        });
      });

      triggerSync();
      router.back();
    } catch (error) {
      Alert.alert("Speichern fehlgeschlagen", error instanceof Error ? error.message : String(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const discard = async () => {
    if (!familyId) return router.back();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);

    try {
      if (params.draftEventId) {
        try {
          await deleteEvent({ eventId: params.draftEventId as any, familyId: familyId as any });
        } catch (error) {
          console.warn("Server delete failed during discard, will sync offline", error);
        }

        // Delete locally from WatermelonDB in a write transaction
        const localDrafts = await database.get<CalendarEvent>("calendar_events").query(Q.where("server_id", params.draftEventId)).fetch();
        if (localDrafts.length > 0) {
          await database.write(async () => {
            await localDrafts[0].markAsDeleted();
          });
        }
      }
      triggerSync();
      router.back();
    } catch (error) {
      Alert.alert("Verwerfen fehlgeschlagen", error instanceof Error ? error.message : String(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{params.draftEventId ? "Terminentwurf bestätigen" : "Termin bearbeiten"}</Text>

      <Text style={styles.label}>Titel *</Text>
      <TextInput accessibilityLabel="Titel" style={styles.input} value={title} onChangeText={setTitle} placeholder="Titel" />
      {errors.title ? <Text style={styles.error}>{errors.title}</Text> : null}

      <Text style={styles.label}>Beschreibung</Text>
      <TextInput accessibilityLabel="Beschreibung" style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} multiline placeholder="Beschreibung" />

      <Text style={styles.label}>Startzeit</Text>
      <DateTimePicker
        value={startDate}
        mode="datetime"
        onChange={(event, date) => {
          if (event.type !== "dismissed" && date) setStartDate(date);
        }}
      />
      {errors.start_date ? <Text style={styles.error}>{errors.start_date}</Text> : null}

      <Text style={styles.label}>Endzeit</Text>
      <DateTimePicker
        value={endDate}
        mode="datetime"
        onChange={(event, date) => {
          if (event.type !== "dismissed" && date) setEndDate(date);
        }}
      />
      {errors.end_date ? <Text style={styles.error}>{errors.end_date}</Text> : null}

      <View style={styles.switchRow}>
        <Text style={styles.label}>Ganztägig</Text>
        <Switch value={allDay} onValueChange={setAllDay} />
      </View>

      <View style={styles.privateCard}>
        <View style={styles.privateText}>
          <Text style={styles.label}>Privat</Text>
          <Text style={styles.helperText}>AI-Agenten sehen nur Zeitraum und Label.</Text>
        </View>
        <Switch value={isPrivate} onValueChange={setIsPrivate} trackColor={{ false: "#D8D0C3", true: "#B99B6B" }} thumbColor={isPrivate ? "#7A5A2E" : "#FBF9F5"} />
      </View>

      {!params.draftEventId ? (
        <>
          <Text style={styles.label}>Wiederholungsregel</Text>
          <TextInput style={styles.input} value={rrule} onChangeText={setRrule} placeholder="FREQ=WEEKLY;COUNT=10" autoCapitalize="characters" />
          {errors.rrule ? <Text style={styles.error}>{errors.rrule}</Text> : null}

          {!allDay ? (
            <>
              <Text style={styles.label}>Zeitzone</Text>
              <TextInput style={styles.input} value={timezoneId} onChangeText={setTimezoneId} />
              {errors.timezone_id ? <Text style={styles.error}>{errors.timezone_id}</Text> : null}
            </>
          ) : null}
        </>
      ) : null}

      {errors.family_id ? <Text style={styles.error}>{errors.family_id}</Text> : null}
      {errors.form ? <Text style={styles.error}>{errors.form}</Text> : null}

      <TouchableOpacity accessibilityRole="button" disabled={saving} style={styles.confirmButton} onPress={confirm}>
        <Text style={styles.buttonText}>Bestätigen</Text>
      </TouchableOpacity>

      {params.draftEventId ? (
        <TouchableOpacity accessibilityRole="button" disabled={saving} style={styles.discardButton} onPress={discard}>
          <Text style={styles.buttonText}>Verwerfen</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.cancel}>
        {Platform.OS === "ios" || !params.draftEventId ? (
          <Button title="Abbrechen" onPress={() => router.back()} color="#5C7C8A" />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F2EB" },
  content: { padding: 16, gap: 10 },
  heading: { color: "#2A2720", fontSize: 24, fontWeight: "700", marginBottom: 8 },
  label: { color: "#2A2720", fontWeight: "600" },
  input: { backgroundColor: "#FBF9F5", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 12, padding: 12, color: "#2A2720" },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  privateCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#EFE6D8", borderColor: "#D8C8AE", borderWidth: 1, borderRadius: 16, padding: 12 },
  privateText: { flex: 1, paddingRight: 12 },
  helperText: { color: "#6F675B", marginTop: 2 },
  error: { color: "#C06C5C" },
  cancel: { marginTop: 8 },
  confirmButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#7D9B84", marginTop: 12 },
  discardButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#C06C5C", marginTop: 8 },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
});
