"use client";

import { LogOut, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

type CaregiverEvent = {
  _id?: string;
  clientId?: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  status?: string;
};

const initialProposal = {
  title: "",
  date: "",
  startTime: "",
  endTime: "",
  description: "",
};

export function CaregiverDashboardClient({ familyName }: { familyName: string }) {
  const router = useRouter();
  const [events, setEvents] = useState<CaregiverEvent[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [proposal, setProposal] = useState(initialProposal);
  const [proposalMessage, setProposalMessage] = useState("");
  const [proposalError, setProposalError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadEvents() {
    await fetch("/api/caregiver/events")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Termine konnten nicht geladen werden.");
        setEvents(data.events ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    void loadEvents();
  }, []);

  const orderedEvents = useMemo(
    () => [...events].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate)),
    [events],
  );

  async function logout() {
    await fetch("/api/caregiver/logout", { method: "POST", redirect: "manual" });
    router.push("/caregiver/login");
  }

  async function submitProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProposalError("");
    setProposalMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/caregiver/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: proposal.title,
          description: proposal.description,
          startDate: new Date(`${proposal.date}T${proposal.startTime}`).toISOString(),
          endDate: new Date(`${proposal.date}T${proposal.endTime}`).toISOString(),
          allDay: false,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Terminvorschlag konnte nicht gespeichert werden.");
      setProposal(initialProposal);
      setProposalMessage("Vorschlag eingereicht.");
      await loadEvents();
    } catch (err: any) {
      setProposalError(err.message ?? "Terminvorschlag konnte nicht gespeichert werden.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-surface-base px-5 py-8 text-[#2A2720]">
      <section className="mx-auto max-w-4xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-[#6F675D]">Caregiver Kalender</p>
            <h1 className="text-3xl font-semibold">Kalender von Familie {familyName}</h1>
          </div>
          <button onClick={logout} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] border border-border-hairline bg-surface-raised px-4 font-medium">
            <LogOut aria-hidden className="h-4 w-4" />
            Abmelden
          </button>
        </div>

        {isLoading ? (
          <div className="mt-8 space-y-3">
            <div className="h-20 rounded-[12px] border border-border-hairline bg-surface-raised" />
            <div className="h-20 rounded-[12px] border border-border-hairline bg-surface-raised" />
            <div className="h-20 rounded-[12px] border border-border-hairline bg-surface-raised" />
          </div>
        ) : error ? (
          <p className="mt-8 rounded-[12px] border border-[#C06C5C]/30 bg-surface-raised px-4 py-3 text-[#C06C5C]">{error}</p>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[360px_1fr]">
            <form onSubmit={submitProposal} className="rounded-[12px] border border-border-hairline bg-surface-raised p-4 shadow-sm">
              <div className="grid gap-4">
                <label className="text-sm font-medium">
                  Titel
                  <input
                    required
                    value={proposal.title}
                    onChange={(event) => setProposal((current) => ({ ...current, title: event.target.value }))}
                    className="mt-2 min-h-11 w-full rounded-[12px] border border-border-hairline bg-white px-3 outline-none focus:border-accent-sage focus:ring-2 focus:ring-accent-sage/30"
                  />
                </label>
                <label className="text-sm font-medium">
                  Datum
                  <input
                    required
                    type="date"
                    value={proposal.date}
                    onChange={(event) => setProposal((current) => ({ ...current, date: event.target.value }))}
                    className="mt-2 min-h-11 w-full rounded-[12px] border border-border-hairline bg-white px-3 outline-none focus:border-accent-sage focus:ring-2 focus:ring-accent-sage/30"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-medium">
                    Start
                    <input
                      required
                      type="time"
                      value={proposal.startTime}
                      onChange={(event) => setProposal((current) => ({ ...current, startTime: event.target.value }))}
                      className="mt-2 min-h-11 w-full rounded-[12px] border border-border-hairline bg-white px-3 outline-none focus:border-accent-sage focus:ring-2 focus:ring-accent-sage/30"
                    />
                  </label>
                  <label className="text-sm font-medium">
                    Ende
                    <input
                      required
                      type="time"
                      value={proposal.endTime}
                      onChange={(event) => setProposal((current) => ({ ...current, endTime: event.target.value }))}
                      className="mt-2 min-h-11 w-full rounded-[12px] border border-border-hairline bg-white px-3 outline-none focus:border-accent-sage focus:ring-2 focus:ring-accent-sage/30"
                    />
                  </label>
                </div>
                <label className="text-sm font-medium">
                  Beschreibung
                  <textarea
                    value={proposal.description}
                    onChange={(event) => setProposal((current) => ({ ...current, description: event.target.value }))}
                    className="mt-2 min-h-24 w-full rounded-[12px] border border-border-hairline bg-white px-3 py-2 outline-none focus:border-accent-sage focus:ring-2 focus:ring-accent-sage/30"
                  />
                </label>
                <button
                  disabled={isSubmitting}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] bg-accent-sage px-4 font-medium text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send aria-hidden className="h-4 w-4" />
                  {isSubmitting ? "Wird gesendet..." : "Vorschlag einreichen"}
                </button>
                {proposalMessage ? <p className="rounded-[12px] border border-[#7D9B84]/30 bg-[#7D9B84]/10 px-3 py-2 text-sm text-[#55705C]">{proposalMessage}</p> : null}
                {proposalError ? <p className="rounded-[12px] border border-[#C06C5C]/30 px-3 py-2 text-sm text-[#C06C5C]">{proposalError}</p> : null}
              </div>
            </form>

            <div className="space-y-3">
            {orderedEvents.length === 0 ? (
              <p className="rounded-[12px] border border-border-hairline bg-surface-raised px-4 py-6 text-[#6F675D]">Keine Termine in dieser Woche.</p>
            ) : (
              orderedEvents.map((event) => (
                <article
                  key={event._id ?? event.clientId}
                  className={`rounded-[12px] border bg-surface-raised p-4 ${event.status === "draft" ? "border-dashed border-[#706B60]" : "border-border-hairline border-l-4 border-l-accent-sage"}`}
                >
                  <p className="text-sm text-[#6F675D]">
                    {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: event.allDay ? undefined : "short" }).format(new Date(event.startDate))}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{event.title}</h2>
                    {event.status === "draft" ? <span className="rounded-[12px] border border-[#706B60] px-2 py-0.5 text-xs font-medium text-[#706B60]">Entwurf</span> : null}
                  </div>
                  {event.description ? <p className="mt-1 text-sm text-[#6F675D]">{event.description}</p> : null}
                </article>
              ))
            )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
