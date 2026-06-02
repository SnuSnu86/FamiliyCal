---
title: PRD – AI-gestützte Familienkalender- und Kommunikations-App (FamilyCal)
status: final
created: 2026-06-01
updated: 2026-06-01
---

# PRD – AI-gestützte Familienkalender- und Kommunikations-App (FamilyCal)

## 1. Überblick

Dieses Dokument beschreibt die Produktanforderungen für eine mobile-first Familien-App, die funktional an TimeTree angelehnt ist und zusätzlich einen sicheren Chat, Family-Management-Funktionen sowie AI-Agents für Planung, Koordination und Automatisierung integriert. TimeTree selbst deckt bereits gemeinsam genutzte Kalender, Event-bezogene Kommunikation, Erinnerungen, Memos, Alben, Mitgliederverwaltung und externe Kalender-Integrationen ab, wodurch ein belastbarer Referenzumfang für das Zielprodukt vorliegt.

Die technische Zielarchitektur dieses Produkts basiert auf Convex als Backend- und Realtime-Datenplattform sowie Clerk für Authentifizierung und User-Management. Diese Kombination eignet sich besonders für mobile kollaborative Anwendungen mit hoher Realtime-Anforderung.

---

## 2. Glossar (Glossary) & Benutzerrollen

### 2.1 Glossar (GLOS)

- **GLOS-001 (Family / Familie):** Die übergeordnete administrative und datenschutzrechtliche Grenze. Alle Daten (Kalender, Chats, Memos) gehören zu einer Familie.
- **GLOS-002 (Shared Calendar / Geteilter Kalender):** Ein innerhalb der Familie gemeinsam genutzter Kalender mit individueller farblicher Kennzeichnung.
- **GLOS-003 (Termin):** Ein Eintrag im Kalender mit Zeitbezug, Beschreibungen, Zuweisungen und optionalen Anhängen/Checklisten. (Der Begriff "Event" wird synonym im Code verwendet, im PRD gilt "Termin" als Standard).
- **GLOS-004 (Memo / Notiz):** Ein freier Text- oder Listen-Eintrag ohne festes Datum (z. B. Einkaufslisten, Packlisten).
- **GLOS-005 (Secure Chat / Sicherer Chat):** Ein Ende-zu-Ende verschlüsselter (E2EE) Chatbereich, dessen Inhalte für den Server und AI-Agents unlesbar sind.
- **GLOS-006 (Standard Chat):** Ein transportverschlüsselter, aber auf dem Server unverschlüsselter Chatkanal für die normale Familienkommunikation, der für AI-Agents lesbar ist.
- **GLOS-007 (Virtual Member / Virtuelles Mitglied):** Ein planbares Objekt im Kalender (z. B. Haustier, Familienauto), das kein Benutzerkonto besitzt und als buchungspflichtige Ressource behandelt wird.
- **GLOS-008 (Caregiver Portal):** Ein passwortloses, Clerk-authentifiziertes Web-Frontend für externe Betreuungspersonen, das ausschließlich das Einreichen von Vorschlägen ermöglicht.

### 2.2 Benutzerrollen (ROLE)

Die Authentifizierung läuft über Clerk. Die fachlichen Rechte werden granular in Convex verwaltet:

| Rollen-ID | Rolle | Beschreibung | Rechte |
|---|---|---|---|
| **ROLE-001** | Family Owner | Ersteller der Familie | Vollzugriff, Abrechnungs- und administrative Verwaltung |
| **ROLE-002** | Parent/Guardian | Elternteil / Vormund | Voller Lese-/Schreibzugriff auf Kalender, Chats, Memos und Mitgliederverwaltung |
| **ROLE-003** | Adult Member | Volljähriges Mitglied | Standard Lese-/Schreibzugriff, keine administrative Verwaltung |
| **ROLE-004** | Child Member | Minderjähriges Mitglied | Eingeschränkter Zugriff, elterliche Kontrolle über AI-Features, stilles Veto-Dashboard |
| **ROLE-005** | Caregiver | Betreuungsperson / Babysitter | Nur Zugriff auf freigegebene Kalender/Chats via Caregiver Portal oder App |
| **ROLE-006** | Grandparent | Großelternteil | Standardmäßig Lesezugriff, optional Schreibrechte über Caregiver Portal oder App |

---

## 3. Produktvision & Ziele

