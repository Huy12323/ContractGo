#!/usr/bin/env node
/**
 * A scratch host page for the embedded-signing browser pass.
 *
 * WHY THIS EXISTS AS A FILE RATHER THAN AS A PARAGRAPH IN THE PLAN. The one
 * thing `postMessage` cannot be verified without is a genuinely DIFFERENT
 * ORIGIN. Opening an HTML file from disk gives `origin: "null"`, and serving it
 * from vite's own port gives the same origin as the app — both would make the
 * bridge appear to work while proving nothing about the check that matters.
 * This serves the page from a port you choose, so the same fixture can be run
 * from a REGISTERED origin (expect events) and from an UNREGISTERED one (expect
 * silence), which is the actual assertion.
 *
 * Zero dependencies, on purpose: a verification fixture that needs an install
 * step is a verification fixture that gets skipped.
 *
 *   node scripts/embed-host.cjs 5199
 *   → open http://localhost:5199 and paste the embed URL
 *
 * Register `http://localhost:5199` on the API key first (Settings →
 * Integrations → API keys), then mint the URL with `api_envelopes_embed-url`
 * passing `"origin": "http://localhost:5199"`.
 *
 * Then run it again on a port you did NOT register — `node scripts/embed-host.cjs
 * 5198` — and confirm the event log stays EMPTY while the ceremony still works
 * inside the frame. Silence is the pass condition there, so an empty log is the
 * result rather than a failure to observe one.
 */

const http = require("node:http");

const port = Number(process.argv[2] ?? 5199);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Not a port: ${process.argv[2]}`);
    process.exit(1);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>ContractGo embed host — :${port}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; display: flex; height: 100vh; }
  #left { flex: 1 1 60%; display: flex; flex-direction: column; padding: 12px; gap: 8px; }
  #right { flex: 1 1 40%; border-left: 1px solid #ddd; padding: 12px; overflow: auto; background: #fafafa; }
  input { width: 100%; padding: 8px; font-family: ui-monospace, monospace; }
  iframe { flex: 1; width: 100%; border: 1px solid #ddd; }
  .ev { border-bottom: 1px solid #eee; padding: 6px 0; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; }
  .rejected { color: #a00; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #666; margin: 0 0 8px; }
  code { background: #eee; padding: 1px 4px; }
</style>
</head>
<body>
<div id="left">
  <div>
    Host origin: <code id="origin"></code> — this must be registered on the API key
    <strong>and</strong> passed as <code>origin</code> when minting the URL.
  </div>
  <input id="url" placeholder="Paste the embed URL (https://.../embed/sign/...) and press Enter" />
  <iframe id="frame" allow="camera"></iframe>
</div>
<div id="right">
  <h2>postMessage log</h2>
  <div id="log"><em>Nothing yet.</em></div>
</div>
<script>
  document.getElementById("origin").textContent = window.location.origin;

  const log = document.getElementById("log");
  let count = 0;

  function append(text, cls) {
    if (count === 0) log.innerHTML = "";
    count += 1;
    const el = document.createElement("div");
    el.className = "ev" + (cls ? " " + cls : "");
    el.textContent = new Date().toISOString().slice(11, 23) + "  " + text;
    log.prepend(el);
  }

  document.getElementById("url").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const value = e.target.value.trim();
    if (!value) return;
    append("→ framing " + value);
    document.getElementById("frame").src = value;
  });

  window.addEventListener("message", (event) => {
    const data = event.data;

    // The check every host page must make, reproduced here rather than skipped
    // for brevity: any page can post into any window it holds a handle to.
    if (!data || data.source !== "contractgo" || data.version !== 1) {
      append("ignored a message from " + event.origin + " (not a ContractGo v1 envelope)", "rejected");
      return;
    }

    append(event.origin + "  " + JSON.stringify(data, null, 2));
  });
</script>
</body>
</html>`;

http.createServer((_req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(PAGE);
}).listen(port, () => {
    console.log(`Embed host page on http://localhost:${port}`);
    console.log(`Register that exact origin on the API key, then mint an embed URL for it.`);
});
