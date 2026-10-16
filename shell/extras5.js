// ============================================================
// extras5 — AI keys (Settings) + a small shared helper TriAI Dev and
// other apps use to call z.ai / ChatGPT / Gemini / Groq through the
// kernel (keys never leave this machine, never go in the repo).
// ============================================================
"use strict";

(() => {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const save = () => { try { kernel.setConfig(CFG); } catch {} };
  const sections = window.EX.extraSections = window.EX.extraSections || {};
  const addSection = (name, fn) => { if (!EX.sectionNames.includes(name)) EX.sectionNames.push(name); sections[name] = fn; };

  const PROVIDERS = [
    ["zai", "z.ai (GLM)", ""],
    ["openai", "ChatGPT (OpenAI)", ""],
    ["gemini", "Gemini (Google)", ""],
    ["groq", "Groq", ""],
  ];

  addSection("AI keys", (main, again, H) => {
    CFG.aiKeys = CFG.aiKeys || {};
    main.innerHTML = H("Used by TriAI Dev to ask several AIs the same question. Keys are typed in here, kept only on your TriFS drive, and never uploaded anywhere by TrimangeesOS.") +
      PROVIDERS.map(([id, name, note]) => `<div class="ex-row"><div class="ex-l"><b>${name}</b>${note ? `<span>${esc(note)}</span>` : ""}</div>
         <div class="ex-r"><input type="password" class="ak-in" data-id="${id}" value="${esc(CFG.aiKeys[id] || "")}" placeholder="API key" style="width:220px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:7px 10px;color:var(--text)">
         <button class="set-btn ak-eye" data-for="${id}">\u{1F441}</button></div></div>`).join("");
    main.querySelectorAll(".ak-in").forEach((el) => el.onchange = () => { CFG.aiKeys[el.dataset.id] = el.value.trim(); save(); });
    main.querySelectorAll(".ak-eye").forEach((b) => b.onclick = () => { const i = main.querySelector(`.ak-in[data-id="${b.dataset.for}"]`); i.type = i.type === "password" ? "text" : "password"; });
  });

  // Shared helper: EX.aiAsk(provider, messages, model?) -> {ok, text, error}
  EX.aiAsk = (provider, messages, model) => {
    const key = (CFG.aiKeys || {})[provider] || "";
    return kernel.aiCall(provider, key, model, messages);
  };
})();
