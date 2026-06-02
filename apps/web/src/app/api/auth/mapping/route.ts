import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { api } from "@packages/backend/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { type NextRequest, NextResponse } from "next/server";

type ClerkEmailAddress = {
  id: string;
  email_address: string;
};

type ClerkUserWebhookData = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  image_url?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmailAddress[];
};

let globalConvexClient: ConvexHttpClient | null = null;

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is required for Clerk mapping");
  }

  if (!globalConvexClient) {
    globalConvexClient = new ConvexHttpClient(convexUrl);
  }

  return globalConvexClient;
}

function getPrimaryEmail(data: ClerkUserWebhookData) {
  const primaryEmail = data.email_addresses?.find(
    (email) => email.id === data.primary_email_address_id,
  );

  return primaryEmail?.email_address ?? data.email_addresses?.[0]?.email_address;
}

function getDisplayName(data: ClerkUserWebhookData) {
  const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ");
  return fullName || data.username || undefined;
}

export async function POST(request: NextRequest) {
  const signingSecret = process.env.CLERK_WEBHOOK_SECRET;

  if (!signingSecret) {
    return NextResponse.json(
      { error: "CLERK_WEBHOOK_SECRET is required" },
      { status: 500 },
    );
  }

  let event;

  try {
    event = await verifyWebhook(request, { signingSecret });
  } catch (error) {
    console.error("Clerk webhook verification failed", error);
    return NextResponse.json(
      { error: "Webhook verification failed" },
      { status: 400 },
    );
  }

  try {
    const convex = getConvexClient();

    if (event.type === "user.created" || event.type === "user.updated") {
      const data = event.data as ClerkUserWebhookData;
      const email = getPrimaryEmail(data);

      if (!email) {
        return NextResponse.json(
          { error: "Clerk user does not include an email address" },
          { status: 400 },
        );
      }

      await convex.mutation(api.users.upsertUserFromWebhook, {
        clerkId: data.id,
        email,
        name: getDisplayName(data),
        imageUrl: data.image_url ?? undefined,
      });
    }

    if (event.type === "user.deleted") {
      const data = event.data as { id?: string | null };

      if (data.id) {
        await convex.mutation(api.users.deleteUserFromWebhook, {
          clerkId: data.id,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Error processing Clerk webhook in Convex:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error during DB synchronization" },
      { status: 500 },
    );
  }
}
