// settle.mjs — Robot d'actage des résultats CDM 2026
// Écrit results/{mk} = { a, b, status:"FT", ... } dans la RTDB quand un match est terminé.
// Le reste (points, validation, classement) est déjà recalculé tout seul par l'app.
//
// Lancé par GitHub Actions (voir .github/workflows/settle.yml).
// Secrets attendus : FB_SA (service account JSON), API_KEY (clé api-football).

import admin from "firebase-admin";
import fs from "node:fs";

const DB_URL =
  process.env.FB_DB_URL ||
  "https://prono-cdm2026-89d51-default-rtdb.europe-west1.firebasedatabase.app";
const API_KEY = process.env.API_KEY;

if (!process.env.FB_SA) throw new Error("Secret FB_SA manquant (service account JSON).");
if (!API_KEY) throw new Error("Secret API_KEY manquant (clé api-football).");

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FB_SA)),
  databaseURL: DB_URL,
});
const db = admin.database();

const schedule = JSON.parse(fs.readFileSync(new URL("./schedule.json", import.meta.url)));
const fixtures = JSON.parse(fs.readFileSync(new URL("./fixtures.json", import.meta.url)));

// Coup d'envoi en heure de Paris (CEST = UTC+2 sur toute la fenêtre du tournoi).
const kickoffMs = (m) => new Date(`${m.date}T${m.time}:00+02:00`).getTime();

// Statuts "match terminé" côté api-football. AET/PEN = knockout : on garde le score de fin de match.
const FINISHED = new Set(["FT", "AET", "PEN"]);

async function fetchFixture(id) {
  const r = await fetch(`https://v3.football.api-sports.io/fixtures?id=${id}`, {
    headers: { "x-apisports-key": API_KEY },
  });
  if (!r.ok) throw new Error(`api-football HTTP ${r.status}`);
  const j = await r.json();
  const f = j.response && j.response[0];
  if (!f) return null;
  return { a: f.goals.home, b: f.goals.away, short: f.fixture.status.short };
}

const now = Date.now();
const snap = await db.ref("results").get();
const results = snap.exists() ? snap.val() : {};

let checked = 0, settled = 0;
for (const m of schedule) {
  const fid = fixtures[m.mk];
  if (fid == null) continue;                        // pas encore mappé dans fixtures.json
  const prev = results[m.mk];
  if (prev && prev.status === "FT") continue;       // déjà acté → on ne repasse JAMAIS dessus (idempotence)
  if (now < kickoffMs(m)) continue;                 // pas encore commencé → aucun appel inutile

  checked++;
  let d;
  try {
    d = await fetchFixture(fid);
  } catch (e) {
    console.warn(`⚠️  ${m.mk} : ${e.message}`);
    continue;
  }
  if (!d || !FINISHED.has(d.short)) continue;       // pas (encore) terminé
  if (!Number.isFinite(d.a) || !Number.isFinite(d.b)) continue;

  await db.ref(`results/${m.mk}`).set({
    a: d.a,
    b: d.b,
    status: "FT",
    at: Date.now(),
    by: "robot",
    source: "api-football",
  });
  settled++;
  console.log(`✅ ${m.mk}  ${m.home} ${d.a}-${d.b} ${m.away}  → FT`);
}

console.log(`Terminé : ${checked} match(s) vérifié(s), ${settled} acté(s).`);
process.exit(0);