### 3.1 Produktvision
Das Produkt soll als zentrales digitales Betriebssystem für Familien dienen. Es führt Terminplanung, Gruppen- und Einzelkommunikation, Aufgabenkoordination, Verfügbarkeitsabgleiche, Medien- und Informationsaustausch sowie AI-gestützte Assistenz in einer einheitlichen mobilen Erfahrung zusammen, um die organisatorische Reibung im Familienalltag zu reduzieren.

### 3.2 Produktziele
- **Z-001:** Aufbau einer mobilen Familien-App mit geteiltem Kalender als Kernfunktion.
- **Z-002:** Ergänzung um sichere Gruppen- und 1:1-Chats.
- **Z-003:** Integration von AI-Agents für Planung, Konflikterkennung und Zusammenfassungen (Human-in-the-Loop).
- **Z-004:** Entwicklung eines modernen TypeScript-first Produkts mit Expo, Convex und Clerk.

### 3.3 Nicht-Ziele (Non-Goals)
- **NZ-001:** Keine B2B-Ausrichtung oder klassische Unternehmens-Use-Cases.
- **NZ-002:** Kein vollumfänglicher Ersatz für universelle Messenger-Plattformen in V1.
- **NZ-003:** Keine native Desktop-App in der ersten Produktphase.

---

## 4. User Journeys (UJ)

- **UJ-001 (Terminkonflikt lösen):** 
  *Protagonist:* Sarah (Mutter, ROLE-002)
  *Ablauf:* Sarah trägt einen geschäftlichen Abendtermin ein. Der *Conflict Agent* erkennt, dass Thomas (Vater, ROLE-003) zur selben Zeit beim Sport eingetragen ist und das einzige Familienauto (GLOS-007) blockiert. Da der Konflikt in naher Zukunft liegt (unter 24h), greift ein verkürzter Cooldown von 2 Minuten. Der Agent erstellt automatisch einen temporären Chat-Thread in Convex mit Sarah und Thomas und schlägt zwei konkrete Lösungen vor (z. B. Auto-Tausch oder Babysitter-Anfrage). Sobald sich beide auf eine Lösung einigen, wird diese übernommen und der temporäre Thread nach 48 Stunden automatisch gelöscht.
  
- **UJ-002 (Einbindung externer Betreuungspersonen):**
  *Protagonist:* Opa Herbert (Großvater, ROLE-006)
  *Ablauf:* [ASSUMPTION-001] Opa Herbert besitzt kein Smartphone mit App-Store-Zugang und interagiert lieber über einen Webbrowser. Er erhält eine E-Mail mit einem Clerk-Einladungslink. Da die E-Mail im Spam-Filter hängen bleibt, generiert Sarah (Mutter) in ihrer App einen 6-stelligen, 10 Minuten gültigen Einmal-PIN. Herbert loggt sich über das *Caregiver Portal* (GLOS-008) im Webbrowser mittels dieses PINs ein. Er sieht die für ihn freigegebenen Fahrttermine der Enkelkinder und trägt einen Terminvorschlag ein. In der App der Eltern erscheint dieser Vorschlag als „Draft“. Sarah bestätigt den Vorschlag mit einem Klick, woraufhin der Termin in Convex festgeschrieben wird.

- **UJ-003 (Kindgerechte Tageszusammenfassung):**
  *Protagonist:* Lukas (Kind, 10 Jahre, ROLE-004)
  *Ablauf:* Lukas öffnet morgens sein Tablet. Der *Digest Agent* hat seine Daten analysiert. Da Lukas ein Kinder-Konto besitzt, greifen serverseitige Datenfilter in Convex, sodass nur für ihn freigegebene Termine an das LLM geschickt werden. Lukas erhält eine stark vereinfachte Ansicht ohne Einkaufslisten oder Elterntermine: „Schule bis 13:00 Uhr, danach Fußballtraining. Vergiss deine Schienbeinschoner nicht!“ Lukas sieht im stillen Veto-Dashboard einen vom Vater vorgeschlagenen Zahnarzttermin am Nachmittag und erhebt Einspruch. Der Einspruch blockiert den Termin nicht, markiert ihn aber in der App der Eltern auffällig als „Veto von Lukas“, damit diese das Gespräch mit ihm suchen können.

