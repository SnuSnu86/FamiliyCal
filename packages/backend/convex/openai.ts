import OpenAI from "openai";
import { internalAction, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { missingEnvVariableUrl } from "./utils";

export const openaiKeySet = query({
  args: {},
  handler: async () => {
    return Boolean(process.env.OPENAI_API_KEY);
  },
});

export const summary = internalAction({
  args: {
    id: v.id("notes"),
    title: v.string(),
    content: v.string(),
  },
  handler: async (ctx, { id, title, content }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const error = missingEnvVariableUrl(
        "OPENAI_API_KEY",
        "https://platform.openai.com/account/api-keys",
      );
      console.error(error);
      await ctx.runMutation(internal.openai.saveSummary, {
        id: id,
        summary: error,
      });
      return;
    }

    const openai = new OpenAI({ apiKey });
    const output = await openai.responses.create({
      model: "gpt-4o-mini",
      instructions:
        "You summarize user notes in concise plain English. Respond with summary text only.",
      input: `Summarize the following note.\n\nTitle: ${title}\n\nContent:\n${content}`,
    });
    const summary = output.output_text.trim();

    if (!summary)
      throw new Error(`OpenAI returned an empty summary for note '${id}'`);

    await ctx.runMutation(internal.openai.saveSummary, {
      id,
      summary,
    });
  },
});

export const saveSummary = internalMutation({
  args: {
    id: v.id("notes"),
    summary: v.string(),
  },
  handler: async (ctx, { id, summary }) => {
    await ctx.db.patch(id, {
      summary,
    });
  },
});
