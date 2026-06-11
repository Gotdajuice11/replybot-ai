# ReplyBot AI — White-Label System v1.0

Reskin and deploy a fully branded AI chat widget for any client in under 10 minutes.

## How It Works

All branding, colors, copy, and bot personality live in a single `client-config.js` file. The server and widget never change between clients — only the config does.

```
replybot-ai-whitelabel/
├── server.js                   # Never touch this per client
├── public/index.html           # Never touch this per client
├── client-config.js            # ← Edit this per client
├── client-configs/             # Store per-client configs here
│   └── dental-example.js
└── package.json
```

---

## Onboarding a New Client (10 min)

**1. Duplicate the config**
```bash
cp client-config.js client-configs/acme-realty.js
```

**2. Edit the config** — only these fields matter:
```js
brand: {
  name:       "Acme Realty AI",
  avatar:     "🏡",
  poweredBy:  "Acme Realty",
},
colors: {
  primary:     "#16A34A",   // ← green for real estate
  primaryDark: "#15803D",
},
business: {
  phone:   "+1 (555) 123-4567",
  email:   "hello@acmerealty.com",
  booking: "https://calendly.com/acmerealty",
},
bot: {
  greeting:     "Hi! Looking to buy, sell, or just explore? I can help! 🏡",
  quickReplies: ["Find homes", "Sell my home", "Book a showing", "Get a valuation"],
  systemPrompt: `...` // tailor to the client's business
}
```

**3. Set env vars for this client**
```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY + any integrations the client wants
CLIENT_CONFIG_PATH=client-configs/acme-realty.js
```

**4. Deploy**
```bash
npm start
# or on Vercel: add CLIENT_CONFIG_PATH as an environment variable
```

---

## Per-Client Deployment Options

### Option A — One server, one client (simplest)
Each client gets their own Vercel/Railway deployment with their own `CLIENT_CONFIG_PATH` env var. Free tier on Vercel covers most small clients.

### Option B — One server, multiple clients (advanced)
Route by subdomain or path in `server.js`. Good for SaaS at scale.

---

## What the Config Controls

| Field | What changes |
|---|---|
| `brand.name` | Widget header, email subject lines, Slack alerts |
| `brand.avatar` | Bot emoji in the widget |
| `brand.poweredBy` | Widget footer text |
| `colors.primary` | Header gradient, buttons, message bubbles, borders, focus rings |
| `colors.primaryDark` | Gradient end, hover states |
| `bot.greeting` | First message every new visitor sees |
| `bot.quickReplies` | Tap-to-send buttons shown on first open |
| `bot.systemPrompt` | Full AI personality, lead capture flow, business info |
| `scoring.hotThreshold` | Score to fire all integrations |
| `scoring.warmThreshold` | Score to fire Airtable/Supabase |

---

## Quick Color Reference

| Vertical | Primary | Dark |
|---|---|---|
| Dental / Health | `#0EA5E9` | `#0284C7` |
| Real Estate | `#16A34A` | `#15803D` |
| Law Firm | `#7C3AED` | `#6D28D9` |
| Finance / Insurance | `#1D4ED8` | `#1E40AF` |
| Home Services | `#EA580C` | `#C2410C` |
| Wellness / Spa | `#DB2777` | `#BE185D` |
| Generic / Neutral | `#0F766E` | `#0D6B63` |
