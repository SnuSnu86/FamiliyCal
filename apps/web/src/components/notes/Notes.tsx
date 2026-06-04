"use client";

import { useUser } from "@clerk/nextjs";
import { useAccountMapping } from "@packages/ui";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Image from "next/image";
import { useEffect, useState } from "react";
import CreateFamily from "../family/CreateFamily";
import CreateNote from "./CreateNote";
import NoteItem from "./NoteItem";

const Notes = () => {
  const [search, setSearch] = useState("");
  const { isLoaded, isSignedIn } = useUser();
  const [timeoutReached, setTimeoutReached] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const {
    bootstrapFailed,
    isWaitingForMapping,
    mappedUser,
    retryBootstrap,
  } = useAccountMapping({
    enabled: isLoaded && isSignedIn,
    retryKey,
  });

  useEffect(() => {
    if (!isWaitingForMapping) {
      setTimeoutReached(false);
      return;
    }

    const timer = setTimeout(() => {
      setTimeoutReached(true);
    }, 10000);
    return () => clearTimeout(timer);
  }, [isWaitingForMapping, retryKey]);

  const allNotes = useQuery(
    api.notes.getNotes,
    isWaitingForMapping ? "skip" : undefined,
  );
  const deleteNote = useMutation(api.notes.deleteNote);

  const finalNotes = search
    ? allNotes?.filter(
        (note) =>
          note.title.toLowerCase().includes(search.toLowerCase()) ||
          note.content.toLowerCase().includes(search.toLowerCase()),
      )
    : allNotes;

  if (!isLoaded) {
    return <MappingSkeleton />;
  }

  if (isWaitingForMapping) {
    if (timeoutReached || bootstrapFailed) {
      return (
        <div className="container pb-10 flex flex-col items-center justify-center min-h-[400px] text-center" aria-label="Fehler bei der Konto-Synchronisierung">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Verbindung fehlgeschlagen</h2>
          <p className="text-sm text-[#6F675E] mb-6 max-w-md">
            {bootstrapFailed
              ? "Clerk und Convex konnten nicht verbunden werden. Prüfe in Clerk die Convex-Integration (Sessions → aud = convex) und melde dich erneut an."
              : "Dein Konto konnte nicht mit FamilyCal synchronisiert werden. Das kann an einer Netzwerkverzögerung oder Serverproblemen liegen."}
          </p>
          <button
            onClick={() => {
              setTimeoutReached(false);
              retryBootstrap();
              setRetryKey((prev) => prev + 1);
            }}
            className="px-4 py-2 bg-[#0D87E1] text-white rounded-md hover:bg-[#0b76c5] transition-colors"
          >
            Erneut versuchen
          </button>
        </div>
      );
    }
    return <MappingSkeleton />;
  }

  if (mappedUser && !mappedUser.familyId) {
    return <CreateFamily />;
  }

  return (
    <div className="container pb-10">
      <h1 className="text-[#2D2D2D] text-center text-[20px] sm:text-[43px] not-italic font-normal sm:font-medium leading-[114.3%] tracking-[-1.075px] sm:mt-8 my-4  sm:mb-10">
        Your Notes
      </h1>
      <div className="px-5 sm:px-0">
        <div className="bg-white flex items-center h-[39px] sm:h-[55px] rounded-sm border border-solid gap-2 sm:gap-5 mb-10 border-[rgba(0,0,0,0.40)] px-3 sm:px-11">
          <Image
            src={"/images/search.svg"}
            width={23}
            height={22}
            alt="search"
            className="cursor-pointer sm:w-[23px] sm:h-[22px] w-[20px] h-[20px]"
          />
          <input
            type="text"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-[#2D2D2D] text-[17px] sm:text-2xl not-italic font-light leading-[114.3%] tracking-[-0.6px] focus:outline-0 focus:ring-0 focus:border-0 border-0"
          />
        </div>
      </div>

      <div className="border-[0.5px] mb-20 divide-y-[0.5px] divide-[#00000096] border-[#00000096]">
        {finalNotes &&
          finalNotes.map((note) => (
            <NoteItem key={note._id} note={note} deleteNote={deleteNote} />
          ))}
      </div>

      <CreateNote />
    </div>
  );
};

function MappingSkeleton() {
  return (
    <div className="container pb-10 animate-pulse" aria-label="Account wird vorbereitet">
      <div className="mx-auto my-8 h-10 w-48 rounded-lg bg-[#FBF9F5] shadow-sm" />
      <div className="mx-5 sm:mx-0 mb-10 h-[55px] rounded-sm border border-[#E2DDD5] bg-[#FBF9F5]" />
      <div className="space-y-3 border border-[#E2DDD5] bg-[#F5F2EB] p-4">
        <div className="h-16 rounded-md bg-[#FBF9F5]" />
        <div className="h-16 rounded-md bg-[#FBF9F5]" />
        <div className="h-16 rounded-md bg-[#FBF9F5]" />
      </div>
      <p className="mt-6 text-center text-sm text-[#6F675E]">
        Dein Konto wird sicher mit FamilyCal verbunden …
      </p>
    </div>
  );
}

export default Notes;
