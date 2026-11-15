import express from "express";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import fetch from "node-fetch";
import twilio from "twilio";
import sgMail from "@sendgrid/mail";
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "url";
import path from "path";
import crypto from "crypto";

dotenv.config();

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
console.log("Boot: ANTHROPIC_KEY present =", !!ANTHROPIC_KEY, "| length =", ANTHROPIC_KEY.length);

const configPath = process.env.CLIENT_CONFIG_PATH || "./client-config.js";
const configUrl = pathToFileURL(path.resolve(configPath)).href;
const { default: CLIENT } = await import(configUrl);

const app = express();
const PORT = process.env.PORT || 3000;

// ── Admin auth ─────────────────────────────────────────────────
// Set ADMIN_PASSWORD in your host's environment variables. If it's missing,
// the dashboard API stays locked (fails closed).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // stay signed in for 12 hours

function sign(payload) {
  return crypto.createHmac("sha256", "rb-admin:" + ADMIN_PASSWORD).update(payload).digest("hex");
}
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function issueToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return `${exp}.${sign(exp)}`;
}
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "Admin password not configured" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() || !safeEqual(sig, sign(exp))) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) : null;

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY) : null;

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

function buildSystemPrompt() {
  const { phone, email, booking } = CLIENT.business;
  return CLIENT.bot.systemPrompt
    .replace(/\{phone\}/g, phone)
    .replace(/\{email\}/g, email)
    .replace(/\{booking\}/g, booking);
}

const LEAD_EXTRACT_PROMPT = `You are a data extractor. Given a chat conversation, extract lead information mentioned by the visitor. Return ONLY valid JSON: {"name":null,"businessName":null,"businessType":null,"problem":null,"email":null,"phone":null,"isQualified":false,"wantsBooking":false}`;

app.use(express.json({ limit: "64kb" }));
app.use(express.static("public", { extensions: ["html"] }));
app.get(["/admin/", "/dashboard", "/dashboard/"], (_req, res) => res.redirect(302, "/admin"));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use("/api/", rateLimit({ windowMs: 15*60*1000, max: 100, trustProxy: true, standardHeaders: true, legacyHeaders: false }));

const BIZ_SCORES = { dentist:10,dental:10,realtor:9,"real estate":9,"med spa":10,medspa:10,"law firm":9,lawyer:9,attorney:9,insurance:8,"home service":7,plumber:7,hvac:7,electrician:7,coach:6,consultant:6,agency:5 };

function scoreLead(lead) {
  let score = 0;
  if (lead.name) score += 10;
  if (lead.email) score += 20;
  if (lead.phone) score += 20;
  if (lead.businessName) score += 10;
  if (lead.problem) score += 15;
  if (lead.wantsBooking) score += 15;
  const bType = (lead.businessType || "").toLowerCase();
  for (const [key, pts] of Object.entries(BIZ_SCORES)) { if (bType.includes(key)) { score += pts; break; } }
  score = Math.min(score, 100);
  const tier = score >= 70 ? "Hot" : score >= 40 ? "Warm" : "Cold";
  const emoji = score >= 70 ? "🔥" : score >= 40 ? "🌡️" : "❄️";
  return { score, tier, emoji };
}

function sanitiseHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.filter(m => m && ["user","assistant"].includes(m.role) && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) })).slice(-60);
}

