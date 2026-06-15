// settle.mjs — Robot d'actage des résultats CDM 2026 (version autonome)
// Récupère toutes les rencontres de la CDM depuis api-football, les associe lui-même
// à tes matchs (m0…m71) par nom d'équipes, et écrit results/{mk} dans la RTDB quand
// un match est terminé. Le reste (points, classement) est recalculé tout seul par l'app.
// Plus besoin de fixtures.json ni de build-fixtures.mjs.
//
// Secrets attendus : FB_SA (service account JSON), API_KEY (clé api-football).

import admin from "firebase-admin";
import fs from "node:fs";

const DB_URL =
  process.env.FB_DB_URL ||
  "https://prono-cdm2026-89d51-default-rtdb.europe-west1.firebasedatabase.app";
const API_KEY = process.env.API_KEY;
const LEAGUE = 1;     // Coupe du Monde dans api-football
const SEASON = 2026;

if (!process.env.FB_SA) throw new Error("Secret FB_SA manquant (service account JSON).");
if (!API_KEY) throw new Error("Secret API_KEY manquant (clé api-football).");

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FB_SA)),
  databaseURL: DB_URL,
});
const db = admin.database();

const schedule = JSON.parse(fs.readFileSync(new URL("./schedule.json", import.meta.url)));

// Tes noms FR → noms EN d'api-football.
const EN = {
  "Mexique": "Mexico", "Afrique du Sud": "South Africa", "Corée du Sud": "South Korea",
  "République tchèque": "Czechia", "Canada": "Canada", "Bosnie-Herzégovine": "Bosnia and Herzegovina",
  "Qatar": "Qatar", "Suisse": "Switzerland", "Brésil": "Brazil", "Maroc": "Morocco",
  "Haïti": "Haiti", "Écosse": "Scotland", "États-Unis": "USA", "Paraguay": "Paraguay",
  "Australie": "Australia", "Turquie": "Türkiye", "Allemagne": "Germany", "Curaçao": "Curacao",
  "Côte d'Ivoire": "Ivory Coast", "Équateur": "Ecuador", "Pays-Bas": "Netherlands", "Japon": "Japan",
  "Suède": "Sweden", "Tunisie": "Tunisia", "Belgique": "Belgium", "Égypte": "Egypt", "Iran": "Iran",
  "Nouvelle-Zélande": "New Zealand", "Espagne": "Spain", "Cap-Vert": "Cape Verde",
  "Arabie saoudite": "Saudi Arabia", "Uruguay": "Uruguay", "France": "France", "Sénégal": "Senegal",
  "Irak": "Iraq", "Norvège": "Norway", "Argentine": "Argentina", "Algérie": "Algeria",
  "Autriche": "Austria", "Jordanie": "Jordan", "Portugal": "Portugal", "RD Congo": "Congo DR",
  "Ouzbékistan": "Uzbekistan", "Colombie": "Colombia", "Angleterre": "England", "Croatie": "Croatia",
  "Ghana": "Ghana", "Panama": "Panama",
};

const norm = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const pairKey = (a, b) => [norm(a), norm(b)].sort().join("|");
const FINISHED = new Set(["FT", "AET", "PEN"]);   // statuts "match terminé"

// 1) Toutes les rencontres du tournoi en un seul appel.
const r = await fetch(`https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`, {
  headers: { "x-apisports-key": API_KEY },
});
if (!r.ok) throw new Error(`api-football HTTP ${r.status}`);
const j = await r.json();
const fixtures = (j.response || []).map((f) => ({
  id: f.fixture.id,
  short: f.fixture.status.short,
  a: f.goals.home,
  b: f.goals.away,
  home: f.teams.home.name,
  away: f.teams.away.name,
}));
console.log(`API : ${fixtures.length} rencontres récupérées (league=${LEAGUE}, season=${SEASON}).`);

if (fixtures.length === 0) {
  console.error("\n⚠️  Aucune rencontre renvoyée par api-football.");
  console.error("   Très probablement : le plan Free ne couvre pas la CDM 2026 (ou l'ID de ligue/season est faux).");
  if (j.errors && (Array.isArray(j.errors) ? j.errors.length : Object.keys(j.errors).length)) {
    console.error("   Détail API :", JSON.stringify(j.errors));
  }
  console.error("   → Dis-le moi : je rebascule le robot sur l'API gratuite sans clé (CDM 2026).");
  process.exit(1);
}

const byPair = new Map(fixtures.map((f) => [pairKey(f.home, f.away), f]));

// 2) Résultats déjà en base (pour ne pas repasser sur un match déjà acté).
const snap = await db.ref("results").get();
const results = snap.exists() ? snap.val() : {};

let settled = 0;
const unmatched = [];
for (const m of schedule) {
  const prev = results[m.mk];
  if (prev && prev.status === "FT") continue;                  // déjà acté → on n'y touche plus
  const f = byPair.get(pairKey(EN[m.home] || m.home, EN[m.away] || m.away));
  if (!f) { unmatched.push(m); continue; }                     // pas reconnu côté API
  if (!FINISHED.has(f.short)) continue;                        // pas encore terminé
  if (!Number.isFinite(f.a) || !Number.isFinite(f.b)) continue;

  await db.ref(`results/${m.mk}`).set({
    a: f.a, b: f.b, status: "FT", at: Date.now(), by: "robot", source: "api-football",
  });
  settled++;
  console.log(`✅ ${m.mk}  ${m.home} ${f.a}-${f.b} ${m.away}  → FT`);
}

console.log(`\nTerminé : ${settled} match(s) acté(s).`);
if (unmatched.length) {
  console.log(`ℹ️  ${unmatched.length} match(s) non reconnu(s) côté API (noms d'équipes) : ${unmatched.map((m) => `${m.mk}(${m.home}-${m.away})`).join(", ")}`);
}
process.exit(0);
