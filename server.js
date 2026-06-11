/* ════════════════════════════════════════════════════════════
   ReplyBot AI — White-Label Backend v1.0
   ────────────────────────────────────────────────────────────
   All branding, colors, and copy come from client-config.js.
   This file never needs to change between clients.
   ════════════════════════════════════════════════════════════ */

import express        from "express";
import rateLimit      from "express-rate-limit";
import dotenv         from "dotenv";
import fetch          from "node-fetch";
import twilio         from "twilio";
import sgMail         from "@sendgrid/mail";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
import { pathToFileURL }  from "url";
import path               from "path";

dotenv.config();

// ── Load client config ────────────────────────────────────────
const configPath = process.env.CLIENT_CONFIG_PATH || "./client-config.js";
const configUrl  = pathToFileURL(path.resolve(configPath)).href;
const { default: CLIENT } = await import(configUrl);

// ── Startup validation ────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("❌  ANTHROPIC_API_KEY is required. Set it in .env and restart.");
  process.exit(1);
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Clients ───────────────────────────────────────────────────
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ── Build prompts from config ─────────────────────────────────
function buildSystemPrompt() {
  const { phone, email, booking } = CLIENT.business;
  return CLIENT.bot.systemPrompt
    .replace(/\{phone\}/g,   phone)
    .replace(/\{email\}/g,   email)
    .replace(/\{booking\}/g, booking);
}

const LEAD_EXTRACT_PROMPT = `You are a data extractor. Given a chat conversation, extract lead information mentioned by the visitor.
Return ONLY valid JSON (no markdown, no preamble) in this exact format:
{
  "name": "string or null",
  "businessName": "string or null",
  "businessType": "string or null",
  "problem": "string or null",
  "email": "string or null",
  "phone": "string or null",
  "isQualified": true,
  "wantsBooking": true
}
isQualified = true if we have at least name AND (email or phone).
wantsBooking = true if user expressed interest in a call, demo, or consultation.`;

// ── Middleware ────────────────────────────────────────────────
app.use(express.json({ limit: "64kb" }));
app.use(express.static("public"));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
}));

// ── Lead scoring ──────────────────────────────────────────────
const BIZ_SCORES = {
  dentist:10, dental:10, realtor:9, "real estate":9,
  "med spa":10, medspa:10, "law firm":9, lawyer:9, attorney:9,
  insurance:8, "home service":7, plumber:7, hvac:7,
  electrician:7, coach:6, consultant:6, agency:5,
};

function scoreLead(lead) {
  let score = 0;
  if (lead.name)         score += 10;
  if (lead.email)        score += 20;
  if (lead.phone)        score += 20;
  if (lead.businessName) score += 10;
  if (lead.problem)      score += 15;
  if (lead.wantsBooking) score += 15;
  const bType = (lead.businessType || "").toLowerCase();
  for (const [key, pts] of Object.entries(BIZ_SCORES)) {
    if (bType.includes(key)) { score += pts; break; }
  }
  score = Math.min(score, 100);
  const { hotThreshold, warmThreshold } = CLIENT.scoring;
  const tier  = score >= hotThreshold  ? "Hot"  : score >= warmThreshold ? "Warm"  : "Cold";
  const emoji = score >= hotThreshold  ? "🔥"   : score >= warmThreshold ? "🌡️"   : "❄️";
  return { score, tier, emoji };
}

// ── Sanitise history ──────────────────────────────────────────
function sanitiseHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(m => m && typeof m.role === "string" && typeof m.content === "string")
    .filter(m => ["user", "assistant"].includes(m.role))
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }))
    .slice(-60);
}

