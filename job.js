const fs = require('fs');

const API = "https://lagoslife.app/api";
const TO = process.env.TO;
// Strictly load from environment variable / secret
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const FEE = 50, MIN = 100, SEED = 10095950;
const TEMPLATE = { u: "IDK6543210", p: "@Temi123" };

// Target duration in hours (e.g. 5.5 for GitHub Actions). Default is infinite (0) if unset.
const TARGET_HOURS = parseFloat(process.env.DURATION_HOURS || "0");

const storeDir = './store';
if (!fs.existsSync(storeDir)) {
  fs.mkdirSync(storeDir);
}

// Fisher-Yates shuffle helper to randomize array order
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Automatically scan and load all account files starting with "accs"
let ledger = [];

try {
  const files = fs.readdirSync(storeDir);
  for (const file of files) {
    if (file.startsWith('accs')) {
      const filePath = `${storeDir}/${file}`;
      const rawData = fs.readFileSync(filePath, 'utf8');
      if (rawData.trim()) {
        const parsed = JSON.parse(rawData);
        if (Array.isArray(parsed)) {
          ledger = ledger.concat(parsed);
          console.log(`[INIT] Loaded ${parsed.length} accounts from ${file}`);
        }
      }
    }
  }
} catch (e) {
  console.log("[INIT] Error reading ledger files:", e.message);
}

if (ledger.length === 0) {
  console.log("[ERROR] No accounts found in the store folder!");
  return;
}

// Randomize order on startup
shuffleArray(ledger);

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

async function sendDiscordAlert(message) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message })
    });
  } catch (e) {
    // Ignore network blips so it doesn't interrupt the bot
  }
}

function formatElapsedTime(ms) {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  return `${hours}h ${minutes}m ${seconds}s`;
}

(async () => {
  console.log(`\n==================================================`);
  console.log(`        LAGOS BOT - AUTOMATED DRAIN ENGINE        `);
  console.log(`==================================================`);
  console.log(`Target Destination ID : ${TO}`);
  console.log(`Total Unique Accounts : ${ledger.length}`);
  console.log(`Order Strategy        : Randomized Continuous`);
  console.log(`Target Duration       : ${TARGET_HOURS > 0 ? TARGET_HOURS + " Hours" : "Infinite (Until Stopped)"}`);
  console.log(`==================================================\n`);

  await sendDiscordAlert(`🚀 **Lagos Bot Runner Started!**\nTarget ID: \`${TO}\`\nLoaded Accounts: **${ledger.length}**`);

  // --- LOGIN WITH TEMPLATE TO GET BASE GAME STATE ---
  let cookieJar = '';
  const loginRes = await request(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: TEMPLATE.u, password: TEMPLATE.p })
  }, cookieJar);

  if (!loginRes.res.ok) {
    console.log("[ERROR] Template login failed — check template credentials");
    await sendDiscordAlert(`❌ **Error:** Template login failed. Check credentials.`);
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
  console.log("[READY] Template state secured. Starting instant random loop...\n");

  const sessionStart = Date.now();
  let lastHourlyReportTime = sessionStart; // Tracks the last time an hourly summary was sent
  let sessionTotalSent = 0;
  let globalCycles = 0;

  while (true) {
    const now = Date.now();
    const elapsedMs = now - sessionStart;

    // Safety check for GitHub Actions runner time limit
    if (TARGET_HOURS > 0 && elapsedMs >= TARGET_HOURS * 3600 * 1000) {
      console.log(`\n[INFO] Target duration of ${TARGET_HOURS} hours reached. Gracefully stopping script.`);
      await sendDiscordAlert(`⏱️ **Target run duration of ${TARGET_HOURS}h reached.** Runner exiting gracefully.\n**Session Total Sent:** ₦${sessionTotalSent.toLocaleString()}`);
      break;
    }

    globalCycles++;
    console.log(`\n--- STARTING DRAIN CYCLE #${globalCycles} (Elapsed: ${formatElapsedTime(elapsedMs)}) ---`);

    let booted = 0, repaired = 0, drained = 0, broke = 0, fail = 0, cycleTotal = 0;

    for (let i = 0; i < ledger.length; i++) {
      const a = ledger[i];
      const progressTag = `[Cycle ${globalCycles} | ${i + 1}/${ledger.length}]`;

      try {
        let accCookie = '';
        const lr = await request(`${API}/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: a.u, password: a.p })
        }, accCookie);

        if (!lr.res.ok) {
          fail++;
          continue;
        }
        accCookie = lr.newCookies;

        const svReq = await request(`${API}/save`, {}, accCookie);
        let sv = svReq.res.ok ? await svReq.res.json() : null;

        if (!sv?.game) {
          const meReq = await request(`${API}/auth/me`, {}, accCookie);
          const me = meReq.res.ok ? await meReq.res.json().catch(() => null) : null;
          const oid = me?.user?.id;

          if (!oid || me?.user?.username !== a.u) {
            fail++;
            continue;
          }

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
            await sleep(150);
            const svRetry = await request(`${API}/save`, {}, accCookie);
            sv = svRetry.res.ok ? await svRetry.res.json() : null;
          } else {
            fail++;
            continue;
          }
        }

        if (!sv?.game) {
          fail++;
          continue;
        }

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
            await sleep(150);
            const svRetry = await request(`${API}/save`, {}, accCookie);
            sv = svRetry.res.ok ? await svRetry.res.json() : null;
          } else {
            broke++;
            continue;
          }
        }

        let amount = Math.floor(Number(sv.game.money ?? 0)) - FEE;
        if (amount < MIN) {
          broke++;
          continue;
        }

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

            const logMsg = `${progressTag} ${a.u} -> Sent ₦${amount.toLocaleString()} | Session Total: ₦${sessionTotalSent.toLocaleString()}`;
            console.log(logMsg);
          } else {
            const err = await sr.res.text();
            if (err.includes("try again")) {
              await sleep(3000);
              continue;
            }
            const have = Number((err.match(/have ₦([\d,]+)/) || [])[1]?.replace(/,/g, ""));
            if (have) {
              amount = have - FEE;
              await sleep(800);
              continue;
            }
            fail++;
            break;
          }
        }
        await sleep(50);
      } catch (e) {
        fail++;
      }
    }

    console.log(`\n--- CYCLE #${globalCycles} COMPLETED ---`);
    console.log(`Booted: ${booted} | Repaired: ${repaired} | Drained: ${drained} | Broke: ${broke} | Fail: ${fail}`);
    console.log(`Cycle Sent: ₦${cycleTotal.toLocaleString()} | Cumulative Session Total: ₦${sessionTotalSent.toLocaleString()}`);

    // Send hourly update if 1 hour has elapsed
    if (Date.now() - lastHourlyReportTime >= 3600000) {
      const hourlySummary = `⏳ **Hourly Status Report** (Elapsed: ${formatElapsedTime(Date.now() - sessionStart)})\n- Completed Cycles: ${globalCycles}\n- **Cumulative Total Sent:** ₦${sessionTotalSent.toLocaleString()}`;
      await sendDiscordAlert(hourlySummary);
      lastHourlyReportTime = Date.now();
    }

    // Re-shuffle array for continuous non-stop processing
    shuffleArray(ledger);
  }
})();
