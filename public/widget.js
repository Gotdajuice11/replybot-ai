/**
 * ReplyBot AI — Embed Snippet v1.0
 * ─────────────────────────────────────────────────────────────
 * Drop this single <script> tag into any website to add the
 * ReplyBot AI chat widget. No iframe, no dependencies.
 *
 * Usage:
 *   <script src="https://YOUR-DOMAIN.com/widget.js"
 *     data-rb-key="CLIENT_KEY_HERE"
 *     async defer>
 *   </script>
 *
 * Optional attributes:
 *   data-rb-key       Required. Client key (set in server embed-keys)
 *   data-rb-position  "right" (default) or "left"
 *   data-rb-offset    Bottom/side offset in px (default: 24)
 *   data-rb-open      "true" to start open
 * ─────────────────────────────────────────────────────────────
 */

(function () {
  "use strict";

  // ── Guard: don't load twice ─────────────────────────────────
  if (window.__RB_LOADED) return;
  window.__RB_LOADED = true;

  // ── Read config from the script tag ────────────────────────
  const scriptEl   = document.currentScript ||
    document.querySelector("script[data-rb-key]");
  const BASE_URL   = scriptEl ? new URL(scriptEl.src).origin : "";
  const CLIENT_KEY = scriptEl?.getAttribute("data-rb-key") || "";
  const POSITION   = scriptEl?.getAttribute("data-rb-position") || "right";
  const OFFSET     = parseInt(scriptEl?.getAttribute("data-rb-offset") || "24", 10);
  const START_OPEN = scriptEl?.getAttribute("data-rb-open") === "true";

  if (!CLIENT_KEY) {
    console.warn("[ReplyBot AI] Missing data-rb-key attribute on <script> tag.");
  }

  // ── Session ID ──────────────────────────────────────────────
  const STORAGE_KEY = `rb_sid_${CLIENT_KEY}`;
  const HISTORY_KEY = `rb_h_${CLIENT_KEY}`;
  let sessionId = localStorage.getItem(STORAGE_KEY);
  if (!sessionId) {
    sessionId = "rb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(STORAGE_KEY, sessionId);
  }

  // ── State ───────────────────────────────────────────────────
  let isOpen = false, loading = false, quickGone = false;
  let history = [];
  let CONFIG  = null;

  function saveHistory(h) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {} }
  function loadHistory()  { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; } }

  // ── Inject styles ───────────────────────────────────────────
  const style = document.createElement("style");
  style.id = "rb-embed-styles";
  style.textContent = `
    #rb-embed-toggle,#rb-embed-window,#rb-embed-overlay{all:initial;font-family:'DM Sans',sans-serif;box-sizing:border-box}
    #rb-embed-toggle *,#rb-embed-window *{box-sizing:border-box;margin:0;padding:0}

    #rb-embed-toggle{
      position:fixed;bottom:${OFFSET}px;${POSITION}:${OFFSET}px;z-index:2147483646;
      width:60px;height:60px;border-radius:50%;
      background:linear-gradient(135deg,var(--rb-p,#0EA5E9),var(--rb-pd,#0284C7));
      border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
      box-shadow:0 6px 24px rgba(14,165,233,.3),0 2px 8px rgba(0,0,0,.12);
      transition:transform .2s,box-shadow .2s;font-size:22px;
    }
    #rb-embed-toggle:hover{transform:scale(1.08);box-shadow:0 10px 32px rgba(14,165,233,.4)}
    #rb-embed-toggle::before{
      content:'';position:absolute;inset:-6px;border-radius:50%;
      border:2px solid var(--rb-p,#0EA5E9);opacity:0;
      animation:rb-ring 3s ease-in-out infinite
    }
    @keyframes rb-ring{0%,100%{opacity:0;transform:scale(1)}50%{opacity:.25;transform:scale(1.1)}}

    #rb-badge{
      position:absolute;top:-2px;right:-2px;
      min-width:20px;height:20px;border-radius:10px;
      background:#ef4444;color:#fff;font-size:10px;font-weight:700;
      display:flex;align-items:center;justify-content:center;
      padding:0 4px;border:2px solid #fff;
      animation:rb-pop .4s cubic-bezier(.34,1.56,.64,1)
    }
    @keyframes rb-pop{from{transform:scale(0)}to{transform:scale(1)}}

    #rb-embed-window{
      position:fixed;
      bottom:${OFFSET + 72}px;${POSITION}:${OFFSET}px;
      z-index:2147483647;
      width:360px;max-height:580px;min-height:200px;
      background:#fff;border-radius:20px;
      border:1px solid rgba(14,165,233,.15);
      box-shadow:0 20px 60px rgba(14,165,233,.15),0 4px 20px rgba(0,0,0,.1);
      display:flex;flex-direction:column;overflow:hidden;
      opacity:0;pointer-events:none;
      transform:translateY(16px) scale(.97);transform-origin:bottom ${POSITION};
      transition:opacity .25s ease,transform .25s cubic-bezier(.34,1.3,.64,1);
    }
    #rb-embed-window.open{opacity:1;pointer-events:all;transform:translateY(0) scale(1)}

    @media(max-width:480px){
      #rb-embed-window{
        width:calc(100vw - ${OFFSET * 2}px);
        max-height:calc(100svh - ${OFFSET + 80}px);
      }
    }

    .rb-hdr{
      background:linear-gradient(135deg,var(--rb-p,#0EA5E9),var(--rb-pd,#0284C7));
      padding:14px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;
    }
    .rb-hdr-av{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.2);border:1.5px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0}
    .rb-hdr-info{flex:1}
    .rb-hdr-name{font-size:14px;font-weight:700;color:#fff;letter-spacing:.2px}
    .rb-hdr-sub{font-size:11px;color:rgba(255,255,255,.8);margin-top:1px;display:flex;align-items:center;gap:4px}
    .rb-dot{width:6px;height:6px;border-radius:50%;background:#a7f3d0;animation:rb-pulse 2s infinite}
    @keyframes rb-pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .rb-x{background:rgba(255,255,255,.15);border:none;width:30px;height:30px;border-radius:50%;color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;flex-shrink:0}
    .rb-x:hover{background:rgba(255,255,255,.28)}

    .rb-msgs{flex:1;overflow-y:auto;padding:14px 12px 6px;display:flex;flex-direction:column;gap:9px;scrollbar-width:thin;scrollbar-color:rgba(14,165,233,.2) transparent}
    .rb-msgs::-webkit-scrollbar{width:3px}
    .rb-msgs::-webkit-scrollbar-thumb{background:rgba(14,165,233,.2);border-radius:2px}

    .rb-row{display:flex;gap:7px;animation:rb-up .25s ease forwards}
    .rb-row.u{flex-direction:row-reverse}
    @keyframes rb-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

    .rb-av{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;margin-top:2px}
    .rb-av.b{background:rgba(14,165,233,.1);border:1.5px solid rgba(14,165,233,.2)}
    .rb-av.u{background:#f3f0ff;border:1.5px solid rgba(120,80,220,.1)}

    .rb-bub{max-width:82%;padding:9px 13px;border-radius:16px;font-size:13px;line-height:1.6;word-break:break-word}
    .rb-bub.b{background:#f0f8ff;color:#1a2836;border-top-left-radius:4px;border:1px solid rgba(14,165,233,.14)}
    .rb-bub.u{background:linear-gradient(135deg,var(--rb-p,#0EA5E9),var(--rb-pd,#0284C7));color:#fff;border-top-right-radius:4px}
    .rb-bub.b strong{color:var(--rb-pd,#0284C7);font-weight:700}
    .rb-bub.b a{color:var(--rb-pd,#0284C7);text-underline-offset:2px}

    .rb-typing{display:flex;align-items:center;gap:4px;padding:11px 14px;background:#f0f8ff;border:1px solid rgba(14,165,233,.14);border-radius:16px;border-top-left-radius:4px;width:fit-content}
    .rb-td{width:5px;height:5px;border-radius:50%;background:var(--rb-p,#0EA5E9);opacity:.4;animation:rb-bounce 1.2s infinite}
    .rb-td:nth-child(2){animation-delay:.16s}
    .rb-td:nth-child(3){animation-delay:.32s}
    @keyframes rb-bounce{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-4px);opacity:1}}

    .rb-quick{padding:3px 12px 8px;display:flex;flex-wrap:wrap;gap:5px}
    .rb-qr{background:rgba(14,165,233,.08);border:1.5px solid rgba(14,165,233,.25);color:var(--rb-pd,#0284C7);padding:4px 11px;border-radius:18px;font-size:11.5px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:inherit}
    .rb-qr:hover{background:var(--rb-p,#0EA5E9);color:#fff;border-color:var(--rb-p,#0EA5E9)}

    .rb-inp-area{padding:9px 10px 10px;background:#f7fafd;border-top:1px solid rgba(14,165,233,.12);display:flex;gap:7px;align-items:flex-end;flex-shrink:0}
    .rb-inp{flex:1;background:#fff;border:1.5px solid rgba(14,165,233,.2);border-radius:12px;padding:8px 12px;color:#1a2836;font-size:13px;font-family:inherit;outline:none;resize:none;line-height:1.5;max-height:80px;transition:border-color .2s,box-shadow .2s}
    .rb-inp::placeholder{color:#94b4c8}
    .rb-inp:focus{border-color:var(--rb-p,#0EA5E9);box-shadow:0 0 0 3px rgba(14,165,233,.1)}
    .rb-send{width:38px;height:38px;flex-shrink:0;background:linear-gradient(135deg,var(--rb-p,#0EA5E9),var(--rb-pd,#0284C7));border:none;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(14,165,233,.25);transition:all .15s}
    .rb-send:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 18px rgba(14,165,233,.35)}
    .rb-send:disabled{opacity:.35;cursor:not-allowed;box-shadow:none}
    .rb-send svg{width:16px;height:16px;fill:#fff;transform:translateX(1px)}

    .rb-footer{text-align:center;font-size:10px;color:#94b4c8;padding:4px 0 7px;flex-shrink:0;background:#f7fafd}
    .rb-footer a{color:var(--rb-pd,#0284C7);text-decoration:none}
  `;
  document.head.appendChild(style);

  // ── Inject Google Font (DM Sans) ────────────────────────────
  if (!document.querySelector("link[href*='DM+Sans']")) {
    const link = document.createElement("link");
    link.rel  = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }

  // ── Build DOM ───────────────────────────────────────────────
  const toggle = document.createElement("button");
  toggle.id = "rb-embed-toggle";
  toggle.setAttribute("aria-label", "Chat with us");
  toggle.innerHTML = `<span id="rb-badge">1</span><span id="rb-toggle-icon">💬</span>`;
  toggle.addEventListener("click", rbToggle);

  const win = document.createElement("div");
  win.id = "rb-embed-window";
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-modal", "true");
  win.innerHTML = `
    <div class="rb-hdr">
      <div class="rb-hdr-av" id="rb-av">🤖</div>
      <div class="rb-hdr-info">
        <div class="rb-hdr-name" id="rb-brand">Loading…</div>
        <div class="rb-hdr-sub"><span class="rb-dot"></span><span id="rb-tagline">Online</span></div>
      </div>
      <button class="rb-x" aria-label="Close chat">✕</button>
    </div>
    <div class="rb-msgs" id="rb-msgs" role="log" aria-live="polite"></div>
    <div class="rb-quick" id="rb-quick"></div>
    <div class="rb-inp-area">
      <textarea class="rb-inp" id="rb-inp" rows="1" placeholder="Type a message…" aria-label="Message"></textarea>
      <button class="rb-send" id="rb-send-btn" disabled aria-label="Send">
        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
    <div class="rb-footer">Powered by <a id="rb-powered" href="#">ReplyBot AI</a></div>
  `;

  document.body.appendChild(toggle);
  document.body.appendChild(win);

  win.querySelector(".rb-x").addEventListener("click", rbToggle);

  // ── Load config from server ─────────────────────────────────
  async function init() {
    try {
      const url = `${BASE_URL}/api/widget-config${CLIENT_KEY ? "?key=" + encodeURIComponent(CLIENT_KEY) : ""}`;
      const res = await fetch(url);
      CONFIG    = await res.json();

      // Apply CSS color variables
      const { primary, primaryDark } = CONFIG.colors;
      document.documentElement.style.setProperty("--rb-p",  primary);
      document.documentElement.style.setProperty("--rb-pd", primaryDark);

      // Update DOM with brand
      win.querySelector("#rb-brand").textContent    = CONFIG.brand.name;
      win.querySelector("#rb-tagline").textContent  = CONFIG.brand.tagline;
      win.querySelector("#rb-av").textContent       = CONFIG.brand.avatar;
      win.querySelector("#rb-powered").textContent  = CONFIG.brand.poweredBy;
      win.querySelector("#rb-powered").href         = CONFIG.brand.poweredUrl;
      win.querySelector(".rb-inp").placeholder      = `Message ${CONFIG.brand.name}…`;
      toggle.querySelector("#rb-toggle-icon").textContent = CONFIG.brand.avatar;
      win.setAttribute("aria-label", `Chat with ${CONFIG.brand.name}`);

    } catch {
      CONFIG = {
        brand:  { name:"Support Chat", tagline:"Online · Replies instantly", avatar:"🤖", poweredBy:"ReplyBot AI", poweredUrl:"#" },
        colors: { primary:"#0EA5E9", primaryDark:"#0284C7" },
        bot:    { greeting:"Hi there! 👋 How can I help you today?", quickReplies:["Get started","Learn more","Contact us","Pricing"] },
      };
    }

    // Load history or show greeting
    const saved = loadHistory();
    if (saved.length) {
      history = saved;
      saved.forEach(m => renderBub(m.role, m.content));
      quickGone = true;
    } else {
      addMsg("assistant", CONFIG.bot.greeting);
      renderQuick();
    }

    win.querySelector("#rb-inp").addEventListener("input", e => {
      win.querySelector("#rb-send-btn").disabled = !e.target.value.trim() || loading;
      autoResize(e.target);
    });
    win.querySelector("#rb-inp").addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); rbSend(); }
    });
    win.querySelector("#rb-send-btn").addEventListener("click", rbSend);

    if (START_OPEN) rbToggle();
  }

  // ── Toggle ──────────────────────────────────────────────────
  function rbToggle() {
    isOpen = !isOpen;
    win.classList.toggle("open", isOpen);
    const badge = document.getElementById("rb-badge");
    if (isOpen && badge) badge.remove();
    toggle.querySelector("#rb-toggle-icon").textContent = isOpen ? "✕" : (CONFIG?.brand?.avatar || "💬");
    if (isOpen) setTimeout(() => win.querySelector("#rb-inp").focus(), 300);
  }

  // ── Messages ─────────────────────────────────────────────────
  function addMsg(role, text) {
    history.push({ role, content: text });
    saveHistory(history);
    renderBub(role, text);
  }

  function renderBub(role, text) {
    const msgs = win.querySelector("#rb-msgs");
    const row  = document.createElement("div");
    row.className = "rb-row" + (role === "user" ? " u" : "");
    const av  = document.createElement("div");
    av.className  = "rb-av " + (role === "user" ? "u" : "b");
    av.textContent = role === "user" ? "👤" : (CONFIG?.brand?.avatar || "🤖");
    const bub = document.createElement("div");
    bub.className = "rb-bub " + (role === "user" ? "u" : "b");
    bub.innerHTML = fmt(text);
    row.appendChild(role === "user" ? bub : av);
    row.appendChild(role === "user" ? av  : bub);
    msgs.appendChild(row);
    requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
  }

  function fmt(t) {
    return t.replace(/</g,"&lt;")
      .replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
      .replace(/\*(.*?)\*/g,"<em>$1</em>")
      .replace(/`([^`]+)`/g,"<code style='background:rgba(14,165,233,.1);padding:1px 4px;border-radius:3px;font-size:12px'>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--rb-pd,#0284C7)">$1</a>')
      .replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--rb-pd,#0284C7)">$1</a>')
      .replace(/\n/g,"<br>");
  }

  // ── Typing indicator ─────────────────────────────────────────
  function showTyp() {
    const msgs = win.querySelector("#rb-msgs");
    const row  = document.createElement("div"); row.className = "rb-row"; row.id = "rb-typ";
    const av   = document.createElement("div"); av.className = "rb-av b"; av.textContent = CONFIG?.brand?.avatar || "🤖";
    const t    = document.createElement("div"); t.className = "rb-typing";
    t.innerHTML = '<div class="rb-td"></div><div class="rb-td"></div><div class="rb-td"></div>';
    row.appendChild(av); row.appendChild(t); msgs.appendChild(row);
    requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
  }
  function hideTyp() { const t = win.querySelector("#rb-typ"); if (t) t.remove(); }

  // ── Quick replies ────────────────────────────────────────────
  function renderQuick() {
    const a = win.querySelector("#rb-quick"); a.innerHTML = "";
    if (quickGone || !CONFIG?.bot?.quickReplies?.length) return;
    CONFIG.bot.quickReplies.forEach(q => {
      const b = document.createElement("button"); b.className = "rb-qr"; b.textContent = q;
      b.addEventListener("click", () => { quickGone = true; a.innerHTML = ""; sendText(q); });
      a.appendChild(b);
    });
  }

  // ── Input ────────────────────────────────────────────────────
  function autoResize(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 80) + "px"; }

  function rbSend() {
    const inp  = win.querySelector("#rb-inp");
    const text = inp.value.trim();
    if (!text || loading) return;
    inp.value = ""; inp.style.height = "auto";
    win.querySelector("#rb-send-btn").disabled = true;
    quickGone = true; win.querySelector("#rb-quick").innerHTML = "";
    sendText(text);
  }

  // ── API ──────────────────────────────────────────────────────
  async function sendText(text) {
    addMsg("user", text);
    maybeCaptureLeadFromMsg(text);
    loading = true; showTyp();
    try {
      const res = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history, sessionId, clientKey: CLIENT_KEY }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      hideTyp(); addMsg("assistant", data.reply || "I'm having a moment — please try again!");
    } catch {
      hideTyp();
      const row = document.createElement("div"); row.className = "rb-row";
      const av  = document.createElement("div"); av.className = "rb-av b"; av.textContent = CONFIG?.brand?.avatar || "🤖";
      const bub = document.createElement("div"); bub.className = "rb-bub b";
      bub.style.cssText = "background:#fff5f5;border-color:rgba(255,80,80,.2);color:#c0392b";
      bub.textContent = "Oops! Something went wrong. Please try again. 😊";
      row.appendChild(av); row.appendChild(bub);
      win.querySelector("#rb-msgs").appendChild(row);
    } finally {
      loading = false;
      win.querySelector("#rb-send-btn").disabled = false;
      win.querySelector("#rb-inp").focus();
    }
  }

  function maybeCaptureLeadFromMsg(text) {
    const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const phoneRe = /[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,}/;
    if (emailRe.test(text) || phoneRe.test(text)) {
      fetch(`${BASE_URL}/api/capture-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history, sessionId, clientKey: CLIENT_KEY }),
      }).catch(() => {});
    }
  }

  // ── Boot ─────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