// ── Integration helpers ───────────────────────────────────────
async function extractLead(history) {
  try {
    const convo = history.map(m => `${m.role === "user" ? "Visitor" : "Bot"}: ${m.content}`).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 400, system: LEAD_EXTRACT_PROMPT, messages: [{ role: "user", content: convo }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = await res.json();
    return JSON.parse((data.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim());
  } catch (err) { console.error("Lead extraction error:", err.message); return null; }
}

async function notifySlack(lead, scoring) {
  if (!process.env.SLACK_WEBHOOK_URL) return;
  const fields = [
    lead.name         && `*Name:* ${lead.name}`,
    lead.businessName && `*Business:* ${lead.businessName}`,
    lead.businessType && `*Type:* ${lead.businessType}`,
    lead.problem      && `*Problem:* ${lead.problem}`,
    lead.email        && `*Email:* ${lead.email}`,
    lead.phone        && `*Phone:* ${lead.phone}`,
    `*Score:* ${scoring.emoji} ${scoring.tier} (${scoring.score}/100)`,
  ].filter(Boolean).join("\n");
  try {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: [
        { type: "header", text: { type: "plain_text", text: `${scoring.emoji} New ${scoring.tier} Lead — ${CLIENT.brand.name}`, emoji: true } },
        { type: "section", text: { type: "mrkdwn", text: fields } },
        { type: "context", elements: [{ type: "mrkdwn", text: `Captured ${new Date().toLocaleString()}` }] },
      ]}),
    });
    console.log("✅ Slack notified");
  } catch (err) { console.error("Slack error:", err.message); }
}

async function sendSMS(lead, scoring) {
  if (!twilioClient || !process.env.TWILIO_ALERT_NUMBER) return;
  const body = [
    `${scoring.emoji} ${scoring.tier} Lead — ${CLIENT.brand.name}`,
    lead.name         && `Name: ${lead.name}`,
    lead.businessType && `Business: ${lead.businessType}`,
    lead.email        && `Email: ${lead.email}`,
    lead.phone        && `Phone: ${lead.phone}`,
    `Score: ${scoring.score}/100`,
  ].filter(Boolean).join("\n");
  try {
    await twilioClient.messages.create({ body, from: process.env.TWILIO_FROM_NUMBER, to: process.env.TWILIO_ALERT_NUMBER });
    console.log("✅ SMS sent");
  } catch (err) { console.error("Twilio error:", err.message); }
}

async function sendEmail(lead, scoring, history) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_ALERT_EMAIL) return;
  const { primary, primaryDark } = CLIENT.colors;
  const transcript = history.map(m =>
    `<tr><td style="padding:4px 8px;color:${m.role==="user"?primary:"#444"};font-weight:${m.role==="user"?"600":"400"}">${m.role==="user"?"👤 Visitor":"🤖 Bot"}:</td><td style="padding:4px 8px">${m.content.replace(/</g,"&lt;").replace(/\n/g,"<br>")}</td></tr>`
  ).join("");
  const rows = [["Name",lead.name],["Business",lead.businessName],["Type",lead.businessType],["Problem",lead.problem],["Email",lead.email],["Phone",lead.phone]]
    .filter(([,v])=>v)
    .map(([k,v])=>`<tr><td style="padding:6px 0;color:#4a6b6b;width:120px"><strong>${k}</strong></td><td style="padding:6px 0">${String(v).replace(/</g,"&lt;")}</td></tr>`)
    .join("");
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    <div style="background:linear-gradient(135deg,${primary},${primaryDark});padding:24px;border-radius:12px 12px 0 0">
      <h2 style="color:#fff;margin:0">${scoring.emoji} ${scoring.tier} Lead — ${CLIENT.brand.name}</h2>
      <p style="color:rgba(255,255,255,0.85);margin:6px 0 0">Score: ${scoring.score}/100 · ${new Date().toLocaleString()}</p>
    </div>
    <div style="background:#f5faff;padding:24px;border:1px solid #dbeafe"><table style="width:100%;border-collapse:collapse">${rows}</table></div>
    <div style="background:#fff;padding:24px;border:1px solid #dbeafe;border-top:none">
      <h3 style="color:${primary};margin:0 0 16px">Conversation Transcript</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">${transcript}</table>
    </div>
    <div style="padding:12px;text-align:center;color:#94a3b8;font-size:11px">Powered by ${CLIENT.brand.name}</div>
  </div>`;
  try {
    await sgMail.send({ to: process.env.SENDGRID_ALERT_EMAIL, from: process.env.SENDGRID_FROM_EMAIL || `alerts@replybot.ai`, subject: `${scoring.emoji} ${scoring.tier} Lead: ${lead.name||"Unknown"} — ${CLIENT.brand.name}`, html });
    console.log("✅ Email sent");
  } catch (err) { console.error("SendGrid error:", err.message); }
}

async function saveTranscript(sessionId, history, lead, scoring) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from("conversations").upsert({
      session_id: sessionId, messages: history,
      lead_name: lead?.name||null, lead_email: lead?.email||null, lead_phone: lead?.phone||null,
      business_name: lead?.businessName||null, business_type: lead?.businessType||null,
      problem: lead?.problem||null, score: scoring?.score||0, tier: scoring?.tier||"Cold",
      qualified: lead?.isQualified||false, source: CLIENT.brand.name,
      updated_at: new Date().toISOString(),
    }, { onConflict: "session_id" });
    if (error) console.error("Supabase error:", error.message);
    else console.log("✅ Transcript saved");
  } catch (err) { console.error("Supabase error:", err.message); }
}

async function logToAirtable(lead, scoring) {
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) return;
  try {
    const res = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(process.env.AIRTABLE_TABLE_NAME||"Leads")}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.AIRTABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { "Name": lead.name||"Unknown", "Business Name": lead.businessName||"", "Business Type": lead.businessType||"", "Problem": lead.problem||"", "Email": lead.email||"", "Phone": lead.phone||"", "Qualified": lead.isQualified||false, "Score": scoring.score, "Tier": scoring.tier, "Source": CLIENT.brand.name, "Date": new Date().toISOString().split("T")[0] } }),
    });
    if (!res.ok) console.error("Airtable error:", await res.text());
    else console.log("✅ Airtable logged");
  } catch (err) { console.error("Airtable error:", err.message); }
}

async function syncGoHighLevel(lead) {
  if (!process.env.GHL_API_KEY || !process.env.GHL_LOCATION_ID) return;
  try {
    const [firstName, ...rest] = (lead.name||"").split(" ");
    const res = await fetch("https://services.leadconnectorhq.com/contacts/", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.GHL_API_KEY}`, "Content-Type": "application/json", "Version": "2021-07-28" },
      body: JSON.stringify({ locationId: process.env.GHL_LOCATION_ID, firstName: firstName||"", lastName: rest.join(" ")||"", email: lead.email||"", phone: lead.phone||"", companyName: lead.businessName||"", source: CLIENT.brand.name, tags: ["replybot-ai", lead.businessType||"unknown"].filter(Boolean) }),
    });
    if (!res.ok) console.error("GHL error:", await res.text());
    else console.log("✅ GoHighLevel synced");
  } catch (err) { console.error("GHL error:", err.message); }
}