- **UJ-004 (Sprachsteuerung im Auto):**
  *Protagonist:* Thomas (Vater, ROLE-003)
  *Ablauf:* Thomas fährt Auto und möchte freihändig einen Termin eintragen. Er drückt in der App auf Aufnahme und spricht: „Morgen um 15 Uhr Reifenwechsel bei Autohaus Schmidt“. Die App lädt die Audiodatei direkt in den Convex File Storage hoch, erhält eine URL und triggert asynchron eine Convex Action. Diese transkribiert das Audio via Whisper, extrahiert die Absicht und legt in der Convex-Datenbank einen Terminentwurf (Draft) an. Nach der Transkription wird die Audiodatei automatisch gelöscht, um Speicherplatz zu sparen. Thomas erhält bei der nächsten Ansicht eine Freigabe-Aufforderung.

---

## 5. Funktionale Anforderungen (FR)

### 5.1 Geteilter Kalender (FR-CAL)

- **FR-CAL-001 (Terminerstellung):** Erstellen, Bearbeiten und Löschen von Terminen mit Titel, Beschreibung, Datum, Uhrzeit, Wiederholungsmuster, Labels/Farben, Ort, URL, Checklisten und Dateianhängen.
  - *Akzeptanzkriterium 1:* Jeder Termin benötigt mindestens einen Titel und ein Startdatum. Ungültige Eingaben müssen Client-seitig validiert und abgefangen werden.
  - *Akzeptanzkriterium 2:* Terminerstellungen durch externe Schnittstellen oder AI-Agents dürfen nur als "Draft" (Entwurf) in der DB angelegt werden und benötigen die Freigabe eines Nutzers mit ROLE-001 oder ROLE-002.
- **FR-CAL-002 (Kalenderansichten):** Darstellung des Kalenders in Monats-, Wochen-, Tages- und Agenda-Ansichten.
  - *Akzeptanzkriterium:* Der Benutzer kann flüssig zwischen den Ansichten wechseln. Die Latenz beim Laden der Termindaten aus Convex darf 200ms nicht überschreiten.
- **FR-CAL-003 (Zeitzonen- und Wiederholungslogik):** Jeder Termin muss explizit mit UTC-Zeitstempel, der originalen Zeitzonen-ID (z. B. `Europe/Berlin`) und einem `floating_time`-Flag (für Zeitzonen-unabhängige Termine wie Schulbeginn) gespeichert werden.
  - *Akzeptanzkriterium:* Die Berechnung wiederkehrender Termine (z. B. wöchentliche Termine) muss unter Berücksichtigung von Daylight Saving Time (DST) auf Basis der originalen Zeitzonen-ID evaluiert werden (z. B. via iCal RRule-Parser), nicht über ein fixes UTC-Stunden-Intervall.
- **FR-CAL-004 (Ressourcenbuchung und Konflikte):** Virtuelle Mitglieder (GLOS-007) können Terminen als Ressource zugewiesen werden.
  - *Akzeptanzkriterium 1:* Die Zuweisung einer Ressource (z. B. Auto) zu sich überschneidenden Terminen wird serverseitig in Convex verhindert.
  - *Akzeptanzkriterium 2:* Bei wiederkehrenden Terminen muss die Prüfung auf Doppelbuchungen die voll expandierten Terminvorkommen in einem definierbaren Zeitfenster (z. B. 6 Monate) überprüfen, um Konflikte zwischen Einzelterminen und Serien automatisiert abzufangen.

### 5.2 Kommunikation & Chats (FR-COM)

- **FR-COM-001 (Standard-Chats):** Familien-Gruppenchat, 1:1-Chats und Kommentare direkt an Kalendereinträgen. Diese Kanäle sind unverschlüsselt auf dem Server gespeichert, um AI-Analysen zu ermöglichen.
- **FR-COM-002 (Secure Chats / E2EE):** Ende-zu-Ende verschlüsselte Chats für sensible Daten (V3).
  - *Akzeptanzkriterium 1:* Verschlüsselung und Entschlüsselung erfolgen ausschließlich auf dem Client (Web Crypto API). Auf Convex wird nur der verschlüsselte Ciphertext abgelegt.
  - *Akzeptanzkriterium 2:* Der private E2EE-Schlüssel des Nutzers wird clientseitig mit einem aus einer Passphrase abgeleiteten Master-Key (mittels PBKDF2) verschlüsselt und als Backup auf Convex abgelegt. Die App erzwingt Client-seitig strenge Passwortrichtlinien für diese E2EE-Passphrase.
  - *Akzeptanzkriterium 3:* Zur Abwehr von Man-in-the-Middle-Angriffen (MitM) durch Server-Kompromittierung sieht die App eine out-of-band Fingerprint-Verifizierung (QR-Code-Scanning der Schlüssel-Fingerprints zwischen Geräten) vor.
  - *Akzeptanzkriterium 4:* E2EE-Chats müssen technisch vollständig von der serverseitigen Verarbeitung durch AI-Agents ausgeschlossen werden.
