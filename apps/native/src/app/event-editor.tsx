import { api } from "@packages/backend/convex/_generated/api";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "convex/react";
import React, { useState } from "react";
import { Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";

import { database } from "../database";
import { createLocalEvent } from "../database/helpers/calendar";
import { useFamilyId } from "../hooks/useFamilyId";

export default function EventEditorRoute() {
  const router = useRouter();
  const familyId = useFamilyId();
  const params = useLocalSearchParams<{
    draftEventId?: string;
    title?: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    allDay?: string;
    floatingTime?: string;
  }>();
  const syncCalendarEvent = useMutation(api.calendarEvents.syncCalendarEvent);
  const deleteEvent = useMutation(api.calendarEvents.deleteEvent);

  const [title, setTitle] = useState(params.title ?? "");
  const [description, setDescription] = useState(params.description ?? "");
  const [startDate, setStartDate] = useState(params.startDate ?? new Date().toISOString());
  const [endDate, setEndDate] = useState(params.endDate ?? new Date(Date.now() + 60 * 60 * 1000).toISOString());
  const [allDay, setAllDay] = useState(params.allDay === "true");
  const [floatingTime, setFloatingTime] = useState(params.floatingTime === "true");
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (!familyId) return;
    setSaving(true);
    try {
      const response = await syncCalendarEvent({
        serverId: params.draftEventId as any,
        familyId: familyId as any,
        clientId: params.draftEventId ? `confirmed-${params.draftEventId}` : `manual-${Date.now()}`,
        title,
        description: description || undefined,
        startDate,
        endDate,
        allDay,
        rrule: undefined,
        timezoneId: "UTC",
        floatingTime,
        vetoStatus: undefined,
        vetoReason: undefined,
        vetoChildId: undefined,
        status: "confirmed",
        locallyChangedFields: ["title", "description", "startDate", "endDate", "allDay", "floatingTime", "status"],
      });
      const localEvent = await createLocalEvent(database, {
        family_id: familyId,
        title,
        description: description || undefined,
        start_date: startDate,
        end_date: endDate,
        all_day: allDay,
        timezone_id: "UTC",
        floating_time: floatingTime,
        status: "confirmed",
      });
      if (response?.serverId) {
        await database.write(async () => {
          await localEvent.update((event) => {
            event.serverId = response.serverId;
          });
        });
      }
      router.back();
    } catch (error) {
      Alert.alert("Speichern fehlgeschlagen", String(error));
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    if (!familyId || !params.draftEventId) return router.back();
    setSaving(true);
    try {
      await deleteEvent({ eventId: params.draftEventId as any, familyId: familyId as any });
      router.back();
    } catch (error) {
      Alert.alert("Verwerfen fehlgeschlagen", String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{params.draftEventId ? "Terminentwurf bestätigen" : "Termin bearbeiten"}</Text>
      <TextInput accessibilityLabel="Titel" style={styles.input} value={title} onChangeText={setTitle} placeholder="Titel" />
      <TextInput accessibilityLabel="Beschreibung" style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} placeholder="Beschreibung" multiline />
      <TextInput accessibilityLabel="Startdatum ISO" style={styles.input} value={startDate} onChangeText={setStartDate} />
      <TextInput accessibilityLabel="Enddatum ISO" style={styles.input} value={endDate} onChangeText={setEndDate} />
      <View style={styles.row}><Text style={styles.label}>Ganztägig</Text><Switch value={allDay} onValueChange={setAllDay} /></View>
      <View style={styles.row}><Text style={styles.label}>Flexible Zeit</Text><Switch value={floatingTime} onValueChange={setFloatingTime} /></View>
      <TouchableOpacity accessibilityRole="button" disabled={saving} style={styles.confirmButton} onPress={confirm}>
        <Text style={styles.buttonText}>Bestätigen</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" disabled={saving} style={styles.discardButton} onPress={discard}>
        <Text style={styles.buttonText}>Verwerfen</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#F5F2EB" },
  heading: { color: "#2A2720", fontSize: 24, fontWeight: "700", marginBottom: 16 },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#E2DDD5", borderRadius: 12, backgroundColor: "#FBF9F5", paddingHorizontal: 12, marginBottom: 12, color: "#2A2720" },
  multiline: { minHeight: 88, paddingTop: 12, textAlignVertical: "top" },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  label: { color: "#2A2720", fontWeight: "600" },
  confirmButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#7D9B84", marginTop: 12 },
  discardButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#C06C5C", marginTop: 8 },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
});