async function syncHubSpot(lead) {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return;
  try {
    const [firstName, ...rest] = (lead.name||"").split(" ");
    const properties = { firstname: firstName||"", lastname: rest.join(" ")||"", email: lead.email||"", phone: lead.phone||"", company: lead.businessName||"", hs_lead_status: "NEW", lead_source: CLIENT.brand.name };
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties }),
    });
    if (res.ok) { console.log("✅ HubSpot synced"); return; }
    const err = await res.json();
    if (err.status === "CONFLICT" && err.message?.includes("Contact already exists")) {
      const existingId = err.message.match(/ID: (\d+)/)?.[1];
      if (existingId) {
        const patch = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`, {
          method: "PATCH",
          headers: { "Authorization": `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ properties }),
        });
        if (patch.ok) console.log("✅ HubSpot contact updated");
        else console.error("HubSpot patch error:", await patch.text());
      }
    } else { console.error("HubSpot error:", err.message); }
  } catch (err) { console.error("HubSpot error:", err.message); }
}

async function fireAll(lead, scoring, history, sessionId) {
  const tasks = [saveTranscript(sessionId, history, lead, scoring)];
  if (lead.name || lead.email || lead.phone) {
    if (scoring.score >= CLIENT.scoring.warmThreshold) tasks.push(logToAirtable(lead, scoring));
    if (scoring.score >= CLIENT.scoring.hotThreshold && lead.isQualified) {
      tasks.push(notifySlack(lead, scoring));
      tasks.push(sendEmail(lead, scoring, history));
      tasks.push(sendSMS(lead, scoring));
      tasks.push(syncGoHighLevel(lead));
      tasks.push(syncHubSpot(lead));
    }
  }
  const results = await Promise.allSettled(tasks);
  results.forEach((r, i) => { if (r.status === "rejected") console.error(`Task ${i} failed:`, r.reason); });
}

// ── Routes ────────────────────────────────────────────────────

