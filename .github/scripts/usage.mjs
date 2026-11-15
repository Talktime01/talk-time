// Reads event counts from GoatCounter and writes usage/usage.json.
// Events sent by the app look like "<who>-open", "<who>-topic-<id>", "<who>-finish-<id>", "<who>-like-<id>-<slug>".
import { writeFileSync, mkdirSync } from "node:fs";

const token = process.env.GOATCOUNTER_TOKEN;
const site = process.env.GOATCOUNTER_SITE || "talktime-dad";
const DAYS = 28;

export function summarise(hits, now = new Date()) {
  const dayKey = d => d.toISOString().slice(0, 10);
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) days.push(dayKey(new Date(now.getTime() - i * 86400000)));
  const last7 = new Set(days.slice(-7));
  const blank = () => ({ opens: 0, daysOpened: 0, topics: {}, finished: {}, liked: [] });
  const out = { last7: blank(), last28: blank() };
  const opensByDay = Object.fromEntries(days.map(d => [d, 0]));
  const users = new Set();

  for (const h of hits || []) {
    const path = String(h.path || "").replace(/^\//, "");
    const m = path.match(/^([a-z0-9]{1,12})-(open|topic|finish|like)(?:-(.*))?$/);
    if (!m) continue;
    const [, who, kind, rest] = m;
    users.add(who);
    const perDay = {};
    for (const s of h.stats || []) {
      const n = typeof s.daily === "number" ? s.daily : (s.hourly || []).reduce((a, b) => a + b, 0);
      if (s.day) perDay[String(s.day).slice(0, 10)] = n;
    }
    const total = (set) => Object.entries(perDay).reduce((a, [d, n]) => a + (set.has(d) ? n : 0), 0);
    const all = new Set(days);
    for (const [key, set] of [["last7", last7], ["last28", all]]) {
      const n = total(set);
      if (!n) continue;
      const o = out[key];
      if (kind === "open") o.opens += n;
      if (kind === "topic") o.topics[rest] = (o.topics[rest] || 0) + n;
      if (kind === "finish") o.finished[rest] = (o.finished[rest] || 0) + n;
      if (kind === "like") o.liked.push({ question: h.title || rest, count: n });
    }
    if (kind === "open") for (const d of days) opensByDay[d] += perDay[d] || 0;
  }
  out.last7.daysOpened = days.slice(-7).filter(d => opensByDay[d] > 0).length;
  out.last28.daysOpened = days.filter(d => opensByDay[d] > 0).length;
  for (const k of ["last7", "last28"]) out[k].liked.sort((a, b) => b.count - a.count);
  return {
    status: "ok",
    updated: now.toISOString(),
    note: "Counts of app events from GoatCounter. Days follow GoatCounter's own day boundaries. No personal data.",
    users: [...users].sort(),
    ...out,
    opensByDay,
  };
}

async function main() {
  if (!token) {
    console.log("GOATCOUNTER_TOKEN is not set yet; nothing written.");
    return;
  }
  const end = new Date(); end.setUTCMinutes(0, 0, 0); end.setUTCHours(end.getUTCHours() + 1);
  const start = new Date(end.getTime() - DAYS * 86400000);
  const url = `https://${site}.goatcounter.com/api/v0/stats/hits?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&daily=true&limit=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  if (!res.ok) {
    console.error(`GoatCounter answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const body = await res.json();
  const summary = summarise(body.hits, new Date());
  summary.moreEventsNotShown = Boolean(body.more);
  mkdirSync("usage", { recursive: true });
  writeFileSync("usage/usage.json", JSON.stringify(summary, null, 2) + "\n");
  console.log(`Wrote usage/usage.json: ${summary.last7.opens} opens on ${summary.last7.daysOpened} of the last 7 days.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
