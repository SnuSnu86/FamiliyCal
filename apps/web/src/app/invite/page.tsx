"use client";

import { SignUp, useAuth, useUser } from "@clerk/nextjs";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export default function InvitePage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { isSignedIn } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const invitation = useQuery(api.invitations.getInvitationByToken, token ? { token } : "skip");
  const acceptInvitation = useMutation(api.invitations.acceptInvitation);
  
  const mappedUser = useQuery(
    api.users.getUserByClerkId,
    isUserLoaded && isSignedIn && user?.id ? { clerkId: user.id } : "skip"
  );

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const isWaitingForMapping = isSignedIn && (mappedUser === null || mappedUser === undefined);

  async function accept() {
    if (isPending || !token) return;
    setIsPending(true);
    setError(null);
    try {
      await acceptInvitation({ token });
      setMessage("Du bist der Familie beigetreten.");
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^ConvexError:\s*/, "") : "Einladung konnte nicht angenommen werden.");
    } finally {
      setIsPending(false);
    }
  }

  if (isWaitingForMapping) {
    return <MappingSkeleton />;
  }

  const roleLabels: Record<string, string> = {
    "ROLE-002": "Elternteil",
    "ROLE-003": "Erwachsenes Mitglied",
    "ROLE-004": "Kind",
    "ROLE-005": "Caregiver",
    "ROLE-006": "Virtuelles Mitglied",
  };

  const friendlyRole = invitation ? (roleLabels[invitation.role] || invitation.role) : "";

  return (
    <main className="min-h-screen bg-[#F5F2EB] px-5 py-12 text-[#2D2D2D]">
      <section className="mx-auto max-w-xl rounded-[12px] bg-[#FBF9F5] p-6 shadow-sm">
        <p className="text-sm uppercase tracking-[0.18em] text-[#6F675E]">Einladung</p>
        <h1 className="mt-2 text-3xl font-semibold">FamilyCal beitreten</h1>
        {!token ? <p className="mt-4 text-red-700">Der Einladungslink enthält kein Token.</p> : null}
        {invitation ? <p className="mt-4 text-[#6F675E]">Du wurdest zu {invitation.familyName} als {friendlyRole} eingeladen.</p> : null}
        {error ? <p className="mt-4 rounded-[12px] bg-red-50 p-4 text-red-700">{error}</p> : null}
        {message || (mappedUser && mappedUser.familyId) ? (
          <p className="mt-4 rounded-[12px] bg-green-50 p-4 text-green-800">
            {message || "Du bist der Familie beigetreten."}
          </p>
        ) : null}
        {isSignedIn ? (
          !(mappedUser && mappedUser.familyId) ? (
            <button 
              onClick={accept} 
              disabled={!token || isPending} 
              className="mt-6 min-h-12 w-full rounded-[12px] bg-[#7F936B] px-5 font-medium text-white disabled:opacity-50"
            >
              {isPending ? "Wird verarbeitet..." : "Einladung annehmen"}
            </button>
          ) : null
        ) : token ? (
          <div className="mt-6 flex justify-center">
            <SignUp unsafeMetadata={{ invitationToken: token }} fallbackRedirectUrl="/invite" />
          </div>
        ) : null}
      </section>
    </main>
  );
}

function MappingSkeleton() {
  return (
    <div className="container mx-auto max-w-xl pb-10 mt-12 animate-pulse" aria-label="Account wird vorbereitet">
      <div className="my-8 h-10 w-48 rounded-lg bg-[#FBF9F5] shadow-sm" />
      <div className="mb-10 h-[55px] rounded-[12px] border border-[#E2DDD5] bg-[#FBF9F5]" />
      <div className="space-y-3 border border-[#E2DDD5] bg-[#F5F2EB] p-4 rounded-[12px]">
        <div className="h-16 rounded-md bg-[#FBF9F5]" />
      </div>
      <p className="mt-6 text-center text-sm text-[#6F675E]">
        Dein Konto wird sicher mit FamilyCal verbunden …
      </p>
    </div>
  );
}
