// Zero-dependency assertions for the outbound WhatsApp config validators.
// Run:  node scripts/verify-delivery-config.mjs
// Mirrors the pure logic of lib/server/deliveryConfig.ts (keep in sync). Proves the
// Arabic-secret ByteString crash is detected BEFORE fetch, and Bearer is de-duped.

const hasNonAscii = (v) => { for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) > 0x7e) return true; return false; };
const isAsciiHeaderSafe = (v) => { if (!v.length) return false; for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c < 0x20 || c > 0x7e) return false; } return true; };
const PLACEHOLDER_RES = [/^<.*>$/, /your[_-]?(secret|token|key)/i, /change[_-]?me/i, /^x{4,}$/i, /placeholder/i, /example\.com/i, /^\.\.\.+$/, /(ضع|هنا|السر|سر|القيمة)/];
const looksPlaceholder = (v) => PLACEHOLDER_RES.some((re) => re.test(v.trim()));
const headerReason = (raw) => { const v = (raw ?? "").trim(); if (!v) return "missing"; if (hasNonAscii(v)) return "non_ascii_header"; if (!isAsciiHeaderSafe(v)) return "control_chars"; if (looksPlaceholder(v)) return "placeholder"; return null; };
const urlReason = (raw) => { const v = (raw ?? "").trim(); if (!v) return "missing"; if (hasNonAscii(v)) return "non_ascii_header"; let u; try { u = new URL(v); } catch { return "not_http_url"; } if (u.protocol !== "http:" && u.protocol !== "https:") return "not_http_url"; if (looksPlaceholder(v)) return "placeholder"; return null; };
const phoneIdReason = (raw) => { const v = (raw ?? "").trim(); if (!v) return "missing"; if (!/^\d{5,20}$/.test(v)) return "not_numeric"; return null; };
const tokenCore = (raw) => (raw ?? "").trim().replace(/^bearer\s+/i, "");
const bearerAuth = (raw) => `Bearer ${tokenCore(raw)}`;
const safeFetchError = (e, env) => { const msg = String(e?.message ?? e); if (/ByteString|character at index|code unit|Headers\b/i.test(msg)) return env ? `invalid_config:${env}:non_ascii_header` : `invalid_config:header:non_ascii_header`; return msg.slice(0, 300); };

let pass = 0, fail = 0;
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); (ok ? pass++ : fail++); console.log(`${ok ? "✓" : "✗"} ${label}  =>  ${JSON.stringify(got)}${ok ? "" : `  (expected ${JSON.stringify(want)})`}`); };

// 1) Arabic secret is detected and would NOT reach fetch headers.
eq('Arabic secret "نفس السر" detected', headerReason("نفس السر"), "non_ascii_header");
eq('Arabic single char "ن" detected', headerReason("ن"), "non_ascii_header");
// 2) ASCII secret passes.
eq("ASCII secret passes", headerReason("KIAN_SEND_SECRET_2026_7x9mQ2pL"), null);
// 3) Bearer normalization (with and without prefix), no "Bearer Bearer".
eq("token WITH Bearer prefix", bearerAuth("Bearer EAAB_abc123"), "Bearer EAAB_abc123");
eq("token WITHOUT Bearer prefix", bearerAuth("EAAB_abc123"), "Bearer EAAB_abc123");
eq("token core strips Bearer", tokenCore("bearer  EAAB_abc"), "EAAB_abc");
eq("Arabic token core detected", headerReason(tokenCore("Bearer نفس")), "non_ascii_header");
// 4) URL validation.
eq("valid n8n prod url", urlReason("https://kian.app.n8n.cloud/webhook/abc-123"), null);
eq("webhook-test relative is not a url", urlReason("webhook-test/abc"), "not_http_url");
eq("Arabic url detected", urlReason("ضع الرابط هنا"), "non_ascii_header");
// 5) Phone-number-id.
eq("numeric phone id passes", phoneIdReason("123456789012345"), null);
eq("non-numeric phone id rejected", phoneIdReason("phone_id"), "not_numeric");
// 6) The exact runtime crash message is sanitized — generic ByteString text never surfaces.
const raw = "Cannot convert argument to a ByteString because the character at index 0 has a value of 1606 which is greater than 255.";
const safe = safeFetchError(new Error(raw), "N8N_WHATSAPP_SEND_SECRET");
eq("ByteString error sanitized", safe, "invalid_config:N8N_WHATSAPP_SEND_SECRET:non_ascii_header");
console.log(/ByteString/i.test(safe) ? "✗ raw ByteString leaked!" : "✓ no raw ByteString text in output");
(/ByteString/i.test(safe) ? fail++ : pass++);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