- **FR-COM-003 (Medien & Dokumente):** Senden von Bildern, Dateien und Links in Chats.
  - *Akzeptanzkriterium:* Bilder und Dateien müssen Client-seitig in Expo vor dem Upload komprimiert werden. Die maximale Dateigröße beträgt 10MB.

### 5.3 Memos & Listen (FR-MEM)

- **FR-MEM-001 (Notizen & Einkaufslisten):** Erstellen von freien Memos, To-do-Listen und Fotoalben.
  - *Akzeptanzkriterium 1:* Änderungen an Memos und Listen werden über Convex in Echtzeit synchronisiert.
  - *Akzeptanzkriterium 2:* Fotoalben können maximal 100 Fotos pro Album fassen, um exzessiven Speicherverbrauch zu verhindern.

### 5.4 Activity Feed & Benachrichtigungen (FR-ACT)

- **FR-ACT-001 (Aktivitäts-Feed):** Zentraler Feed über neue/geänderte Termine, Memos und Kommentare im Kalender.
  - *Akzeptanzkriterium:* Die Convex-Query für den Aktivitäts-Feed liefert standardmäßig maximal die letzten 100 Elemente aus einem maximalen 30-Tage-Fenster zurück und unterstützt Cursor-basierte Pagination.
- **FR-ACT-002 (Benachrichtigungssteuerung):** Push-Meldungen für Termine, Chats und AI-Hinweise.
  - *Akzeptanzkriterium:* Veto-Entscheidungen von Kindern (ROLE-004) blockieren keine Termine, sondern markieren diese in der App der Eltern als „Vetoed by [Kind]“ und erzeugen eine visuelle Markierung auf dem Dashboard der Eltern.

### 5.5 AI-Agents & Sprachunterstützung (FR-AI)

- **FR-AI-001 (Scheduling Agent):** Plant Termine und schlägt optimale Slots vor.
  - *Akzeptanzkriterium:* Schreibt ausschließlich als "Draft" in die Datenbank. Benötigt manuelle Freigabe eines Nutzers mit ROLE-001 oder ROLE-002.
- **FR-AI-002 (Conflict Agent):** Erkennt Überschneidungen und Ressourcenkonflikte.
  - *Akzeptanzkriterium 1:* Der Agent nutzt einen adaptiven Cooldown: Für dringende Konflikte (Termine in den nächsten 24h oder hochpriore Ressourcen wie das Familienauto) beträgt der Cooldown 2 Minuten, für zukünftige Termine 15 Minuten.
  - *Akzeptanzkriterium 2:* Temporäre Konflikt-Chat-Threads werden nach 48 Stunden oder sofort nach Konfliktlösung automatisch archiviert/gelöscht.
- **FR-AI-003 (Digest Agent):** Erstellt rollenbasierte Tages-/Wochenzusammenfassungen.
  - *Akzeptanzkriterium 1:* Die Filterung der Daten nach Rollen erfolgt serverseitig in der Convex-Query-Ebene vor der Übergabe an das LLM. Das LLM erhält ausschließlich Daten, für die der jeweilige Nutzer Leserechte besitzt.
  - *Akzeptanzkriterium 2:* Der Digest Agent bietet neben reinen Text- und Sprachvorlese-Optionen einen druckoptimierten PDF-Export an (unterstützt e-Ink Küchen-Displays).
- **FR-AI-004 (Voice-to-Intent):** Sprachnachrichten-Verarbeitung über Whisper/LLM.
  - *Akzeptanzkriterium 1:* Der Client lädt die Audiodatei zuerst in den Convex File Storage hoch, erhält eine File-URL und triggert danach asynchron die Convex Action zur Transkription, um Timeouts zu vermeiden.
  - *Akzeptanzkriterium 2:* Die hochgeladene Audiodatei wird unmittelbar nach der erfolgreichen Transkription automatisch aus dem Convex File Storage gelöscht.
- **FR-AI-005 (Prompt Injection-Schutz):** Schutz vor indirekter Prompt-Injection in Nutzerdaten.
  - *Akzeptanzkriterium 1:* Alle vom Benutzer eingegebenen Freitexte (Event-Titel, Notizen, Chats) werden serverseitig vor dem Einfügen in den LLM-Prompt sanitisiert (Entfernen von spitzen Klammern `<` und `>` sowie Ersetzen von Systemsteuerzeichen) und in dynamisch generierte XML-Tags mit zufälligen Boundary-Tokens eingekapselt.
  - *Akzeptanzkriterium 2:* Es wird ein striktes JSON/Schema-Matching für alle LLM-Rückgaben erzwungen. Eine Post-Processing-Validierung prüft die generierten Zusammenfassungen auf unerlaubte Systemanweisungen.

