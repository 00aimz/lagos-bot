const fs = require('fs');

const API = "https://lagoslife.app/api";
const TO = process.env.TO;
const GOAL = 2807;
const WORKERS = 10;
const FEE = 50, MIN = 100, SEED = 1096000;
const TEMPLATE = { u: "IDK6543210", p: "@Temi123" };

const ledgerPath = './store/accs.json';

// Ensure store directory exists
if (!fs.existsSync('./store')) {
  fs.mkdirSync('./store');
}

let ledger = [];
if (fs.existsSync(ledgerPath)) {
  try {
    const rawData = fs.readFileSync(ledgerPath, 'utf8');
    if (rawData.trim()) ledger = JSON.parse(rawData);
  } catch (e) {
    console.log("Error parsing ledger, starting fresh.");
  }
}

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

const FIRST = [
  "Zara","Kelvin","Derek","Nadia","Felix","Ivy","Tristan","Mabel","Jasper","Celine",
  "Victor","Elena","Marcus","Tessa","Damian","Ruby","Adrian","Sienna","Leon","Mira",
  "Caleb","Naomi","Ethan","Freya","Oscar","Lydia","Julian","Vera","Simon","Clara",
  "Miles","Daphne","Ronan","Esther","Blake","Bianca","Hugo","Selene","Troy","April",
  "Wesley","Kiara","Andre","Jolie","Cyrus","Nina","Reed","Esme","Zane","Thea"
];

const LAST = [
  "Whitaker","Sinclair","Donovan","Mercer","Holloway","Bennett","Prescott","Fletcher","Monroe","Callahan",
  "Sterling","Crawford","Ellison","Harrington","Kendall","Montgomery","Sullivan","Pemberton","Winslow","Chandler",
  "Thornton","Radcliffe","Shepherd","Langford","Maddox","Beckett","Huxley","Ashford","Griffin","Waverly",
  "Kingsley","Bradford","Remington","Lawson","Carmichael","Weston","Finnegan","Davenport","Briar","Maxwell"
];

const pick = a => a[Math.floor(Math.random() * a.length)];

function makeName() {
  const f = pick(FIRST), l = pick(LAST);
  const style = Math.random();
  let n;
  if (style < 0.28)      n = f + l;
  else if (style < 0.50) n = f + "_" + l;
  else if (style < 0.68) n = f.toLowerCase() + l.toLowerCase();
  else if (style < 0.85) n = f + l.slice(0, 3);
  else                   n = pick(FIRST) + pick(LAST).slice(0, 4);

  if (!/\d/.test(n)) n += Math.floor(10 + Math.random() * 989);
  return n;
}

(async () => {
  // --- STEP 1: REGISTER ACCOUNTS IF BELOW GOAL ---
  if (ledger.length < GOAL) {
    console.log(`Need more accounts. Current: ${ledger.length}, Goal: ${GOAL}`);
    const used = new Set(ledger.map(a => a.u));
    let created = ledger.length;
    let fail = 0, taken = 0, throttled = 0;
    let running = true;

    function nextName() {
      let n = makeName(), i = 0;
      while (used.has(n) && i < 20) {
        n = makeName();
        i++;
      }
      if (used.has(n)) n = n + Math.floor(10 + Math.random() * 89);
      used.add(n);
      return n;
    }

    const regStart = Date.now();

    async function worker() {
      while (running && created < GOAL) {
        const username = nextName();
        const password = "W" + Math.random().toString(36).slice(2) + "9!";
        const name = username.replace(/[_0-9]/g, "").slice(0, 24) || username;

        try {
          const r = await fetch(`${API}/auth/register`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username, password, name, adult: true, born: "2000-01-01" })
          });

          if (r.status === 409) {
            taken++;
            used.delete(username);
            await sleep(150);
            continue;
          }
          if (r.status === 429) {
            throttled++;
            used.delete(username);
            await sleep(Math.min(60000, 5000 * throttled));
            continue;
          }
          if (!r.ok) {
            fail++;
            used.delete(username);
            if (fail > 100) { running = false; break; }
            await sleep(1500);
            continue;
          }

          const t = await r.json();
          if (!t.user) {
            fail++;
            used.delete(username);
            continue;
          }

          ledger.push({ u: username, p: password, at: Date.now() });
          created++;
          throttled = 0;

          // Save progress continuously
          fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

          await sleep(20 + Math.random() * 60);
        } catch (e) {
          await sleep(2000);
        }
      }
    }

    await Promise.all(Array.from({ length: WORKERS }, () => worker()));
    console.log(`Registration finished. Total accounts in ledger: ${ledger.length}`);
  }

  // --- STEP 2: DRAIN / SEND MONEY FROM ACCOUNTS ---
  let cookieJar = '';
  const loginRes = await request(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: TEMPLATE.u, password: TEMPLATE.p })
  }, cookieJar);
  
  if (!loginRes.res.ok) {
    console.log("template login failed — check creds");
    return;
  }
  cookieJar = loginRes.newCookies;

  const getSaveReq = await request(`${API}/save`, {}, cookieJar);
  const saveJson = getSaveReq.res.ok ? await getSaveReq.res.json() : null;
  let clean = saveJson?.game;

  if (!clean) {
    console.log("template account has no game state");
    return;
  }
  
  clean = JSON.parse(JSON.stringify(clean));
  delete clean.owner;
  console.log("template ready — drain armed,", ledger.length, "accounts");

  let booted = 0, repaired = 0, drained = 0, broke = 0, fail = 0, total = 0;
  const start = Date.now();

  for (let i = 0; i < ledger.length; i++) {
    const a = ledger[i];
    // Skip if already marked drained
    if (a.drained) continue;

    try {
      let accCookie = '';
      const lr = await request(`${API}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: a.u, password: a.p })
      }, accCookie);

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
          await sleep(150);
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
          await sleep(150);
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
          total += amount;
          drained++;
          a.drained = true;
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

  // Update ledger status with drained flags
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

  const mins = ((Date.now() - start) / 60000).toFixed(1);
  console.log(`DONE in ${mins}min | booted:${booted} repaired:${repaired} drained:${drained} broke:${broke} fail:${fail} | ₦${total.toLocaleString()}`);
})();
