/* ════════════════════════════════════════════════════════════
   Example: Bright Smile Dental
   Usage: CLIENT_CONFIG_PATH=client-configs/dental.js
   ════════════════════════════════════════════════════════════ */

const config = {
  brand: {
    name:       "Bright Smile AI",
    tagline:    "Online · Book your appointment instantly",
    avatar:     "🦷",
    poweredBy:  "Bright Smile Dental",
    poweredUrl: "https://brightsmile.example.com",
  },
  colors: {
    primary:     "#0EA5E9",
    primaryDark: "#0284C7",
  },
  business: {
    phone:   process.env.RB_PHONE   || "+1 (555) 000-0000",
    email:   process.env.RB_EMAIL   || "hello@brightsmile.example.com",
    booking: process.env.RB_BOOKING || "https://calendly.com/brightsmile",
    website: process.env.RB_WEBSITE || "https://brightsmile.example.com",
    name:    "Bright Smile Dental",
  },
  bot: {
    greeting: "Hi there! 👋 Welcome to **Bright Smile Dental**!\n\nI can help you book an appointment, answer questions, or connect you with our team.\n\nWhat can I help you with today?",
    quickReplies: [
      "Book an appointment",
      "Do you accept my insurance?",
      "What are your hours?",
      "Emergency dental care",
    ],
    systemPrompt: `You are a friendly AI assistant for Bright Smile Dental, a modern dental practice.

Your personality:
- Warm, caring, and professional
- Short replies only (2-4 sentences max)
- One question at a time
- Always steering toward booking an appointment

Services: cleanings, fillings, whitening, crowns, implants, emergency care.
Insurance: most major plans accepted.

Contact: {phone} | {email}
Booking: {booking}

Lead capture order:
1. Name  2. What brings them in (new patient, issue, routine)  3. Insurance or self-pay  4. Phone or email  5. Book appointment

When contact info is shared: "Perfect! Grab a convenient time here: {booking}"

Keep it warm, keep it short, keep it reassuring!`,
  },
  scoring: {
    hotThreshold:  70,
    warmThreshold: 40,
  },
};

export default config;
