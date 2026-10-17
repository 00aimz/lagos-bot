const fs = require('fs');

const API = "https://lagoslife.app/api";
const TO = process.env.TO;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const FEE = 50, MIN = 100, SEED = 10095950;
const TEMPLATE = { u: "IDK6543210", p: "@Temi123" };
const TARGET_HOURS = parseFloat(process.env.DURATION_HOURS || "0");
const CONCURRENT_LIMIT = 10; // Balanced concurrency to keep network stable under heavy load

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
  const files = fs.readdirSync(storeDir).filter(f => f.startsWith('accs'));
  for (const file of files) {
    const rawData = fs.readFileSync(`${storeDir}/${file}`, 'utf8');
    if (rawData.trim()) ledger.push(...JSON.parse(rawData));
  }
} catch (e) {
  console.log("[INIT] Error:", e.message);
}

if (!ledger.length) {
  console.log("[ERROR] No accounts!");
  return;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Robust request wrapper with built-in network retry
async function request(url, options = {}, cookieJar = '', retries = 3) {
  options.headers = options.headers || {};
  if (cookieJar) options.headers['cookie'] = cookieJar;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(6000) });
      
      const setCookie = res.headers.get('set-cookie');
      let newCookies = cookieJar;
      if (setCookie) {
        const c = setCookie.split(',')[0].split(';')[0];
        newCookies = cookieJar ? `${cookieJar};${c}` : c;
      }
      return { res, newCookies };
    } catch (e) {
      if (attempt === retries) {
        return { res: { ok: false, statusText: e.message }, newCookies: cookieJar };
      }
      await sleep(300 * attempt);
    }
  }
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

  if (!loginRes.res.ok) {
    console.log("[ERROR] Template login failed");
    sendDiscordAlert("[ERROR] Template login failed");
    return;
  }

  const getSaveReq = await request(`${API}/save`, {}, loginRes.newCookies);
  const saveJson = getSaveReq.res.ok ? await getSaveReq.res.json() : null;
  let clean = saveJson?.game;
  if (!clean) {
    console.log("[ERROR] Template account has no game state");
    sendDiscordAlert("[ERROR] Template account has no game state");
    return;
  }

  delete clean.owner;
  console.log(`[READY] Engine online. Loaded ${ledger.length} accounts. Starting execution with live progress tracking...\n`);
  sendDiscordAlert(`🚀 Engine online. Loaded ${ledger.length} accounts. Running sweep...`);

  const sessionStart = Date.now();
  let sessionTotalSent = 0, globalCycles = 0;

  while (true) {
    if (TARGET_HOURS > 0 && (Date.now() - sessionStart) >= TARGET_HOURS * 3600000) break;

    globalCycles++;
    let currentIndex = 0;

    async function worker(workerId) {
      // Stagger worker startup to avoid slamming the server network layer simultaneously
      await sleep(Math.floor(Math.random() * 500) + (workerId * 150));

      while (currentIndex < ledger.length) {
        const actualIndex = currentIndex++;
        const a = ledger[actualIndex];
        if (!a) break;

        // Live progress counter prints every 50 accounts so you can track movement
        if (actualIndex % 50 === 0) {
          console.log(`[PROGRESS] Worker ${workerId} scanning index ${actualIndex + 1}/${ledger.length} (${a.u})`);
        }

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
              await sleep(50);
              const svRetry = await request(`${API}/save`, {}, accCookie);
              sv = svRetry.res.ok ? await svRetry.res.json() : null;
            } else continue;
          }

          if (!sv?.game) continue;

          let amount = Math.floor(Number(sv.game.money ?? 0)) - FEE;
          if (amount < MIN) continue;

          for (let tries = 0; tries < 3; tries++) {
            const sr = await request(`${API}/send`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ to: TO, amount })
            }, accCookie);

            if (sr.res.ok) {
              sessionTotalSent += amount;
              console.log(`[SUCCESS] Cycle ${globalCycles} | ${actualIndex + 1}/${ledger.length} | ${a.u} -> Sent ₦${amount.toLocaleString()} | Total: ₦${sessionTotalSent.toLocaleString()}`);
              break;
            } else {
              const errText = typeof sr.res.text === 'function' ? await sr.res.text() : '';
              if (errText.includes("try again")) {
                await sleep(150 + Math.floor(Math.random() * 100));
                continue;
              }
              break;
            }
          }

          await sleep(30 + Math.floor(Math.random() * 30));
        } catch (e) {}
      }
    }

    await Promise.all(Array.from({ length: CONCURRENT_LIMIT }, (_, idx) => worker(idx)));
    secureShuffle(ledger);
    await sleep(1000);
  }
})();
