const fs = require('fs');

const API = "https://lagoslife.app//api"; // Use your full domain URL
const TO = process.env.TO;                      // GitHub Secret for destination ID
const FEE = 50, MIN = 100, SEED = 1096000;

// Template account credentials hardcoded from your script
const TEMPLATE = { u: "IDK6543210", p: "@Temi123" };

// Load ledger file from repository store
const ledgerPath = './store/accs.json';
let ledger = [];
if (fs.existsSync(ledgerPath)) {
  ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
}

console.log(`Loaded ledger from store/accs.json: ${ledger.length} accounts`);
if (!ledger.length) {
  console.log("Ledger empty — nothing to process");
  process.exit(0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Helper function to handle fetch requests and cookies in Node.js
async function request(url, options = {}, cookieJar = '') {
  options.headers = options.headers || {};
  if (cookieJar) {
    options.headers['cookie'] = cookieJar;
  }
  const res = await fetch(url, options);
  const setCookie = res.headers.get('set-cookie');
  let newCookies = cookieJar;
  if (setCookie) {
    const cookies = setCookie.split(',').map(c => c.split(';')[0]).join('; ');
    newCookies = cookieJar ? `${cookieJar}; ${cookies}` : cookies;
  }
  return { res, cookies: newCookies };
}

(async () => {
  let cookieJar = '';

  // 1. Log into template account to grab clean state structure
  const loginRes = await request(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: TEMPLATE.u, password: TEMPLATE.p })
  });

  if (!loginRes.res.ok) {
    console.log("Template login failed — check credentials");
    return;
  }
  cookieJar = loginRes.cookies;

  const saveRes = await request(`${API}/save`, { method: "GET" }, cookieJar);
  const saveData = saveRes.res.ok ? await saveRes.res.json() : null;
  let clean = saveData?.game;
  if (!clean) {
    console.log("Template account has no game state");
    return;
  }
  clean = JSON.parse(JSON.stringify(clean));
  delete clean.owner;
  console.log(`Template ready — drain armed, ${ledger.length} accounts`);

  let booted = 0, repaired = 0, drained = 0, broke = 0, fail = 0, total = 0;
  const start = Date.now();

  // 2. Loop through all accounts in ledger
  for (let i = 0; i < ledger.length; i++) {
    const a = ledger[i];
    try {
      let userCookie = '';
      const lr = await request(`${API}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: a.u, password: a.p })
      });
      if (!lr.res.ok) { fail++; continue; }
      userCookie = lr.cookies;

      let svReq = await request(`${API}/save`, { method: "GET" }, userCookie);
      let sv = svReq.res.ok ? await svReq.res.json() : null;

      if (!sv?.game) {
        const meReq = await request(`${API}/auth/me`, { method: "GET" }, userCookie);
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
        }, userCookie);

        if (br.res.ok) {
          booted++;
          await sleep(150);
          svReq = await request(`${API}/save`, { method: "GET" }, userCookie);
          sv = svReq.res.ok ? await svReq.res.json() : null;
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
        }, userCookie);
        if (rr.res.ok) {
          repaired++;
          await sleep(150);
          svReq = await request(`${API}/save`, { method: "GET" }, userCookie);
          sv = svReq.res.ok ? await svReq.res.json() : null;
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
        }, userCookie);

        if (sr.res.ok) {
          ok = true;
          total += amount;
          drained++;
        } else {
          const err = await sr.res.text();
          if (err.includes("try again")) { await sleep(3000); continue; }
          const have = Number((err.match(/have ₦([\d,]+)/) || [])[1]?.replace(/,/g, ""));
          if (have) { amount = have - FEE; await sleep(800); continue; }
          fail++;
          break;
        }
      }

      // Print progress log every 100 accounts
      if ((i + 1) % 100 === 0) {
        console.log(`${i + 1}/${ledger.length} drained:${drained} ₦${total.toLocaleString()} repaired:${repaired} booted:${booted} broke:${broke} fail:${fail}`);
      }
      await sleep(50);
    } catch (e) {
      fail++;
    }
  }

  const mins = ((Date.now() - start) / 60000).toFixed(1);
  console.log(`DONE in ${mins}min | booted:${booted} repaired:${repaired} drained:${drained} broke:${broke} fail:${fail} | ₦${total.toLocaleString()}`);
})();
