(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const source = $("sourceInput"), output = $("output"), notice = $("notice");
  const safeMax = 1_000_000;

  function tell(message, good=false) {
    notice.textContent = message;
    notice.className = "notice show" + (good ? " good" : "");
  }
  function stats() {
    const value = source.value;
    $("inputStats").textContent = `${value.length.toLocaleString()} characters · ${(value ? value.split(/\r\n|\r|\n/).length : 0).toLocaleString()} lines`;
  }
  function decodeEscapes(text) {
    // Deliberately static: only replace literal escape sequences, never evaluate code.
    return text.replace(/\\x([0-9a-fA-F]{2})|\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\([0-7]{1,3})|\\(n|r|t|b|f|v|\\|"|')/g, (all, hex, braced, uni, oct, simple) => {
      try {
        if (hex) return String.fromCharCode(parseInt(hex, 16));
        if (braced) { const cp = parseInt(braced,16); return cp <= 0x10ffff ? String.fromCodePoint(cp) : all; }
        if (uni) return String.fromCharCode(parseInt(uni,16));
        if (oct) return String.fromCharCode(parseInt(oct,8));
        const map = {n:"\n",r:"\r",t:"\t",b:"\b",f:"\f",v:"\v","\\":"\\",'"':"'",'"':'"'};
        return Object.prototype.hasOwnProperty.call(map,simple) ? map[simple] : all;
      } catch { return all; }
    });
  }
  function maybeBase64(s) {
    const cleaned = s.replace(/\s+/g, "");
    if (cleaned.length < 12 || cleaned.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
    try {
      const binary = atob(cleaned);
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      const decoded = new TextDecoder("utf-8", {fatal:true}).decode(bytes);
      if (!decoded || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(decoded)) return null;
      const printable = [...decoded].filter(c => c >= " " || "\n\r\t".includes(c)).length / Math.max([...decoded].length,1);
      return printable > .88 ? decoded : null;
    } catch { return null; }
  }
  function decodeHexRuns(text) {
    // Decode obvious quoted hex byte strings only; avoid broad numeric substitutions.
    return text.replace(/(["'])(?:(?:\\?x)?[0-9a-fA-F]{2}){4,}\1/g, (whole, quote) => {
      let body = whole.slice(1,-1).replace(/\\x/gi,"").replace(/0x/gi,"");
      if (!/^(?:[0-9a-fA-F]{2})+$/.test(body)) return whole;
      try {
        let out = "";
        for (let i=0;i<body.length;i+=2) out += String.fromCharCode(parseInt(body.slice(i,i+2),16));
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(out)) return whole;
        return quote + out + quote;
      } catch { return whole; }
    });
  }
  function decodeBase64Candidates(text) {
    // Only replace quoted strings that confidently decode as printable UTF-8.
    return text.replace(/(["'])([A-Za-z0-9+/]{12,}={0,2})\1/g, (whole, q, candidate) => {
      const decoded = maybeBase64(candidate);
      return decoded !== null ? q + decoded.replaceAll(q, "\\"+q) + q : whole;
    });
  }
  function tidy(text) {
    // Avoid aggressive formatting: preserve source semantics and only normalize line endings/trailing spaces.
    return text.replace(/\r\n?/g,"\n").split("\n").map(line => line.replace(/[ \t]+$/g,"")).join("\n").trim() + "\n";
  }
  function decode() {
    let text = source.value;
    if (!text.trim()) { tell("Paste source code or load a supported public URL first."); source.focus(); return; }
    if (text.length > safeMax) { tell("Source exceeds the 1 MB safety limit. Split it into smaller sections."); return; }
    const before = text;
    const steps = [];
    text = decodeEscapes(text); if (text !== before) steps.push("literal escapes");
    const hex = decodeHexRuns(text); if (hex !== text) steps.push("quoted hex bytes"); text = hex;
    const b64 = decodeBase64Candidates(text); if (b64 !== text) steps.push("likely Base64 strings"); text = b64;
    text = tidy(text);
    output.value = text;
    $("outputStats").textContent = `${text.length.toLocaleString()} characters · ${text.split("\n").length} lines · ${steps.length} transform(s)`;
    $("resultBadge").textContent = steps.length ? `${steps.length} TRANSFORM(S) APPLIED` : "NO COMMON ENCODING FOUND";
    $("copyBtn").disabled = false; $("downloadBtn").disabled = false;
    $("findings").innerHTML = "";
    const rows = [
      ["01","Escape sequences",steps.includes("literal escapes") ? "Decoded common hex, Unicode, decimal/octal, and control escapes." : "No recognized literal escape sequences changed."],
      ["02","Encoded string candidates",steps.filter(s=>s!=="literal escapes").length ? `Processed: ${steps.filter(s=>s!=="literal escapes").join(", ")}.` : "No high-confidence quoted hex or Base64 strings changed."],
      ["03","Execution safety","Nothing was executed. This is heuristic text transformation, not a universal deobfuscator."]
    ];
    for (const [n,title,desc] of rows) {
      const div=document.createElement("div"); div.className="finding";
      const b=document.createElement("b"); b.textContent=n;
      const span=document.createElement("span"); const strong=document.createElement("strong"); strong.textContent=title;
      const small=document.createElement("small"); small.textContent=desc;
      span.append(strong,small); div.append(b,span); $("findings").append(div);
    }
    tell(steps.length ? `Finished. Applied ${steps.length} conservative transform(s): ${steps.join(", ")}. Review the output; heuristic decoding can alter string contents.` : "Finished. No common encoded string patterns were confidently recognized. Complex or custom obfuscation needs a dedicated parser.", true);
  }
  async function loadUrl() {
    const value = $("sourceUrl").value.trim();
    if (!value) { tell("Enter a public GitHub raw-file or Gist URL."); return; }
    let parsed;
    try { parsed = new URL(value); } catch { tell("That URL does not look valid."); return; }
    if (parsed.protocol !== "https:") { tell("Only HTTPS URLs are accepted."); return; }
    $("loadUrl").disabled = true; $("loadUrl").textContent = "FETCHING…";
    try {
      const res = await fetch("/api/fetch?url="+encodeURIComponent(parsed.href), {headers:{"Accept":"text/plain"}});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      if (typeof data.source !== "string") throw new Error("The source endpoint returned an unexpected response.");
      source.value = data.source; stats();
      tell(`Loaded ${data.source.length.toLocaleString()} characters from the public source. Nothing has been executed.`, true);
      source.focus();
    } catch (err) {
      tell(`${err.message || "Could not load that URL."} Try a raw.githubusercontent.com URL, or paste the source manually.`);
    } finally {
      $("loadUrl").disabled = false; $("loadUrl").innerHTML = 'FETCH SOURCE <span>↗</span>';
    }
  }
  source.addEventListener("input", stats);
  $("decodeBtn").addEventListener("click", decode);
  $("loadUrl").addEventListener("click", loadUrl);
  $("clearBtn").addEventListener("click", () => { source.value=""; output.value=""; stats(); $("outputStats").textContent="No output yet"; $("resultBadge").textContent="WAITING FOR SOURCE"; $("copyBtn").disabled=true; $("downloadBtn").disabled=true; notice.className="notice"; source.focus(); });
  $("copyBtn").addEventListener("click", async () => { try { await navigator.clipboard.writeText(output.value); tell("Output copied to clipboard.",true); } catch { output.focus(); output.select(); tell("Clipboard permission was unavailable. Output selected—copy it manually."); } });
  $("downloadBtn").addEventListener("click", () => { const blob=new Blob([output.value],{type:"text/plain;charset=utf-8"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="axomjb-decoded.txt"; a.click(); URL.revokeObjectURL(a.href); });
  stats();
})();
