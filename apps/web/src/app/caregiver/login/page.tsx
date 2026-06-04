"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

export default function CaregiverLoginPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const response = await fetch("/api/verify-pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await response.json().catch(() => ({}));
    setIsSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? "Der PIN ist ungültig oder abgelaufen.");
      inputRef.current?.focus();
      return;
    }

    router.push("/caregiver/dashboard");
  }

  return (
    <main className="min-h-screen bg-surface-base px-5 py-10 text-[#2A2720]">
      <section className="mx-auto flex min-h-[calc(100vh-80px)] max-w-md items-center">
        <form onSubmit={submit} className="w-full rounded-[12px] border border-border-hairline bg-surface-raised p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold">Caregiver Login</h1>
          <p className="mt-2 text-sm text-[#6F675D]">Melde dich mit deinem 6-stelligen Familien-PIN an.</p>
          <label className="mt-6 block text-sm font-medium" htmlFor="pin">PIN</label>
          <input
            ref={inputRef}
            id="pin"
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mt-2 min-h-12 w-full rounded-[12px] border border-border-hairline bg-white px-4 text-center text-2xl tracking-[0.3em] outline-none focus:border-accent-sage focus:ring-2 focus:ring-accent-sage/30"
          />
          {error ? <p className="mt-4 rounded-[12px] border border-[#C06C5C]/30 bg-white px-4 py-3 text-sm text-[#C06C5C]">{error}</p> : null}
          <button
            type="submit"
            disabled={pin.length !== 6 || isSubmitting}
            className="mt-6 min-h-12 w-full rounded-[12px] bg-accent-sage px-5 font-medium text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Prüfen..." : "Anmelden"}
          </button>
        </form>
      </section>
    </main>
  );
}
