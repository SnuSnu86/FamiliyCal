import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

type DigestEvent = {
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  vetoStatus?: string;
  vetoReason?: string;
};

type Props = {
  dateStr: string;
  familyName: string;
  userName: string;
  digestBody: string;
  events: DigestEvent[];
};

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${dateStr}T00:00:00.000Z`));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}

export function MonochromeDigestDocument({ dateStr, familyName, userName, digestBody, events }: Props) {
  return (
    <Document title={`FamilyCal Tagesbericht ${dateStr}`} author="FamilyCal">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Tagesbericht - {formatDate(dateStr)}</Text>
          <Text style={styles.meta}>Familie: {familyName}</Text>
          <Text style={styles.meta}>Benutzer: {userName}</Text>
        </View>

        <View style={styles.digestBox}>
          <Text style={styles.sectionTitle}>Daily Digest</Text>
          <Text style={styles.digestText}>{digestBody || "Keine Zusammenfassung vorhanden."}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Termine</Text>
          {events.length === 0 ? (
            <Text style={styles.empty}>Keine Termine für diesen Tag.</Text>
          ) : (
            events.map((event, index) => (
              <View key={`${event.startDate}-${index}`} style={styles.eventRow}>
                <Text style={styles.eventTime}>{formatTime(event.startDate)} - {formatTime(event.endDate)}</Text>
                <Text style={styles.eventTitle}>{event.title}</Text>
                {event.description ? <Text style={styles.eventDescription}>{event.description}</Text> : null}
                {event.vetoStatus ? <Text style={styles.veto}>[VETO: {event.vetoReason || event.vetoStatus}]</Text> : null}
              </View>
            ))
          )}
        </View>
      </Page>
    </Document>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF", color: "#000000", padding: 36, fontFamily: "Helvetica", fontSize: 12, lineHeight: 1.45 },
  header: { marginBottom: 18, paddingBottom: 12, borderBottom: "1px solid #000000" },
  title: { fontFamily: "Helvetica-Bold", fontSize: 22, color: "#000000", marginBottom: 8 },
  meta: { color: "#333333", fontSize: 11, marginBottom: 3 },
  digestBox: { border: "1px solid #000000", padding: 12, marginBottom: 16 },
  section: { marginTop: 4 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 15, marginBottom: 8, color: "#000000" },
  digestText: { fontSize: 13, color: "#000000" },
  eventRow: { borderBottom: "1px solid #CCCCCC", paddingBottom: 9, marginBottom: 9 },
  eventTime: { fontFamily: "Helvetica-Bold", color: "#000000", marginBottom: 3 },
  eventTitle: { fontFamily: "Helvetica-Bold", color: "#000000", fontSize: 13, marginBottom: 3 },
  eventDescription: { color: "#333333", marginBottom: 3 },
  veto: { fontFamily: "Helvetica-Bold", color: "#000000", marginTop: 4 },
  empty: { color: "#333333" },
});
