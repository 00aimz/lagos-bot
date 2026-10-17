const fs = require('fs');

const API = "https://lagoslife.app/api";
const TO = process.env.TO;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const FEE = 50, MIN = 100, SEED = 1096000;
const TEMPLATE = { u: "IDK6543210", p: "@Temi123" };
const TARGET_HOURS = parseFloat(process.env.DURATION_HOURS || "0");
const CONCURRENT_LIMIT = 75; // Doubled concurrency for maximum throughput

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
  console.log("[ERROR] No accounts found!");
  return;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(url, options = {}, cookieJar = '') {
  options.headers = options.headers || {};
  if (cookieJar) options.headers['cookie'] = cookieJar;

  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(3000) }).catch(e => ({ ok: false, statusText: e.message }));
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

  if (!loginRes.res.ok) {
    console.log("[ERROR] Template login failed");
    return;
  }

  const getSaveReq = await request(`${API}/save`, {}, loginRes.newCookies);
  const saveJson = getSaveReq.res.ok ? await getSaveReq.res.json() : null;
  let clean = saveJson?.game;
  if (!clean) {
    console.log("[ERROR] Template account has no game state");
    return;
  }

  delete clean.owner;
  console.log("Template ready — turbo drain armed,", ledger.length, "accounts");
  sendDiscordAlert(`🚀 Turbo Engine online. Loaded ${ledger.length} accounts. Sweeping...`);

  const sessionStart = Date.now();
  let sessionTotalSent = 0, globalCycles = 0;

  while (true) {
    if (TARGET_HOURS > 0 && (Date.now() - sessionStart) >= TARGET_HOURS * 3600000) break;

    globalCycles++;
    let currentIndex = 0, cycleTotal = 0;
    let booted = 0, repaired = 0, drained = 0, broke = 0, fail = 0;

    async function worker(workerId) {
      await sleep(Math.floor(Math.random() * 100) + (workerId * 20));

      while (currentIndex < ledger.length) {
        const actualIndex = currentIndex++;
        const a = ledger[actualIndex];
        if (!a) break;

        try {
          let lr = await request(`${API}/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username: a.u, password: a.p })
          });
          if (!lr.res.ok) { fail++; continue; }

          let accCookie = lr.newCookies;
          const getSave = async () => {
            const r = await request(`${API}/save`, {}, accCookie);
            return r.res.ok ? r.res.json() : null;
          };

          const putSave = (game, base) => request(`${API}/save`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ game, base })
          }, accCookie);

          let sv = await getSave();

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
              await sleep(20);
              sv = await getSave();
            } else {
              fail++;
              continue;
            }
          }

          if (!sv?.game) { fail++; continue; }

          if (Number(sv.game.money) < MIN + FEE) {
            const g = JSON.parse(JSON.stringify(sv.game));
            g.money = SEED;
            let rr = await putSave(g, sv.updatedAt ?? sv.now);
            
            if (!rr.res.ok) {
              const err = typeof rr.res.text === 'function' ? await rr.res.text() : '';
              if (err.includes("stale")) {
                sv = await getSave();
                if (sv?.game) {
                  const gRetry = JSON.parse(JSON.stringify(sv.game));
                  gRetry.money = SEED;
                  rr = await putSave(gRetry, sv.updatedAt ?? sv.now);
                }
              }
            }

            if (rr.res.ok) {
              repaired++;
              await sleep(20);
              sv = await getSave();
            } else {
              broke++;
              continue;
            }
          }

          if (!sv?.game) { broke++; continue; }

          let amount = Math.floor(Number(sv.game.money ?? 0)) - FEE;
          if (amount < MIN) { broke++; continue; }

          let ok = false;
          for (let tries = 0; tries < 2 && !ok; tries++) {
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
              console.log(`[SUCCESS] [${actualIndex + 1}/${ledger.length}] ${a.u} -> ₦${amount.toLocaleString()} | Total: ₦${sessionTotalSent.toLocaleString()}`);
            } else {
              const err = typeof sr.res.text === 'function' ? await sr.res.text() : '';
              if (err.includes("try again")) {
                await sleep(500);
                continue;
              }
              const have = Number((err.match(/have ₦([\d,]+)/) || [])[1]?.replace(/,/g, ""));
              if (have) {
                amount = have - FEE;
                await sleep(200);
                continue;
              }
              fail++;
              break;
            }
          }

          await sleep(10);
        } catch (e) {
          fail++;
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENT_LIMIT }, (_, idx) => worker(idx)));
    secureShuffle(ledger);

    console.log(`\n--- CYCLE #${globalCycles} COMPLETED ---`);
    console.log(`Booted: ${booted} | Repaired: ${repaired} | Drained: ${drained} | Broke: ${broke} | Fail: ${fail}`);
    console.log(`Cycle Sent: ₦${cycleTotal.toLocaleString()} | Cumulative Total: ₦${sessionTotalSent.toLocaleString()}\n`);

    await sleep(200);
  }
})();
