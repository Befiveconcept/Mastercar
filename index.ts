// Mastercar Finanzen · Supabase Edge Function „claude“
// Nimmt Anfragen der angemeldeten App entgegen und fragt Claude über die Anthropic-API.
// Der API-Schlüssel liegt nur hier als Secret ANTHROPIC_API_KEY – nie im Browser.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const client = new Anthropic(); // liest ANTHROPIC_API_KEY aus den Secrets
// Gründlichkeit je Aufgabe: Belege auslesen knapp, Fragen normal, Auswertungen gründlich
const EFFORT: Record<string, "low" | "medium" | "high"> = { quick: "low", default: "medium", complex: "high" };

type Att = { type: string; data: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Nur angemeldete Team-Mitglieder
  const auth = req.headers.get("Authorization") ?? "";
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key, { global: { headers: { Authorization: auth } } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "not_signed_in" }, 401);
  const { data: isStaff, error: staffErr } = await sb.rpc("is_staff");
  if (staffErr || isStaff !== true) return json({ error: "not_allowed" }, 403);

  let body: { messages?: Anthropic.MessageParam[]; tier?: string; files?: Att[]; images?: Att[] };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const messages = Array.isArray(body.messages) ? body.messages.slice() : [];
  if (!messages.length) return json({ error: "bad_request" }, 400);

  // Belege (PDF, Fotos) an die letzte Nutzer-Nachricht hängen – vor den Text
  const files = [...(body.files ?? []), ...(body.images ?? [])]
    .filter((f) => f && f.data && /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/.test(f.type))
    .slice(0, 8);
  if (files.length) {
    const last = messages[messages.length - 1];
    const text = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content;
    const blocks = files.map((f) =>
      f.type === "application/pdf"
        ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: f.data } }
        : { type: "image" as const, source: { type: "base64" as const, media_type: f.type as "image/jpeg", data: f.data } }
    );
    messages[messages.length - 1] = { role: "user", content: [...blocks, ...text] } as Anthropic.MessageParam;
  }

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: EFFORT[body.tier ?? "default"] ?? "medium" },
      // Bei einer Sicherheits-Ablehnung automatisch ein passendes Ersatzmodell nutzen
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === "refusal") return json({ error: "refused", text: "" }, 422);
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    return json({ text, truncated: response.stop_reason === "max_tokens" });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (error instanceof Anthropic.AuthenticationError) return json({ error: "api_key_invalid" }, 500);
    if (error instanceof Anthropic.BadRequestError) return json({ error: "bad_request", detail: error.message }, 400);
    if (error instanceof Anthropic.APIError) return json({ error: "api_error", status: error.status }, 502);
    return json({ error: "unavailable" }, 502);
  }
});
