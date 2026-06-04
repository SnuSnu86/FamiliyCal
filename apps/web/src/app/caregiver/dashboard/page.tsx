import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "../../../lib/caregiverAuth";
import { CaregiverDashboardClient } from "./CaregiverDashboardClient";

export default async function CaregiverDashboardPage() {
  const token = (await cookies()).get("caregiver_session")?.value;
  const session = token ? verifyToken(token) : null;

  if (!session) redirect("/caregiver/login");

  return <CaregiverDashboardClient familyName={session.familyName ?? "Unbekannt"} />;
}
