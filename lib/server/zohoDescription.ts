// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY single source of truth for the Zoho Lead Description.
//
// BOTH the automatic ingest path and the manual "Sync to Zoho" path call this
// ONE helper, so they always produce the identical structured Arabic summary.
// The only thing each caller supplies is HOW to read the conversation's recent
// messages (auto = service-role; manual = the user's JWT). NO secrets logged.
// ════════════════════════════════════════════════════════════════════════

import { buildZohoDescription, type SummaryMessage } from "@/lib/whatsapp/summary";

if (typeof window !== "undefined") {
  throw new Error("lib/server/zohoDescription must never be imported in the browser");
}

export interface BuildDescriptionOpts {
  conversationId: string;
  contactId?: string | null;
  displayName: string | null;
  phone: string | null;
  waId: string;
  salesStage: string | undefined;
  source: "auto" | "manual";
  /** Latest message body — used only if the message read returns nothing. */
  latestBody: string | null;
  /** Caller-provided reader for the conversation's recent messages. */
  fetchMessages: () => Promise<SummaryMessage[] | null>;
}

/**
 * Build the structured Arabic Description from the FULL recent conversation.
 * Identical for auto + manual. Always returns a structured block; if the read
 * fails it still includes the latest message so the block is never empty.
 */
export async function buildConversationDescription(o: BuildDescriptionOpts): Promise<string> {
  let fetched: SummaryMessage[] = [];
  try {
    fetched = (await o.fetchMessages()) ?? [];
  } catch {
    fetched = [];
  }
  // Guarantee at least the just-received message (covers a rare empty read), but
  // NEVER discard fetched history.
  const messages = fetched.length > 0
    ? fetched
    : [{ body: o.latestBody, direction: "incoming", created_at: new Date().toISOString() }];

  const base = (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "");
  const description = buildZohoDescription({
    displayName: o.displayName,
    phone: o.phone,
    waId: o.waId,
    salesStage: o.salesStage,
    conversationLink: `${base}/client-portal/admin/whatsapp?conversation=${o.conversationId}`,
    messages,
  });

  const tag = o.source === "auto" ? "zoho_auto_summary_built" : "zoho_manual_summary_built";
  const preview = description.slice(0, 120).replace(/\s+/g, " ");
  console.log(
    `[zoho] ${tag} conversation_id=${o.conversationId} contact_id=${o.contactId ?? "-"} ` +
    `messages_count=${messages.length} description_source=structured_summary desc="${preview}"`,
  );
  if (o.source === "auto" && messages.length <= 1) {
    console.warn(`[zoho] zoho_auto_history_thin conversation_id=${o.conversationId} contact_id=${o.contactId ?? "-"} messages_count=${messages.length} (expected more — check wa_recent_messages RPC / migration)`);
  }
  return description;
}
