import { z } from "zod";

export const isoUtcDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 2000;

/** Returns true only for a syntactically AND semantically valid ISO-8601-UTC instant. */
function isValidIsoUtc(value: string): boolean {
  return isoUtcDateTimeRegex.test(value) && !Number.isNaN(new Date(value).getTime());
}

/** Returns true when the string is a valid IANA time zone the runtime understands. */
function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const isoUtcDateTime = (label: string) =>
  z
    .string()
    .regex(isoUtcDateTimeRegex, `${label} muss ein ISO-8601-UTC-Zeitpunkt sein.`)
    .refine(isValidIsoUtc, `${label} ist kein gültiges Datum.`);

export const calendarEventSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Titel ist erforderlich.")
      .max(TITLE_MAX_LENGTH, `Titel darf höchstens ${TITLE_MAX_LENGTH} Zeichen lang sein.`),
    description: z
      .string()
      .max(DESCRIPTION_MAX_LENGTH, `Beschreibung darf höchstens ${DESCRIPTION_MAX_LENGTH} Zeichen lang sein.`)
      .optional(),
    start_date: isoUtcDateTime("Startdatum"),
    end_date: isoUtcDateTime("Enddatum"),
    all_day: z.boolean().optional(),
    rrule: z
      .string()
      .trim()
      .min(1, "Die Wiederholungsregel ist ungültig. Bitte prüfe Rhythmus und Enddatum.")
      .optional(),
    timezone_id: z
      .string()
      .optional()
      .refine((value) => value === undefined || isValidTimeZone(value), "Ungültige Zeitzone."),
  })
  .refine((value) => new Date(value.end_date).getTime() >= new Date(value.start_date).getTime(), {
    path: ["end_date"],
    message: "Enddatum darf nicht vor dem Startdatum liegen.",
  });

export type CalendarEventInput = z.infer<typeof calendarEventSchema>;
