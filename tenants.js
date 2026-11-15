/* ════════════════════════════════════════════════════════════
   ReplyBot AI — per-business (self-serve) helpers
   Each signed-up business has a row in the `businesses` table.
   The widget passes that row's embed_key; we turn the row into the
   same config shape client-config.js uses, so the rest of the server
   doesn't care whether a bot came from a file or from a signup.
   ════════════════════════════════════════════════════════════ */

import crypto from "crypto";

export const TRIAL_DAYS = 7;
export const PLANS = ["starter", "pro", "premium"];

// ── Small utils ──────────────────────────────────────────────
export function newEmbedKey() {
  return "rb_" + crypto.randomBytes(12).toString("base64url");
}

export function darken(hex, amount = 0.15) {
  const n = parseInt(hex.slice(1), 16);
  const ch = s => Math.max(0, Math.round(((n >> s) & 255) * (1 - amount)));
  return "#" + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, "0")).join("");
}

// ── Subscription state ──────────────────────────────────────
export function isActive(b) {
  if (!b) return false;
  const s = b.subscription_status;
  if (s === "active" || s === "past_due") return true; // past_due: Stripe is still retrying the card
  if (s === "trialing") return !b.trial_ends_at || new Date(b.trial_ends_at) > new Date();
  return false;
}

// ── Prompt + widget config built from the owner's answers ───
export function buildBusinessPrompt(b) {
  const lines = [
    `You are the friendly website assistant for ${b.name}${b.industry ? `, a ${b.industry}` : ""}.`,
    "",
    "Your personality:",
    "- Warm, professional, and easy to talk to",
    "- Short replies only (2-4 sentences max)",
    "- Ask one question at a time",
    "- Gently steer toward booking an appointment or getting in touch",
    "",
  ];
  if (b.services) lines.push("Services offered:", b.services, "");
  if (b.hours) lines.push("Business hours:", b.hours, "");
  if (b.faq) lines.push("Answers to common questions (use these; don't invent other facts):", b.faq, "");
  const contact = [b.phone && `Phone: ${b.phone}`, b.email && `Email: ${b.email}`, b.website && `Website: ${b.website}`].filter(Boolean).join(" | ");
  if (contact) lines.push(`Contact: ${contact}`);
  if (b.booking_url) lines.push(`Booking link: ${b.booking_url}`);
  lines.push(
    "",
    "Lead capture order (one at a time, naturally):",
    "1. Name  2. What they need help with  3. Email or phone  4. Invite them to book",
    "",
    b.booking_url
      ? `When a visitor shares an email or phone number, share the booking link: ${b.booking_url}`
      : "When a visitor shares an email or phone number, tell them the team will reach out shortly.",
    "",
    `If you don't know an answer, never guess prices, availability, or medical/legal specifics. Say the team can help${b.phone ? ` at ${b.phone}` : ""}${b.email ? ` or ${b.email}` : ""}.`,
  );
  if (b.extra_instructions) lines.push("", "Extra instructions from the business owner:", b.extra_instructions);
  lines.push("", "Keep it human, keep it short, keep it helpful!");
  return lines.join("\n");
}

export function businessToConfig(b) {
  const primary = b.primary_color || "#0EA5E9";
  return {
    brand: {
      name: b.name,
      tagline: "Online · Replies instantly",
      avatar: "💬",
      poweredBy: "ReplyBot AI",
      poweredUrl: "https://replybotai.live",
    },
    colors: { primary, primaryDark: darken(primary) },
    bot: {
      greeting: b.greeting || `Hi there! 👋 Welcome to ${b.name}. How can I help you today?`,
      quickReplies: [
        "What services do you offer?",
        "What are your hours?",
        b.booking_url ? "Book an appointment" : "How do I get in touch?",
      ],
    },
  };
}

// ── Owner form validation ───────────────────────────────────
const FIELDS = {
  name: 120, industry: 80, phone: 40, email: 160, booking_url: 500, website: 500,
  hours: 600, services: 3000, faq: 6000, greeting: 500, extra_instructions: 2000,
  alert_email: 160,
};

export function cleanBusinessInput(body) {
  const out = {};
  const errors = [];
  for (const [k, max] of Object.entries(FIELDS)) {
    if (body?.[k] === undefined) continue;
    const v = typeof body[k] === "string" ? body[k].trim() : "";
    if (v.length > max) errors.push(`${k} is too long (max ${max} characters)`);
    out[k] = v || null;
  }
  for (const k of ["booking_url", "website"]) {
    if (out[k] && !/^https?:\/\/\S+$/i.test(out[k])) errors.push(`${k === "website" ? "Website" : "Booking link"} must start with http:// or https://`);
  }
  for (const k of ["email", "alert_email"]) {
    if (out[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out[k])) errors.push(`${k === "email" ? "Email" : "Alert email"} doesn't look right`);
  }
  if (body?.primary_color !== undefined) {
    if (/^#[0-9a-f]{6}$/i.test(body.primary_color)) out.primary_color = body.primary_color;
    else errors.push("Color must be a hex value like #0EA5E9");
  }
  if (body?.plan !== undefined) {
    if (PLANS.includes(body.plan)) out.plan = body.plan;
    else errors.push("Unknown plan");
  }
  return { data: out, errors };
}

// ── Lookup by embed key (cached briefly) ────────────────────
const cache = new Map();
const CACHE_MS = 60 * 1000;

export async function getBusinessByKey(supabase, key) {
  if (!supabase || typeof key !== "string" || !/^rb_[\w-]{8,40}$/.test(key)) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.b;
  const { data, error } = await supabase.from("businesses").select("*").eq("embed_key", key).maybeSingle();
  if (error) { console.error("Business lookup error:", error.message); return null; }
  cache.set(key, { b: data, t: Date.now() });
  return data;
}

export function forgetBusiness(key) { cache.delete(key); }