### 5.6 Family- & User-Management (FR-FAM)

- **FR-FAM-001 (Onboarding):** Registrierung und Login via Clerk.
- **FR-FAM-002 (Einladungen):** Einladen von Familienmitgliedern über Link oder E-Mail.
- **FR-FAM-003 (Caregiver Portal & Clerk-Convex-Mapping):** Web-Zugang für externe Rollen (ROLE-005/ROLE-006).
  - *Akzeptanzkriterium 1 (Race-Condition-Prävention):* Beim Einladen wird ein eindeutiges Einladungstoken in den Clerk-User-Metadaten hinterlegt. Ein Convex-Webhook (getriggert bei User-Erstellung in Clerk) verarbeitet das Token und verknüpft die Clerk-ID mit dem Convex-Datenmodell. Der Client zeigt einen Ladebildschirm an und wiederholt Abfragen, bis das Mapping bestätigt ist.
  - *Akzeptanzkriterium 2 (PIN-Fallback):* Eltern können einen 6-stelligen, 10 Minuten gültigen Einmal-PIN generieren, mit dem sich Großeltern/Caregiver ohne E-Mail-Zugriff direkt im Caregiver Portal authentifizieren können.
  - *Akzeptanzkriterium 3:* Externe können keine direkten Änderungen in der DB vornehmen, sondern nur Vorschläge (Drafts) einreichen.

---

## 6. Nicht-funktionale Anforderungen (NFR)

### 6.1 Sicherheit & Datenschutz (NFR-SEC)
- **NFR-SEC-001 (Authentifizierung):** Login über Clerk mit Session-Management und optionalem MFA.
- **NFR-SEC-002 (Autorisierung):** Autorisierung wird serverseitig in Convex erzwungen, nicht nur im Client.
- **NFR-SEC-003 (AI-Datenschutz):** Zero-Knowledge für als „Privat“ markierte Termine. Diese werden für die KI in Convex unlesbar gemacht (Zeitfenster wird als blockiert markiert).
- **NFR-SEC-004 (Speicherbegrenzung & Quotas):** Max. Speicherplatz-Quota von 2GB pro Familie (erweiterbar über Premium). Bei Erreichen des Limits werden Dateiuploads deaktiviert; die reine Sprach-Transkription bleibt funktionsfähig, da die temporären Audiodateien sofort wieder gelöscht werden. Die App bietet dem Family Owner eine Speicher-Dashboard-Ansicht mit der Möglichkeit, Unter-Quotas für einzelne Accounts (z. B. max 200MB für Kinder) zu konfigurieren.

### 6.2 Performance & Zuverlässigkeit (NFR-PER)
- **NFR-PER-001 (Realtime Updates):** Latenz für die Synchronisation von Kalenderdaten und Chatnachrichten über Convex unter 200ms bei aktiver Internetverbindung.
- **NFR-PER-002 (Offline-Synchronisation / Local-First-Synchronisation):** 
  - *Anforderung:* Bei vorübergehender Offline-Situation speichert die Expo-App Änderungen in einer lokalen SQLite-Datenbank (z. B. WatermelonDB/RxDB) mit temporären IDs.
  - *Synchronisation:* Sobald die Internetverbindung wiederhergestellt ist, führt das Synchronisationsmodul ein Mapping von temporären auf permanente Server-IDs durch, um Abhängigkeitsketten (z. B. Termin anlegen, dann Datei anhängen) korrekt aufzulösen.
  - *Konfliktbehandlung:* Konflikte werden auf Feldebene (Field-level merging) aufgelöst, nicht auf Dokumentebene (LWW), um den Verlust von parallel geänderten Feldern desselben Termins zu verhindern.

---

## 7. Success Metrics (SM)

- **SM-PROD-001:** Anteil aktiver Familien pro Woche (Ziel: > 60%).
- **SM-PROD-002:** Anteil erfolgreich angenommener Einladungen über das Caregiver Portal (Ziel: > 80%).
- **SM-PROD-003:** Anzahl erfolgreich ausgeführter AI-Vorschläge pro aktive Familie (Ziel: > 2 pro Woche).
- **SM-QUAL-001:** Push-Zustellquote (Ziel: > 99%).
- **SM-QUAL-002 (Counter-Metric):** Rate der stummgeschalteten AI-Benachrichtigungen (Ziel: < 10%).
- **SM-QUAL-003 (Counter-Metric):** Ablehnungsrate von AI-Terminentwürfen durch die Eltern (Ziel: < 15%).

