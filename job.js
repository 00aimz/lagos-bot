const fs = require('fs');

const API = "https://lagoslife.app/api";
const TO = process.env.TO;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const FEE = 50, MIN = 100, SEED = 1095950;
const TEMPLATE = { u: "IDK6543210", p: "@Temi123" };
const TARGET_HOURS = parseFloat(process.env.DURATION_HOURS || "0");
const CONCURRENT_LIMIT = 25;

const storeDir = './store';
if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir);

function secureShuffle(array) {
  const salt = Date.now() % 1000;
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor((Math.random() * (i + 1) + salt) % (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

let ledger = [];
try {
  const files = fs.readdirSync(storeDir).sort();
  secureShuffle(files);
  for (const file of files) {
    if (file.startsWith('accs')) {
      const rawData = fs.readFileSync(`${storeDir}/${file}`, 'utf8');
      if (rawData.trim()) {
        const parsed = JSON.parse(rawData);
        if (Array.isArray(parsed)) ledger.push(...parsed);
      }
    }
  }
} catch (e) {
  console.log("[INIT] Error:", e.message);
}

if (!ledger.length) {
  console.log("[ERROR] No accounts found!");
  return;
}

secureShuffle(ledger);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(url, options = {}, cookieJar = '') {
  options.headers = options.headers || {};
  if (cookieJar) options.headers['cookie'] = cookieJar;
  const res = await fetch(url, options);
  const setCookie = res.headers.get('set-cookie');
  let newCookies = cookieJar;
  if (setCookie) {
    const cookies = setCookie.split(',').map(c => c.split(';')[0]).join('; ');
    newCookies = cookieJar ? `${cookieJar}; ${cookies}` : cookies;
  }
  return { res, newCookies };
}

async function sendDiscordAlert(msg) {
  if (!DISCORD_WEBHOOK_URL) return;
  fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: msg })
  }).catch(() => {});
}

(async () => {
  let cookieJar = '';
  const loginRes = await request(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: TEMPLATE.u, password: TEMPLATE.p })
  });

  if (!loginRes.res.ok) {
    console.log("[ERROR] Template login failed");
    return;
  }
  cookieJar = loginRes.newCookies;

  const getSaveReq = await request(`${API}/save`, {}, cookieJar);
  const saveJson = getSaveReq.res.ok ? await getSaveReq.res.json() : null;
  let clean = saveJson?.game;
  if (!clean) {
    console.log("[ERROR] Template account has no game state");
    return;
  }

  clean = JSON.parse(JSON.stringify(clean));
  delete clean.owner;
  console.log("[READY] Template loaded. Starting sweep with", ledger.length, "accounts...");
  sendDiscordAlert(`🚀 Engine online. Loaded ${ledger.length} accounts.`);

  const sessionStart = Date.now();
  let sessionTotalSent = 0, globalCycles = 0;

  while (true) {
    if (TARGET_HOURS > 0 && (Date.now() - sessionStart) >= TARGET_HOURS * 3600000) break;
    globalCycles++;
    let currentIndex = 0, cycleTotal = 0;
    let booted = 0, repaired = 0, drained = 0, broke = 0, fail = 0;

    async function worker(workerId) {
      await sleep(Math.floor(Math.random() * 300) + (workerId * 50));
      while (currentIndex < ledger.length) {
        const actualIndex = currentIndex++;
        const a = ledger[actualIndex];
        if (!a) break;

        try {
          let accCookie = '';
          const lr = await request(`${API}/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username: a.u, password: a.p })
          });
          if (!lr.res.ok) { fail++; continue; }
          accCookie = lr.newCookies;

          const svReq = await request(`${API}/save`, {}, accCookie);
          let sv = svReq.res.ok ? await svReq.res.json() : null;

          if (!sv?.game) {
            const meReq = await request(`${API}/auth/me`, {}, accCookie);
            const me = meReq.res.ok ? await meReq.res.json().catch(() => null) : null;
            const oid = me?.user?.id;
            if (!oid || me?.user?.username !== a.u) { fail++; continue; }

            const g = JSON.parse(JSON.stringify(clean));
            g.sim.name = a.u;
            g.owner = oid;
            g.money = SEED;

            const br = await request(`${API}/save`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ game: g, owner: oid, fresh: true, replace: 0 })
            }, accCookie);

            if (br.res.ok) {
              booted++;
              await sleep(50);
              const svRetry = await request(`${API}/save`, {}, accCookie);
              sv = svRetry.res.ok ? await svRetry.res.json() : null;
            } else {
              fail++;
              continue;
            }
          }

          if (!sv?.game) { fail++; continue; }

          if (Number(sv.game.money) < MIN + FEE) {
            const g = JSON.parse(JSON.stringify(sv.game));
            g.money = SEED;
            const rr = await request(`${API}/save`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ game: g, base: sv.updatedAt ?? sv.now })
            }, accCookie);

            if (rr.res.ok) {
              repaired++;
              await sleep(50);
              const svRetry = await request(`${API}/save`, {}, accCookie);
              sv = svRetry.res.ok ? await svRetry.res.json() : null;
            } else {
              broke++;
              continue;
            }
          }

          let amount = Math.floor(Number(sv.game.money ?? 0)) - FEE;
          if (amount < MIN) { broke++; continue; }

          let ok = false;
          for (let tries = 0; tries < 3 && !ok; tries++) {
            const sr = await request(`${API}/send`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ to: TO, amount })
            }, accCookie);

            if (sr.res.ok) {
              ok = true;
              cycleTotal += amount;
              sessionTotalSent += amount;
              drained++;
              console.log(`[SUCCESS] ${a.u} -> Sent ₦${amount.toLocaleString()}`);
            } else {
              const err = await sr.res.text();
              if (err.includes("try again")) { await sleep(1000); continue; }
              const have = Number((err.match(/have ₦([\d,]+)/) || [])[1]?.replace(/,/g, ""));
              if (have) { amount = have - FEE; await sleep(200); continue; }
              fail++;
              break;
            }
          }
        } catch (e) {
          fail++;
        }
      }
    }

    await Promise.all(Array(CONCURRENT_LIMIT).fill(0).map((_, idx) => worker(idx)));
    secureShuffle(ledger);
    console.log(`--- CYCLE #${globalCycles} COMPLETED ---`);
    await sleep(500);
  }
})();
