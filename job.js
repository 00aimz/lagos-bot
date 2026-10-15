const fs = require('fs');

const API = "https://lagoslife.app/api";
const TO = process.env.TO;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const FEE = 50, MIN = 100, SEED = 10095950;
const TEMPLATE = { u: "IDK6543210", p: "@Temi123" };
const TARGET_HOURS = parseFloat(process.env.DURATION_HOURS || "0");
const CONCURRENT_LIMIT = 20;

const storeDir = './store';
if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir);

function secureShuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

let ledger = [];
try {
  const files = fs.readdirSync(storeDir).filter(f => f.startsWith('accs'));
  for (const file of files) {
    const rawData = fs.readFileSync(`${storeDir}/${file}`, 'utf8');
    if (rawData.trim()) ledger.push(...JSON.parse(rawData));
  }
} catch (e) {
  console.log("[INIT] Error:", e.message);
}

if (!ledger.length) return console.log("[ERROR] No accounts!");

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(url, options = {}, cookieJar = '') {
  options.headers = options.headers || {};
  if (cookieJar) options.headers['cookie'] = cookieJar;

  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(4000) }).catch(e => ({ ok: false, statusText: e.message }));
  if (!res.ok && !res.headers) return { res: { ok: false, text: async () => res.statusText }, newCookies: cookieJar };

  const setCookie = res.headers.get('set-cookie');
  let newCookies = cookieJar;
  if (setCookie) {
    const c = setCookie.split(',')[0].split(';')[0];
    newCookies = cookieJar ? `${cookieJar};${c}` : c;
  }
  return { res, newCookies };
}

async function sendDiscordAlert(message) {
  if (!DISCORD_WEBHOOK_URL) return;
  fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: message })
  }).catch(() => {});
}

(async () => {
  secureShuffle(ledger);

  const loginRes = await request(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: TEMPLATE.u, password: TEMPLATE.p })
  });

  if (!loginRes.res.ok) return console.log("[ERROR] Template login failed");

  const getSaveReq = await request(`${API}/save`, {}, loginRes.newCookies);
  const saveJson = getSaveReq.res.ok ? await getSaveReq.res.json() : null;
  let clean = saveJson?.game;
  if (!clean) return console.log("[ERROR] Template account has no game state");

  delete clean.owner;
  console.log("[READY] Fast drain engine online.\n");

  const sessionStart = Date.now();
  let sessionTotalSent = 0, globalCycles = 0;

  while (true) {
    if (TARGET_HOURS > 0 && (Date.now() - sessionStart) >= TARGET_HOURS * 3600000) break;

    globalCycles++;
    let currentIndex = 0, cycleTotal = 0;

    async function worker() {
      while (currentIndex < ledger.length) {
        const a = ledger[currentIndex++];
        if (!a) break;

        try {
          const lr = await request(`${API}/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username: a.u, password: a.p })
          });
          if (!lr.res.ok) continue;

          let accCookie = lr.newCookies;
          const svReq = await request(`${API}/save`, {}, accCookie);
          let sv = svReq.res.ok ? await svReq.res.json() : null;

          if (!sv?.game) {
            const meReq = await request(`${API}/auth/me`, {}, accCookie);
            const me = meReq.res.ok ? await meReq.res.json().catch(() => null) : null;
            if (!me?.user?.id) continue;

            const g = { ...clean, sim: { ...clean.sim, name: a.u }, owner: me.user.id, money: SEED };
            const br = await request(`${API}/save`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ game: g, owner: me.user.id, fresh: true, replace: 0 })
            }, accCookie);

            if (br.res.ok) {
              const svRetry = await request(`${API}/save`, {}, accCookie);
              sv = svRetry.res.ok ? await svRetry.res.json() : null;
            } else continue;
          }

          if (!sv?.game) continue;

          if (Number(sv.game.money) < MIN + FEE) {
            const g = { ...sv.game, money: SEED };
            const rr = await request(`${API}/save`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ game: g, base: sv.updatedAt ?? sv.now })
            }, accCookie);

            if (rr.res.ok) {
              const svRetry = await request(`${API}/save`, {}, accCookie);
              sv = svRetry.res.ok ? await svRetry.res.json() : null;
            } else continue;
          }

          let amount = Math.floor(Number(sv.game.money ?? 0)) - FEE;
          if (amount < MIN) continue;

          for (let tries = 0; tries < 2; tries++) {
            const sr = await request(`${API}/send`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ to: TO, amount })
            }, accCookie);

            if (sr.res.ok) {
              cycleTotal += amount;
              sessionTotalSent += amount;
              console.log(`[C${globalCycles}] ${a.u} -> ₦${amount.toLocaleString()} \vert{} Total: ₦${sessionTotalSent.toLocaleString()}`);
              break;
            }
          }
        } catch (e) {}
      }
    }

    await Promise.all(Array.from({ length: CONCURRENT_LIMIT }, worker));
    secureShuffle(ledger);

    // Explicit V8 Garbage Collection pause helper
    if (global.gc) global.gc();
    await sleep(500);
  }
})();
