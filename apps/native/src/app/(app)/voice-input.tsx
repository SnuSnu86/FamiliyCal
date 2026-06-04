import { api } from "@packages/backend/convex/_generated/api";
import { Audio } from "expo-av";
import { type Href, useRouter } from "expo-router";
import { useAction, useMutation } from "convex/react";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useFamilyId } from "../../hooks/useFamilyId";

type VoiceResult = {
  draftEventId: string;
  parsed: {
    title: string;
    description?: string | null;
    startDate: string;
    endDate: string;
    allDay: boolean;
    floatingTime: boolean;
  };
};

export default function VoiceInputRoute() {
  const router = useRouter();
  const familyId = useFamilyId();
  const generateUploadUrl = useMutation(api.chats.generateUploadUrl);
  const transcribeAndParse = useAction((api as any).whisper.transcribeAndParseVoiceIntent);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isProcessing, setProcessing] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const isMountedRef = useRef(true);
  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch((err) =>
          console.warn("Failed to stop recording on unmount", err)
        );
      }
    };
  }, []);

  useEffect(() => {
    recordingRef.current = recording;
    if (!recording) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.25, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, recording]);

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Mikrofon benötigt", "Bitte erlaube den Mikrofonzugriff, um Spracheingaben aufzunehmen.");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const nextRecording = new Audio.Recording();
      await nextRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await nextRecording.startAsync();
      if (isMountedRef.current) {
        setRecording(nextRecording);
      } else {
        nextRecording.stopAndUnloadAsync().catch(() => {});
      }
    } catch (error) {
      Alert.alert("Aufnahme fehlgeschlagen", String(error));
    }
  };

  const stopRecording = async () => {
    if (!recording || !familyId) return;
    setProcessing(true);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (!uri) throw new Error("Keine Audiodatei gefunden.");

      const uploadUrl = await generateUploadUrl({});
      if (!isMountedRef.current) return;

      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": Platform.OS === "ios" ? "audio/mp4" : "audio/m4a" },
        body: await (await fetch(uri)).blob(),
      });
      if (!uploadResponse.ok) throw new Error("Audio-Upload fehlgeschlagen.");
      const { storageId } = await uploadResponse.json();
      if (!isMountedRef.current) return;

      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Europe/Berlin";
      const result = (await transcribeAndParse({ storageId, familyId, timezone })) as VoiceResult;
      
      if (!isMountedRef.current) return;

      router.push({
        pathname: "/event-editor",
        params: {
          draftEventId: result.draftEventId,
          title: result.parsed.title,
          description: result.parsed.description ?? "",
          startDate: result.parsed.startDate,
          endDate: result.parsed.endDate,
          allDay: String(result.parsed.allDay),
          floatingTime: String(result.parsed.floatingTime),
        },
      } as Href);
    } catch (error) {
      if (isMountedRef.current) {
        Alert.alert("Stimme konnte nicht analysiert werden", String(error));
      }
    } finally {
      if (isMountedRef.current) {
        setProcessing(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Spracheingabe</Text>
      <Text style={styles.copy}>Sprich deinen Termin ein. Während der Verarbeitung bleibt diese Ansicht bedienbar.</Text>
      <Animated.View style={[styles.pulse, recording && { transform: [{ scale: pulse }] }]} />
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={recording ? "Aufnahme stoppen" : "Aufnahme starten"}
        disabled={isProcessing}
        style={[styles.recordButton, recording && styles.recordingButton]}
        onPress={recording ? stopRecording : startRecording}
      >
        <Text style={styles.recordButtonText}>{recording ? "Stoppen" : "Aufnehmen"}</Text>
      </TouchableOpacity>
      {isProcessing ? <Text accessibilityLiveRegion="polite" style={styles.processing}>Stimme wird analysiert...</Text> : null}
      <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={() => router.back()}>
        <Text style={styles.secondaryText}>Abbrechen</Text>
      </TouchableOpacity>
    </View>
  );
}

const minTouch = Platform.OS === "ios" ? 44 : 48;
const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F5F2EB" },
  heading: { color: "#2A2720", fontSize: 26, fontWeight: "700" },
  copy: { color: "#5C7C8A", textAlign: "center", marginTop: 12, marginBottom: 32 },
  pulse: { width: 88, height: 88, borderRadius: 44, backgroundColor: "#C06C5C", opacity: 0.35, marginBottom: -76 },
  recordButton: { minWidth: 144, minHeight: minTouch, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, backgroundColor: "#7D9B84" },
  recordingButton: { backgroundColor: "#C06C5C" },
  recordButtonText: { color: "#FFFFFF", fontWeight: "700" },
  processing: { color: "#2A2720", marginTop: 24, fontWeight: "600" },
  secondaryButton: { minHeight: minTouch, justifyContent: "center", marginTop: 18, paddingHorizontal: 16 },
  secondaryText: { color: "#5C7C8A", fontWeight: "700" },
});
