(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const source = $("sourceInput"), output = $("output"), notice = $("notice");
  const MAX_CHARS = 1_000_000;

  function tell(message, good=false) {
    notice.textContent = message;
    notice.className = "notice show" + (good ? " good" : "");
  }
  function stats() {
    const value = source.value;
    $("inputStats").textContent = `${value.length.toLocaleString()} characters · ${(value ? value.split(/\r\n|\r|\n/).length : 0).toLocaleString()} lines`;
  }
  function decodeEscapes(text) {
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
      const chars = [...decoded];
      const printable = chars.filter(c => c >= " " || "\n\r\t".includes(c)).length / Math.max(chars.length,1);
      return printable > .88 ? decoded : null;
    } catch { return null; }
  }
  function decodeHexRuns(text) {
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
    return text.replace(/(["'])([A-Za-z0-9+/]{12,}={0,2})\1/g, (whole, q, candidate) => {
      const decoded = maybeBase64(candidate);
      return decoded !== null ? q + decoded.replaceAll(q, "\\"+q) + q : whole;
    });
  }
  function foldNumericExpressions(text) {
    let current = text;
    const number = String.raw`-?(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+))`;
    const op = String.raw`([+\-*\/%])`;
    const calculate = (a, operator, b) => {
      const x = /^-?0x/i.test(a) ? (a.startsWith("-") ? -parseInt(a.slice(3),16) : parseInt(a,16)) : Number(a);
      const y = /^-?0x/i.test(b) ? (b.startsWith("-") ? -parseInt(b.slice(3),16) : parseInt(b,16)) : Number(b);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      let v;
      switch(operator) {
        case "+": v=x+y; break; case "-": v=x-y; break; case "*": v=x*y; break;
        case "/": if (y===0) return null; v=x/y; break;
        case "%": if (y===0) return null; v=x%y; break;
        default: return null;
      }
      if (!Number.isFinite(v) || Math.abs(v)>Number.MAX_SAFE_INTEGER) return null;
      return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12)));
    };
    for (let pass=0; pass<8; pass++) {
      let changed=false;
      current=current.replace(new RegExp(String.raw`\(\s*(${number})\s*${op}\s*(${number})\s*\)`,"g"), (whole,a,operator,b) => {
        const result=calculate(a,operator,b);
        if (result===null) return whole;
        changed=true; return result;
      });
      current=current.replace(new RegExp(String.raw`(?<![\w.$])(${number})\s*${op}\s*(${number})(?![\w.])`,"g"), (whole,a,operator,b) => {
        const result=calculate(a,operator,b);
        if (result===null) return whole;
        changed=true; return result;
      });
      if (!changed) break;
    }
    return current;
  }
  function tidy(text) {
    return text.replace(/\r\n?/g,"\n").split("\n").map(line => line.replace(/[ \t]+$/g,"")).join("\n").trim() + "\n";
  }
  function decode() {
    let text = source.value;
    if (!text.trim()) { tell("Paste source code or load a supported public URL first."); source.focus(); return; }
    if (text.length > MAX_CHARS) { tell("Source exceeds the 1 MB safety limit. Split it into smaller sections."); return; }
    const original = text;
    const steps = [];
    let next = decodeEscapes(text); if (next !== text) steps.push("literal escapes"); text = next;
    next = decodeHexRuns(text); if (next !== text) steps.push("quoted hex bytes"); text = next;
    next = decodeBase64Candidates(text); if (next !== text) steps.push("likely Base64 strings"); text = next;
    next = foldNumericExpressions(text); if (next !== text) steps.push("constant arithmetic"); text = next;
    text = tidy(text);
    output.value = text;
    $("outputStats").textContent = `${text.length.toLocaleString()} characters · ${text.split("\n").length} lines · ${steps.length} transform(s)`;
    $("resultBadge").textContent = steps.length ? `${steps.length} TRANSFORM(S) APPLIED` : "NO COMMON ENCODING FOUND";
    $("copyBtn").disabled = false; $("downloadBtn").disabled = false;
    $("findings").replaceChildren();
    const rows = [
      ["01","Escape sequences",steps.includes("literal escapes") ? "Decoded common escaped characters." : "No recognized escape sequences changed."],
      ["02","Encoded string candidates",steps.some(s=>s==="quoted hex bytes" || s==="likely Base64 strings") ? "Some high-confidence quoted string candidates were decoded." : "No high-confidence quoted hex or Base64 strings changed."],
      ["03","Static arithmetic",steps.includes("constant arithmetic") ? "Folded literal-only arithmetic expressions." : "No simple constant arithmetic was changed."]
    ];
    for (const [n,title,desc] of rows) {
      const div=document.createElement("div"); div.className="finding";
      const b=document.createElement("b"); b.textContent=n;
      const span=document.createElement("span"); const strong=document.createElement("strong"); strong.textContent=title;
      const small=document.createElement("small"); small.textContent=desc;
      span.append(strong,small); div.append(b,span); $("findings").append(div);
    }
    const vmLike = /\b(loadstring|load)\s*\(|\bwhile\s+true\s+do\b|\bgetfenv\s*\(|\bstring\.char\s*\(/i.test(original);
    const base = steps.length ? `Finished. Applied ${steps.length} conservative transform(s): ${steps.join(", ")}.` : "Finished. No common encoded string patterns were confidently recognized.";
    tell(base + (vmLike ? " VM/loader-like patterns detected: this site does not execute scripts or fully devirtualize custom Lua VMs." : " This is heuristic static decoding, not a universal deobfuscator."), true);
  }
  async function loadUrl() {
    const value = $("sourceUrl").value.trim();
    if (!value) { tell("Enter a public GitHub raw-file or Gist URL."); return; }
    let parsed;
    try { parsed = new URL(value); } catch { tell("That URL does not look valid."); return; }
    if (parsed.protocol !== "https:") { tell("Only HTTPS URLs are accepted."); return; }
    $("loadUrl").disabled = true; $("loadUrl").textContent = "FETCHING…";
    try {
      const res = await fetch("/api/fetch?url="+encodeURIComponent(parsed.href), {headers:{"Accept":"application/json"}});
      const body = await res.text();
      let data; try { data = body ? JSON.parse(body) : null; } catch { data = null; }
      if (!data || typeof data !== "object") {
        if (res.status === 404) throw new Error("Cloudflare could not find /api/fetch. Ensure functions/api/fetch.js is in the repository root and redeploy via Cloudflare Pages.");
        throw new Error(`The server returned an empty or non-JSON response (HTTP ${res.status}). Check Cloudflare Pages Functions logs.`);
      }
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      if (typeof data.source !== "string") throw new Error(data.error || "Unexpected response from source endpoint.");
      source.value = data.source; stats(); tell(`Loaded ${data.source.length.toLocaleString()} characters. Nothing was executed.`, true); source.focus();
    } catch (err) {
      tell(`${err.message || "Could not load that URL."} Try a raw.githubusercontent.com URL, or paste source manually.`);
    } finally {
      $("loadUrl").disabled = false; $("loadUrl").innerHTML = 'FETCH SOURCE <span>↗</span>';
    }
  }
  source.addEventListener("input", stats);
  $("decodeBtn").addEventListener("click", decode);
  $("loadUrl").addEventListener("click", loadUrl);
  $("clearBtn").addEventListener("click", () => {
    source.value=""; output.value=""; stats(); $("outputStats").textContent="No output yet";
    $("resultBadge").textContent="WAITING FOR SOURCE"; $("copyBtn").disabled=true; $("downloadBtn").disabled=true; notice.className="notice"; source.focus();
  });
  $("copyBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(output.value); tell("Output copied to clipboard.",true); }
    catch { output.focus(); output.select(); tell("Clipboard permission unavailable. Output selected—copy manually."); }
  });
  $("downloadBtn").addEventListener("click", () => {
    const blob=new Blob([output.value],{type:"text/plain;charset=utf-8"}); const a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download="axomjb-decoded.txt"; a.click(); URL.revokeObjectURL(a.href);
  });
  stats();
})();