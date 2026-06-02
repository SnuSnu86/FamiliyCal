"use client";

import { api } from "@packages/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { FormEvent, useState } from "react";

function getErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "data" in err && err.data) {
    return String(err.data);
  }
  if (err instanceof Error) {
    return err.message.replace(/^ConvexError:\s*/, "");
  }
  return "Die Familie konnte nicht erstellt werden.";
}

export default function CreateFamily() {
  const createFamily = useMutation(api.families.create);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Bitte gib einen Familiennamen ein.");
      return;
    }
    if (trimmedName.length > 100) {
      setError("Der Familienname darf maximal 100 Zeichen lang sein.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await createFamily({ name: trimmedName });
      // If successful, we don't reset isSubmitting because the component will unmount
    } catch (err) {
      setError(getErrorMessage(err));
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-96px)] bg-surface-base px-5 py-10 text-[#2D2D2D]">
      <section className="mx-auto max-w-lg rounded-[12px] border border-border-hairline bg-surface-raised p-6 shadow-sm sm:p-8">
        <p className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[#6F675E]">
          FamilyCal einrichten
        </p>
        <h1 className="mb-3 text-3xl font-medium tracking-[-0.04em] text-[#2D2D2D]">
          Erstelle deine Familiengruppe
        </h1>
        <p className="mb-8 text-sm leading-6 text-[#6F675E]">
          Deine Familie ist der gemeinsame Arbeitsbereich für Kalender, Chats
          und Speicher-Quotas. Du wirst automatisch als Family Owner angelegt.
        </p>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-[#3A352F]" htmlFor="family-name">
            Familienname
          </label>
          <input
            id="family-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-[12px] border border-border-hairline bg-white px-4 py-3 text-base outline-none transition focus:border-accent-sage focus:ring-2 focus:ring-accent-sage/30"
            placeholder="z. B. Familie Schmidt"
            disabled={isSubmitting}
            maxLength={100}
          />

          {error ? (
            <p className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-[12px] bg-accent-sage px-5 py-3 font-medium text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Familie wird erstellt …" : "Familie erstellen"}
          </button>
        </form>
      </section>
    </main>
  );
}