// CORS for embed — allow any origin to load the widget config and chat
app.use("/api/widget-config", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.use("/api/chat", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use("/api/capture-lead", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Serve client config to the widget (colors, brand, bot copy only — no secrets)
app.get("/api/widget-config", (_req, res) => {
  res.json({
    brand:        CLIENT.brand,
    colors:       CLIENT.colors,
    bot: {
      greeting:     CLIENT.bot.greeting,
      quickReplies: CLIENT.bot.quickReplies,
    },
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { history: rawHistory, sessionId } = req.body;
    const history = sanitiseHistory(rawHistory);
    if (!history.length) return res.status(400).json({ error: "history required" });
    const sid = (typeof sessionId === "string" && sessionId.length < 100) ? sessionId : "unknown";

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: buildSystemPrompt(), messages: history.map(({ role, content }) => ({ role, content })) }),
    });

    if (!anthropicRes.ok) return res.status(502).json({ error: "Upstream error" });
    const data  = await anthropicRes.json();
    const reply = data.content?.[0]?.text || "";

    const userCount = history.filter(m => m.role === "user").length;
    if (userCount >= 3 && (userCount === 3 || userCount % 2 === 0)) {
      extractLead(history).then(lead => { if (lead) fireAll(lead, scoreLead(lead), history, sid); });
    } else if (supabase && sid !== "unknown") {
      saveTranscript(sid, history, null, null).catch(() => {});
    }

    res.json({ reply });
  } catch (err) { console.error("Chat error:", err.message); res.status(500).json({ error: "Server error" }); }
});

app.post("/api/capture-lead", async (req, res) => {
  try {
    const { history: rawHistory, sessionId } = req.body;
    const history = sanitiseHistory(rawHistory);
    if (!history.length) return res.status(400).json({ error: "history required" });
    const sid = (typeof sessionId === "string" && sessionId.length < 100) ? sessionId : "unknown";
    const lead = await extractLead(history);
    if (!lead) return res.json({ success: false });
    const scoring = scoreLead(lead);
    await fireAll(lead, scoring, history, sid);
    res.json({ success: true, lead, scoring });
  } catch (err) { console.error("Capture error:", err.message); res.status(500).json({ error: "Server error" }); }
});

app.get("/api/health", (_req, res) => res.json({
  status: "ok", version: "1.0.0", brand: CLIENT.brand.name,
  integrations: {
    slack: !!process.env.SLACK_WEBHOOK_URL, twilio: !!process.env.TWILIO_ACCOUNT_SID,
    supabase: !!process.env.SUPABASE_URL, sendgrid: !!process.env.SENDGRID_API_KEY,
    airtable: !!process.env.AIRTABLE_API_KEY, gohighlevel: !!process.env.GHL_API_KEY,
    hubspot: !!process.env.HUBSPOT_ACCESS_TOKEN,
  },
}));

// ── /api/leads — dashboard data ──────────────────────────────
app.get("/api/leads", async (req, res) => {
  // Simple token auth — pass ?token=ADMIN_PASSWORD or Authorization header
  const token = req.query.token || req.headers["authorization"]?.replace("Bearer ", "");
  if (process.env.ADMIN_PASSWORD && token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!supabase) return res.json({ leads: [] });
  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("id,session_id,lead_name,lead_email,lead_phone,business_name,business_type,problem,score,tier,qualified,source,messages,updated_at,created_at")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    res.json({ leads: data });
  } catch (err) {
    console.error("Leads error:", err.message);
    res.status(500).json({ error: "Could not load leads" });
  }
});

app.get("/api/stats", async (_req, res) => {
  if (!supabase) return res.json({ error: "Supabase not configured" });
  try {
    const { data, error } = await supabase.from("conversations").select("tier, qualified, score").order("updated_at", { ascending: false }).limit(1000);
    if (error) throw error;
    res.json({
      total: data.length, qualified: data.filter(r=>r.qualified).length,
      hot: data.filter(r=>r.tier==="Hot").length, warm: data.filter(r=>r.tier==="Warm").length,
      cold: data.filter(r=>r.tier==="Cold").length,
      avgScore: data.length ? Math.round(data.reduce((s,r)=>s+(r.score||0),0)/data.length) : 0,
    });
  } catch (err) { res.status(500).json({ error: "Could not load stats" }); }
});

// ── Graceful shutdown ─────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n✅ ${CLIENT.brand.name} — White-Label Backend v1.0 → http://localhost:${PORT}`);
  console.log(`   Primary color: ${CLIENT.colors.primary}`);
  console.log(`   Config file:   ${configPath}\n`);
});

["SIGTERM", "SIGINT"].forEach(sig =>
  process.on(sig, () => { server.close(() => process.exit(0)); })
);
