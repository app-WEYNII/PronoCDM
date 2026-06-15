// build-fixtures.mjs — remplit fixtures.json automatiquement
// Usage (en local, à la racine du repo, à côté de schedule.json) :
//     API_KEY=ta_cle node build-fixtures.mjs
//
// Récupère toutes les rencontres de la CDM 2026 sur api-football et les associe
// à tes matchs (m0…m71) par paire d'équipes, avec l'heure de coup d'envoi en secours.
// Tu n'as RIEN à saisir : au pire quelques matchs non reconnus sont listés à la fin.

import fs from "node:fs";

const API_KEY = process.env.API_KEY;
if (!API_KEY) throw new Error("Lance avec :  API_KEY=ta_cle node build-fixtures.mjs");

const LEAGUE = 1;     // Coupe du Monde dans api-football. Si 0 rencontre → à ajuster (voir message en bas).
const SEASON = 2026;

const schedule = JSON.parse(fs.readFileSync(new URL("./schedule.json", import.meta.url)));

// Tes noms FR → noms EN d'api-football (aide au matching).
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
const kickoff = (m) => new Date(`${m.date}T${m.time}:00+02:00`).getTime();

// 1) Toutes les rencontres du tournoi en un appel.
const url = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`;
const res = await fetch(url, { headers: { "x-apisports-key": API_KEY } });
const j = await res.json();
const apiFixtures = (j.response || []).map((f) => ({
  id: f.fixture.id,
  ts: f.fixture.timestamp * 1000,
  home: f.teams.home.name,
  away: f.teams.away.name,
}));
console.log(`API : ${apiFixtures.length} rencontres (league=${LEAGUE}, season=${SEASON}).`);

if (apiFixtures.length === 0) {
  console.error("\n⚠️  Aucune rencontre renvoyée.");
  console.error("   Deux causes possibles :");
  console.error("   1) l'ID de ligue n'est pas 1 → cherche \"World Cup\" dans api-football et ajuste LEAGUE.");
  console.error("   2) le plan Free ne couvre pas la CDM 2026 → dis-le moi, je rebascule le robot");
  console.error("      sur l'API gratuite sans clé (github.com/rezarahiminia/worldcup2026).");
  if (j.errors) console.error("   Détail API :", JSON.stringify(j.errors));
  process.exit(1);
}

// Index par paire d'équipes (unique en phase de poule).
const byPair = new Map(apiFixtures.map((f) => [pairKey(f.home, f.away), f]));

const out = {};
const guessed = [];   // associé via l'horaire (à vérifier d'un œil)
const missing = [];   // pas trouvé du tout

for (const m of schedule) {
  const enHome = EN[m.home] || m.home, enAway = EN[m.away] || m.away;
  let f = byPair.get(pairKey(enHome, enAway));   // match net par équipes

  if (!f) {
    // Secours : même créneau horaire (±15 min) + au moins une équipe qui colle.
    const ko = kickoff(m);
    const near = apiFixtures
      .filter((x) => Math.abs(x.ts - ko) <= 15 * 60 * 1000)
      .map((x) => {
        const got = [norm(x.home), norm(x.away)];
        const want = [norm(enHome), norm(enAway)];
        const sc = want.reduce((n, w) => n + (got.some((g) => g && w && (g === w || g.startsWith(w.slice(0, 4)) || w.startsWith(g.slice(0, 4)))) ? 1 : 0), 0);
        return { x, sc };
      })
      .sort((a, b) => b.sc - a.sc)[0];
    if (near && near.sc >= 1) { f = near.x; guessed.push(m); }
  }

  if (f) out[m.mk] = f.id;
  else { out[m.mk] = null; missing.push(m); }
}

fs.writeFileSync(new URL("./fixtures.json", import.meta.url), JSON.stringify(out, null, 1));
const done = Object.values(out).filter((v) => v != null).length;
console.log(`\n✅ fixtures.json écrit : ${done}/${schedule.length} matchs mappés.`);

if (guessed.length) {
  console.log(`\n🟡 ${guessed.length} associé(s) par l'horaire (jette un œil, surtout les noms d'équipes accentués) :`);
  for (const m of guessed) console.log(`   ${m.mk}  ${m.home} - ${m.away}  → fixture ${out[m.mk]}`);
}
if (missing.length) {
  console.log(`\n🔴 ${missing.length} à compléter à la main dans fixtures.json :`);
  for (const m of missing) console.log(`   ${m.mk}  ${m.home} - ${m.away}  (${m.date} ${m.time})`);
}
