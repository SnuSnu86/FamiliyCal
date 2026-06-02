"use client";

import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { FormEvent, useMemo, useState } from "react";

type Role = "ROLE-002" | "ROLE-003" | "ROLE-004" | "ROLE-005" | "ROLE-006";

const roleOptions: { value: Role; label: string }[] = [
  { value: "ROLE-002", label: "Elternteil" },
  { value: "ROLE-003", label: "Erwachsenes Mitglied" },
  { value: "ROLE-004", label: "Kind" },
  { value: "ROLE-005", label: "Caregiver" },
  { value: "ROLE-006", label: "Virtuelles Mitglied" },
];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^ConvexError:\s*/, "") : "Aktion fehlgeschlagen.";
}

export default function FamilySettings() {
  const members = useQuery(api.users.listFamilyMembers) ?? [];
  const invitations = useQuery(api.invitations.listInvitations) ?? [];
  const createInvitation = useMutation(api.invitations.createInvitation);
  const cancelInvitation = useMutation(api.invitations.cancelInvitation);
  const [role, setRole] = useState<Role>("ROLE-004");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const result = await createInvitation({ role, email: email.trim() || undefined }).catch((err: unknown) => {
      setError(getErrorMessage(err));
      return null;
    });
    if (!result) return;
    const inviteLink = `${baseUrl}/invite?token=${result.token}`;
    setLink(inviteLink);
    setMessage("Einladungslink wurde erstellt.");
  }

  async function copyLink(value: string) {
    setError(null);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setMessage("Link wurde kopiert.");
    } catch (err) {
      setError("Kopieren fehlgeschlagen.");
    }
  }

  return (
    <main className="min-h-screen bg-[#F5F2EB] px-5 py-8 text-[#2D2D2D]">
      <section className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-[12px] bg-[#FBF9F5] p-6 shadow-sm">
          <p className="text-sm uppercase tracking-[0.18em] text-[#6F675E]">FamilyCal</p>
          <h1 className="mt-2 text-3xl font-semibold">Familieneinstellungen</h1>
          <p className="mt-2 text-[#6F675E]">Verwalte Mitglieder, Rollen und offene Einladungen.</p>
        </div>

        {error ? <p className="rounded-[12px] bg-red-50 p-4 text-red-700">{error}</p> : null}
        {message ? <p className="rounded-[12px] bg-green-50 p-4 text-green-800">{message}</p> : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-[12px] bg-[#FBF9F5] p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold">Mitglieder</h2>
            <div className="space-y-3">
              {members.map((member: any) => (
                <div key={member._id} className="rounded-[12px] border border-[#E2DDD5] bg-white p-4">
                  <p className="font-medium">{member.name || member.email}</p>
                  <p className="text-sm text-[#6F675E]">{member.email} · {member.role}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[12px] bg-[#FBF9F5] p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold">Einladung erstellen</h2>
            <form className="space-y-4" onSubmit={handleCreate}>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="min-h-12 w-full rounded-[12px] border border-[#E2DDD5] bg-white px-4">
                {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.value})</option>)}
              </select>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="E-Mail optional" className="min-h-12 w-full rounded-[12px] border border-[#E2DDD5] bg-white px-4" />
              <button className="min-h-12 w-full rounded-[12px] bg-[#7F936B] px-5 font-medium text-white" type="submit">Einladungslink generieren</button>
            </form>
            {link ? (
              <div className="mt-4 rounded-[12px] border border-[#E2DDD5] bg-white p-4">
                <p className="break-all text-sm">{link}</p>
                <button onClick={() => copyLink(link)} className="mt-3 min-h-12 rounded-[12px] border border-[#7F936B] px-4 text-[#50603F]">Link kopieren</button>
              </div>
            ) : null}
          </section>
        </div>

        <section className="rounded-[12px] bg-[#FBF9F5] p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">Ausstehende Einladungen</h2>
          <div className="space-y-3">
            {invitations.length === 0 ? <p className="text-[#6F675E]">Keine offenen Einladungen.</p> : null}
            {invitations.map((invitation: any) => {
              const inviteLink = `${baseUrl}/invite?token=${invitation.token}`;
              return (
                <div key={invitation._id} className="flex flex-col gap-3 rounded-[12px] border border-[#E2DDD5] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="font-medium">{invitation.email || "Einladungslink (ohne E-Mail)"}</p><p className="text-sm text-[#6F675E]">{invitation.role}</p></div>
                  <div className="flex gap-2"><button onClick={() => copyLink(inviteLink)} className="min-h-12 rounded-[12px] border px-4">Kopieren</button><button onClick={() => cancelInvitation({ token: invitation.token })} className="min-h-12 rounded-[12px] border border-red-200 px-4 text-red-700">Abbrechen</button></div>
                </div>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
