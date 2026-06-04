import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.redirect(new URL("/caregiver/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
  response.cookies.set("caregiver_session", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
