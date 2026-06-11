/* ════════════════════════════════════════════════════════════
   ReplyBot AI — White-Label Client Config
   ────────────────────────────────────────────────────────────
   This is the ONLY file you need to edit per client.
   Everything else (server.js, widget) reads from here.

   How to onboard a new client:
     1. Duplicate this file → client-configs/clientname.js
     2. Fill in all values below
     3. Set CLIENT_CONFIG_PATH=client-configs/clientname.js in .env
     4. Deploy — done.
   ════════════════════════════════════════════════════════════ */

const config = {

  // ── Brand ───────────────────────────────────────────────────
  brand: {
    name:       "ReplyBot AI",          // Widget header name
    tagline:    "Online · Replies instantly",
    avatar:     "🤖",                   // Emoji or swap for image URL
    poweredBy:  "ReplyBot AI",          // Footer text ("Powered by X")
    poweredUrl: "https://replybot.ai",  // Footer link
  },

  // ── Colors ──────────────────────────────────────────────────
  // Change these two hex values to instantly reskin everything
  colors: {
    primary:   "#0EA5E9",   // Main brand color (buttons, header, accents)
    primaryDark: "#0284C7", // Darker shade (hover states, gradient end)
  },

  // ── Business contact info ────────────────────────────────────
  business: {
    phone:      process.env.RB_PHONE   || "[INSERT PHONE]",
    email:      process.env.RB_EMAIL   || "[INSERT EMAIL]",
    booking:    process.env.RB_BOOKING || "[INSERT CALENDLY LINK]",
    website:    process.env.RB_WEBSITE || "[INSERT WEBSITE]",
    name:       process.env.RB_BIZ_NAME || "our team",
  },

  // ── Bot personality ─────────────────────────────────────────
  bot: {
    // Opening message shown to every new visitor
    greeting: `Hey there! 👋 I'm here to help answer your questions and connect you with the right people.\n\nWhat can I help you with today?`,

    // Quick reply buttons shown on first open
    quickReplies: [
      "What services do you offer?",
      "How does pricing work?",
      "How fast can you get started?",
      "Book a free consultation",
    ],

    // System prompt — controls AI personality & lead capture flow
    // Placeholders like {phone}, {booking} are auto-filled at runtime
    systemPrompt: `You are a friendly and helpful AI assistant.

Your personality:
- Warm, professional, and easy to talk to
- Short replies only (2-4 sentences max)
- Ask one question at a time
- Always steering toward booking a free consultation

Services you help with:
- Answering questions about the business
- Qualifying leads and capturing contact info
- Booking consultations

Contact: Phone: {phone} | Email: {email}
Booking: {booking}

Lead capture order (one at a time):
1. Name  2. Business or context  3. Main challenge or goal  4. Email or phone  5. Invite to free consult

When a visitor provides email or phone, share the booking link:
"Perfect! You can grab a free slot here: {booking} — looking forward to connecting!"

Unknown questions: "Great question! For the best answer, reach the team at {phone} or {email}."

Keep it human, keep it short, keep it helpful!`,
  },

  // ── Lead scoring — adjust thresholds per client vertical ────
  scoring: {
    hotThreshold:  70,   // score >= this → Hot (fires all integrations)
    warmThreshold: 40,   // score >= this → Warm (fires Airtable + Supabase)
  },

};

export default config;