async function extractLead(history) {
  try {
    const convo = history.map(m => `${m.role === "user" ? "Visitor" : "Bot"}: ${m.content}`).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 400, system: LEAD_EXTRACT_PROMPT, messages: [{ role: "user", content: convo }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = await res.json();
    return JSON.parse((data.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim());
  } catch (err) { console.error("Lead extraction error:", err.message); return null; }
}

async function saveTranscript(sessionId, history, lead, scoring) {
  if (!supabase) return;
  try {
    await supabase.from("conversations").upsert({
      session_id: sessionId, messages: history,
      lead_name: lead?.name||null, lead_email: lead?.email||null, lead_phone: lead?.phone||null,
      business_type: lead?.businessType||null, problem: lead?.problem||null,
      score: scoring?.score||0, tier: scoring?.tier||"Cold", qualified: lead?.isQualified||false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "session_id" });
  } catch (err) { console.error("Supabase error:", err.message); }
}

const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, trustProxy: true, standardHeaders: true, legacyHeaders: false });
app.post("/api/admin/login", loginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "Admin password not configured" });
  const pwd = typeof req.body?.password === "string" ? req.body.password : "";
  if (!pwd || !safeEqual(pwd, ADMIN_PASSWORD)) return res.status(401).json({ error: "Incorrect password" });
  res.json({ token: issueToken() });
});

app.get("/api/widget-config", (_req, res) => {
  res.json({ brand: CLIENT.brand, colors: CLIENT.colors, bot: { greeting: CLIENT.bot.greeting, quickReplies: CLIENT.bot.quickReplies } });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { history: rawHistory, sessionId } = req.body;
    const history = sanitiseHistory(rawHistory);
    if (!history.length) return res.status(400).json({ error: "history required" });
    const sid = (typeof sessionId === "string" && sessionId.length < 100) ? sessionId : "unknown";

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1000, system: buildSystemPrompt(), messages: history.map(({ role, content }) => ({ role, content })) }),
    });

    if (!anthropicRes.ok) { const e = await anthropicRes.text(); console.error("Anthropic error:", e); return res.status(502).json({ error: "Upstream error" }); }
    const data = await anthropicRes.json();
    const reply = data.content?.[0]?.text || "";
    const userCount = history.filter(m => m.role === "user").length;
    if (userCount >= 3 && (userCount === 3 || userCount % 2 === 0)) {
      extractLead(history).then(lead => { if (lead) saveTranscript(sid, history, lead, scoreLead(lead)); });
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
    await saveTranscript(sid, history, lead, scoring);
    res.json({ success: true, lead, scoring });
  } catch (err) { console.error("Capture error:", err.message); res.status(500).json({ error: "Server error" }); }
});

app.get("/api/health", (_req, res) => res.json({ status: "ok", brand: CLIENT.brand.name, anthropic: !!ANTHROPIC_KEY }));

app.get("/api/stats", requireAdmin, async (_req, res) => {
  if (!supabase) return res.json({ error: "Supabase not configured" });
  try {
    const { data, error } = await supabase.from("conversations").select("tier,qualified,score").limit(1000);
    if (error) throw error;
    res.json({ total: data.length, qualified: data.filter(r=>r.qualified).length, hot: data.filter(r=>r.tier==="Hot").length, warm: data.filter(r=>r.tier==="Warm").length, cold: data.filter(r=>r.tier==="Cold").length, avgScore: data.length ? Math.round(data.reduce((s,r)=>s+(r.score||0),0)/data.length) : 0 });
  } catch (err) { res.status(500).json({ error: "Could not load stats" }); }
});

app.get("/api/leads", requireAdmin, async (_req, res) => {
  if (!supabase) return res.json({ leads: [] });
  try {
    const { data, error } = await supabase.from("conversations").select("*").order("updated_at", { ascending: false }).limit(500);
    if (error) throw error;
    res.json({ leads: data });
  } catch (err) { res.status(500).json({ error: "Could not load leads" }); }
});

const server = app.listen(PORT, () => {
  console.log(`✅ ReplyBot AI running on port ${PORT}`);
  console.log(`   Brand: ${CLIENT.brand.name}`);
  console.log(`   Anthropic: ${ANTHROPIC_KEY ? "✅" : "❌ MISSING"}`);
  console.log(`   Admin password: ${ADMIN_PASSWORD ? "✅" : "❌ MISSING — dashboard locked"}`);
});

["SIGTERM","SIGINT"].forEach(sig => process.on(sig, () => { server.close(() => process.exit(0)); }));
