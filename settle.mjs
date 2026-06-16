// settle.mjs — Robot d'actage des résultats CDM 2026
// Source : openfootball (JSON public, GRATUIT, SANS CLÉ). Plus besoin d'api-football.
// Récupère les résultats, les associe à tes matchs (m0…m71) par équipes, et écrit
// results/{mk} dans la RTDB quand un match est terminé. Le reste (points, classement)
// est recalculé tout seul par l'app.
//
// Seul secret attendu : FB_SA (service account Firebase).

import admin from "firebase-admin";
import fs from "node:fs";

const DB_URL =
  process.env.FB_DB_URL ||
  "https://prono-cdm2026-89d51-default-rtdb.europe-west1.firebasedatabase.app";
const SOURCE =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

if (!process.env.FB_SA) throw new Error("Secret FB_SA manquant (service account JSON).");

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FB_SA)),
  databaseURL: DB_URL,
});
const db = admin.database();

const schedule = JSON.parse(fs.readFileSync(new URL("./schedule.json", import.meta.url)));

// Tes noms FR → noms openfootball (validés sur les vraies données).
const EN = {
  "Mexique": "Mexico", "Afrique du Sud": "South Africa", "Corée du Sud": "South Korea",
  "République tchèque": "Czech Republic", "Canada": "Canada", "Bosnie-Herzégovine": "Bosnia & Herzegovina",
  "Qatar": "Qatar", "Suisse": "Switzerland", "Brésil": "Brazil", "Maroc": "Morocco", "Haïti": "Haiti",
  "Écosse": "Scotland", "États-Unis": "USA", "Paraguay": "Paraguay", "Australie": "Australia", "Turquie": "Turkey",
  "Allemagne": "Germany", "Curaçao": "Curaçao", "Côte d'Ivoire": "Ivory Coast", "Équateur": "Ecuador",
  "Pays-Bas": "Netherlands", "Japon": "Japan", "Suède": "Sweden", "Tunisie": "Tunisia", "Belgique": "Belgium",
  "Égypte": "Egypt", "Iran": "Iran", "Nouvelle-Zélande": "New Zealand", "Espagne": "Spain", "Cap-Vert": "Cape Verde",
  "Arabie saoudite": "Saudi Arabia", "Uruguay": "Uruguay", "France": "France", "Sénégal": "Senegal", "Irak": "Iraq",
  "Norvège": "Norway", "Argentine": "Argentina", "Algérie": "Algeria", "Autriche": "Austria", "Jordanie": "Jordan",
  "Portugal": "Portugal", "RD Congo": "DR Congo", "Ouzbékistan": "Uzbekistan", "Colombie": "Colombia",
  "Angleterre": "England", "Croatie": "Croatia", "Ghana": "Ghana", "Panama": "Panama",
};

const norm = (s) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const pairKey = (a, b) => [norm(a), norm(b)].sort().join("|");

// 1) Lire les résultats publics openfootball.
const r = await fetch(SOURCE);
if (!r.ok) throw new Error(`openfootball HTTP ${r.status}`);
const data = await r.json();
const matches = data.matches || [];
console.log(`Source : ${matches.length} matchs lus.`);

// Index des matchs terminés (score final présent) par paire d'équipes.
const finished = new Map();
for (const m of matches) {
  const ft = m.score && m.score.ft;
  if (Array.isArray(ft) && Number.isFinite(+ft[0]) && Number.isFinite(+ft[1])) {
    finished.set(pairKey(m.team1, m.team2), { a: +ft[0], b: +ft[1] });
  }
}
console.log(`Matchs terminés (score final dispo) : ${finished.size}.`);

// 2) Résultats déjà en base (pour ne pas repasser sur un match déjà acté).
const snap = await db.ref("results").get();
const results = snap.exists() ? snap.val() : {};

let settled = 0;
for (const m of schedule) {
  const prev = results[m.mk];
  if (prev && prev.status === "FT") continue;                 // déjà acté → on n'y touche plus
  const f = finished.get(pairKey(EN[m.home] || m.home, EN[m.away] || m.away));
  if (!f) continue;                                           // pas encore terminé / non trouvé

  await db.ref(`results/${m.mk}`).set({
    a: f.a, b: f.b, status: "FT", at: Date.now(), by: "robot", source: "openfootball",
  });
  settled++;
  console.log(`✅ ${m.mk}  ${m.home} ${f.a}-${f.b} ${m.away}  → FT`);
}

console.log(`\nTerminé : ${settled} match(s) acté(s).`);
process.exit(0);