---

## 8. Release-Plan

### V1 – Family Calendar Core (MVP)
- Registrierung und Login via Clerk.
- Familie erstellen, Mitglieder per Link einladen.
- Geteilter Kalender mit Zeitzonen-Support und Ressourcenbuchung (Virtual Members).
- Memos, Listen und Alben mit 2GB Speicher-Quota und Client-Komprimierung.
- Standard-Chats (Gruppen/1:1/Events).
- Caregiver Portal für Großeltern und Babysitter mit Vorschlags-Drafts und PIN-Authentifizierung.
- Offline-Fähigkeit via lokaler SQLite-Synchronisation (ID-Mapping, Feld-Merging).

### V2 – AI Family Agents
- Conflict Agent (adaptiver Cooldown, temporäre Threads, Auto-Archivierung).
- Digest Agent mit serverseitiger Rollen-Filterung und PDF-Export (e-Ink).
- Scheduling Agent (Vorschlag freier Slots, reine Draft-Erstellung).
- Voice-to-Intent (Whisper über Convex File Storage mit Auto-Deletion).
- Prompt-Injection-Schutz (Sanitisierung, XML-Wrapper, Schema-Matching).

### V3 – Advanced Security and Integrations
- Secure Chats mit clientseitigem E2EE (Ausschluss der AI-Verarbeitung, PBKDF2-Key-Sync, QR-Verifizierung).
- Zusätzliche externe Kalender-Integrationen (Google, Outlook).
- Premium-Modell (Erweiterte Quotas, AI-Archiv).

---

## 9. Risiken & Gegenmaßnahmen (RI)

| Risiko-ID | Risiko | Beschreibung | Gegenmaßnahme |
|---|---|---|---|
| **RI-001** | Rechtekomplexität | Familienrollen sind komplexer als Workspace-Rollen | Fachrechte separat in Convex modellieren, Clerk nur für Auth nutzen |
| **RI-002** | E2EE vs. KI | E2EE verhindert KI-Analysen | Klare Kanaltrennung (Standard vs. E2EE Secure Chats) |
| **RI-003** | AI-Fehlverhalten | Falsche Terminmanipulationen | Keine direkten DB-Schreibrechte für KI, nur Entwürfe (Drafts) |
| **RI-004** | SMS-Missbrauch | Spoofing und Twilio-API-Kosten | SMS-Kanal gestrichen; Ersatz durch passwortloses OTP Caregiver Portal und PIN-Fallback |
| **RI-005** | Offline-Ausfälle | Datenverlust bei Verbindungsabbruch | Client-seitige SQLite/WatermelonDB mit ID-Mapping und Feld-Merging |
| **RI-006** | Prompt-Injection | Missbrauch des Digest-Agents zur Ausführung fremder Anweisungen | XML-Kapselung mit Boundary-Tokens, Schema-Zwang und Post-Processing-Validierung |

---

## 10. Offene Fragen (NOTE-FOR-PM)

- **[NOTE-FOR-PM] [Owner: PM]** Sollen Familienmitglieder die Möglichkeit erhalten, eigene Virtual Members ohne Admin-Genehmigung anzulegen?
- **[NOTE-FOR-PM] [Owner: Design/PM]** Wie genau soll das Layout des e-Ink-Kühlschrank-Digests aussehen und welche PDF-Templates werden in V2 bereitgestellt?
- **[NOTE-FOR-PM] [Owner: Legal/PM]** Welche spezifischen Datenschutz-Einwilligungen müssen Kinder-Accounts beim ersten Login abgeben?

---

## 11. Annahmen-Index (Assumptions Index)

- **[ASSUMPTION-001] (Caregiver Portal Präferenz):** Es wird angenommen, dass Großeltern und externe Betreuer ein einfaches, passwortloses Caregiver Portal zur Interaktion einer eigenständigen App vorziehen.
- **[ASSUMPTION-002] (PIN-Fallback Telefonnutzung):** Es wird angenommen, dass Eltern bei E-Mail-Zustellproblemen telefonisch einen PIN an Großeltern durchgeben können und dies als akzeptabler Workflow empfunden wird.
