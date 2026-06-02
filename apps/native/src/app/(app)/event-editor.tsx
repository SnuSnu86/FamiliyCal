import DateTimePicker from "@react-native-community/datetimepicker";
import { useUser } from "@clerk/expo";
import { calendarEventSchema } from "@packages/shared";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Button, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { database } from "../../database";
import { createLocalEvent } from "../../database/helpers/calendar";
import { useFamilyId } from "../../hooks/useFamilyId";

const HOUR_MS = 60 * 60 * 1000;

type FormErrors = Partial<Record<"title" | "start_date" | "end_date" | "family_id" | "rrule" | "timezone_id" | "form", string>>;

export default function EventEditorScreen() {
  const router = useRouter();
  const { user } = useUser();
  const familyId = useFamilyId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(() => new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [allDay, setAllDay] = useState(false);
  const [rrule, setRrule] = useState("");
  const [timezoneId, setTimezoneId] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  );
  const [errors, setErrors] = useState<FormErrors>({});

  const save = async () => {
    if (!familyId) {
      setErrors({ family_id: "Keine aktive Familie gefunden." });
      return;
    }
    if (!user?.id) {
      setErrors({ form: "Kein angemeldeter Benutzer gefunden." });
      return;
    }

    // All-day events: snap start to local midnight, end to the next day's
    // boundary, and mark as floating so they are not shifted by timezone math.
    let effectiveStart = startDate;
    let effectiveEnd = endDate ?? new Date(startDate.getTime() + HOUR_MS);
    let floatingTime = false;
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
      return;
    }

    try {
      await createLocalEvent(database, {
        family_id: familyId,
        creator_id: user.id,
        floating_time: floatingTime,
        ...parsed.data,
      });
      router.back();
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "Termin konnte nicht gespeichert werden." });
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Termin erstellen</Text>

      <Text style={styles.label}>Titel *</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Titel" />
      {errors.title ? <Text style={styles.error}>{errors.title}</Text> : null}

      <Text style={styles.label}>Beschreibung</Text>
      <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} multiline />

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
        value={endDate ?? new Date(startDate.getTime() + HOUR_MS)}
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

      {errors.family_id ? <Text style={styles.error}>{errors.family_id}</Text> : null}
      {errors.form ? <Text style={styles.error}>{errors.form}</Text> : null}

      <Button title="Speichern" onPress={save} />
      <View style={styles.cancel}>{Platform.OS === "ios" ? <Button title="Abbrechen" onPress={() => router.back()} /> : null}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F2EB" },
  content: { padding: 16, gap: 10 },
  heading: { color: "#2A2720", fontSize: 24, fontWeight: "700", marginBottom: 8 },
  label: { color: "#2A2720", fontWeight: "600" },
  input: { backgroundColor: "#FBF9F5", borderColor: "#E2DDD5", borderWidth: 1, borderRadius: 12, padding: 12 },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  error: { color: "#C06C5C" },
  cancel: { marginTop: 8 },
});
