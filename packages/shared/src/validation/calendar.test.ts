import { calendarEventSchema } from "./calendar";

const validEvent = {
  title: "Familienessen",
  start_date: "2026-06-02T10:00:00.000Z",
  end_date: "2026-06-02T11:00:00.000Z",
};

calendarEventSchema.parse(validEvent);

if (calendarEventSchema.safeParse({ ...validEvent, title: "" }).success) {
  throw new Error("Leerer Titel muss fehlschlagen");
}

if (calendarEventSchema.safeParse({ ...validEvent, start_date: "2026-06-02" }).success) {
  throw new Error("Nicht-UTC-ISO-Startdatum muss fehlschlagen");
}

if (
  calendarEventSchema.safeParse({
    ...validEvent,
    end_date: "2026-06-02T09:00:00.000Z",
  }).success
) {
  throw new Error("Enddatum vor Startdatum muss fehlschlagen");
}
