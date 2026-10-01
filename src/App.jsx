// PENSIOEN PLANNER - src/App.jsx
// fix-10: vergelijking uitgelegd in gewone woorden: per scenario een korte uitleg
//         ("Wat betekent dit?") en een uitleg per regel van de tabel
// fix-9: tabblad Simulatie omgebouwd tot "scenario's":
//        - de stop-scenario's per persoon staan nu hier (Mijn situatie toont een samenvatting)
//        - varianten bewaren en naast elkaar vergelijken met "doorwerken tot AOW"
//          (netto per maand na stoppen, laagste maand, eindsituatie, aanvulling uit spaargeld)
//        - grafiek netto per maand per scenario
//        - oude "extra aankoop" wordt automatisch een koopsom bij Pensioenen
// fix-8: gegevens van de 2e persoon verdwenen na herladen — opslaan nu centraal
//        via useEffect met de actuele state (zie bij "opslaan")
// fix-7: scenario "eerder (of later) stoppen met werken" per persoon:
//        - schuifregelaar voor de stopleeftijd (per maand)
//        - pensioenopbouw loopt door tot de stopleeftijd (Opgebouwd → TeBereiken uit het XML)
//        - pensioen laten ingaan: standaard / direct bij stoppen / eigen leeftijd (vanaf 60),
//          met een actuariële vervroegings-/uitstelfactor (schatting)
//        - optie hoog-laag (100:75) tot de AOW-leeftijd
//        - overzicht: per regeling doorwerken vs. scenario, inkomensgat, risico partnerpensioen
//        - AOW gecorrigeerd: opbouw gaat door zolang je in NL woont, ook als je stopt met werken
// fix-6: - verwijderen vraagt eerst om bevestiging (VerwijderKnop i.p.v. rode ✕)
//        - alle blokken inklapbaar (Inklapbaar), met samenvatting als ze dicht zijn
//        - "+ Pensioen" per persoon i.p.v. één knop die altijd bij de oudste toevoegde
// fix-5: banksparen/beleggingsrecht en koopsommen invoeren per persoon.
//        Banksparen: saldo nu (+ evt. verwachte waarde van de aanbieder), inleg en rendement
//        tot de startdatum; daarna een uitkering over een looptijd (annuïteit).
//        Koopsom: bedrag + uitkering uit de offerte (of een schatting). Beide tellen
//        als bruto inkomen in box 1 en gaan dus mee in belasting en Zvw.
// fix-4: Help-, Privacy- en Disclaimerpagina (src/InfoPaginas.jsx), bereikbaar via
//        de ❓ Help-knop, de voettekst en #help / #privacy / #disclaimer in de URL
// fix-3: leefsituatie (samenwonend/alleenstaand) per persoon uit het XML-overzicht
//        (LevensSituatie) en instelbaar; bepaalt AOW-bedrag en alleenstaande-ouderenkorting
// fix-2: - berekening per maand i.p.v. per jaar (geboortemaand uit het XML-overzicht);
//          inkomensmomenten vallen nu op de juiste maand (bv. AOW op 67j3m)
//        - tab "Profiel" hernoemd naar "Mijn situatie"
// fix-1: - netto-berekening bijgewerkt naar 2026-tarieven:
//          * apart tarief voor wie de AOW-leeftijd heeft bereikt (17,85% i.p.v. 35,75% in schijf 1)
//          * geen arbeidskorting meer op pensioen/AOW (die geldt alleen voor loon)
//          * ouderenkorting en Zvw-bijdrage (4,85%) meegenomen
//        - inkomensmomenten op het profiel tonen nu per moment de componenten
//          (AOW, elk pensioen, vermogen) plus ingehouden belasting en Zvw
// v11: AOW automatisch berekend op basis van pensioenleeftijd

import { useState, useMemo, useEffect } from "react";
import { HelpPagina, PrivacyPagina, DisclaimerPagina } from "./InfoPaginas.jsx";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

const FIX_NR = "fix-10";

// ─── IndexedDB ────────────────────────────────────────────────────────────────
const DB_NAME = "pensioenPlanner";
const STORE   = "gegevens";
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}
async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ─── Belasting box 1 2026 (fix-1) ─────────────────────────────────────────────
// Bronnen: Belastingdienst tarieven 2026. Benadering: pensioen en AOW zijn geen loon,
// dus geen arbeidskorting. Zvw-bijdrage wordt door SVB/pensioenuitvoerder ingehouden.
const BEL = {
  schijf1Grens: 38883, schijf2Grens: 78426,
  tariefJong: [0.3575, 0.3756, 0.495],     // jonger dan AOW-leeftijd
  tariefAOW:  [0.1785, 0.3756, 0.495],     // AOW-gerechtigd, geboren na 1946
  ahkJong: 3115, ahkAOW: 1556, ahkAfbouwGrens: 29736,
  ahkAfbouwJong: 0.06398, ahkAfbouwAOW: 0.03196,
  ouderenMax: 2067, ouderenGrens: 46002, ouderenAfbouw: 0.15,
  alleenstaandeOuderen: 540,
  zvwPct: 0.0485, zvwMax: 79409,
};

// Geeft { netto, belasting, zvw } per jaar
function berekenNettoDetail(bruto, aowGerechtigd = false, alleenstaand = false) {
  if (bruto <= 0) return { netto: 0, belasting: 0, zvw: 0 };
  const t = aowGerechtigd ? BEL.tariefAOW : BEL.tariefJong;
  const s1 = Math.min(bruto, BEL.schijf1Grens);
  const s2 = Math.max(0, Math.min(bruto, BEL.schijf2Grens) - BEL.schijf1Grens);
  const s3 = Math.max(0, bruto - BEL.schijf2Grens);
  let bel = s1 * t[0] + s2 * t[1] + s3 * t[2];
  const ahkMax = aowGerechtigd ? BEL.ahkAOW : BEL.ahkJong;
  const ahkAfb = aowGerechtigd ? BEL.ahkAfbouwAOW : BEL.ahkAfbouwJong;
  let kortingen = Math.max(0, ahkMax - Math.max(0, bruto - BEL.ahkAfbouwGrens) * ahkAfb);
  if (aowGerechtigd) {
    kortingen += Math.max(0, BEL.ouderenMax - Math.max(0, bruto - BEL.ouderenGrens) * BEL.ouderenAfbouw);
    if (alleenstaand) kortingen += BEL.alleenstaandeOuderen;
  }
  bel = Math.max(0, bel - kortingen);
  const zvw = Math.min(bruto, BEL.zvwMax) * BEL.zvwPct;
  return { netto: Math.round(bruto - bel - zvw), belasting: Math.round(bel), zvw: Math.round(zvw) };
}
function berekenNetto(bruto, aowGerechtigd = false, alleenstaand = false) {
  return berekenNettoDetail(bruto, aowGerechtigd, alleenstaand).netto;
}

const AOW_VOLLEDIG_SAMEN  = 14379; // bruto/jr bij 100% opbouw, samenwonend
const AOW_VOLLEDIG_ALLEEN = 20929; // bruto/jr bij 100% opbouw, alleenstaand
const AOW_SAMEN_MND  = 1014;       // fallback maandbedrag als geen MPO data
const AOW_ALLEEN_MND = 1450;
const AOW_MAX_JAREN  = 50;         // 50 jaar opbouw = 100%
const JAAR_NU        = new Date().getFullYear();

// ─── Maand-hulpfuncties (fix-2) ───────────────────────────────────────────────
const MAANDEN = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
const gebAbs   = (p) => p.geboortejaar * 12 + ((p.geboortemaand ?? 1) - 1);    // absolute maand van geboorte
const lftMaanden = (p, abs) => abs - gebAbs(p);                                  // leeftijd in hele maanden
const maandenVan = (lftJaren) => Math.round(lftJaren * 12);
const absNaarLabel = (abs) => `${MAANDEN[((abs % 12) + 12) % 12]} ${Math.floor(abs / 12)}`;
const lftLabel = (mnd) => { const j = Math.floor(mnd / 12), m = mnd % 12; return `${j}j${m > 0 ? `${m}m` : ""}`; };
const datumBijLeeftijd = (p, lftJaren) => absNaarLabel(gebAbs(p) + maandenVan(lftJaren));

// ─── Banksparen & koopsommen (fix-5) ──────────────────────────────────────────
const NU_ABS = JAAR_NU * 12 + new Date().getMonth();
const isProduct = (p) => p.type === "bankspaar" || p.type === "koopsom";

// Jaarlijkse annuïteit: kapitaal gelijkmatig opnemen over n jaar tegen rente r
function annuiteit(kapitaal, rentePct, jaren) {
  if (!kapitaal || !jaren || jaren <= 0) return 0;
  const r = (rentePct ?? 0) / 100;
  return r === 0 ? kapitaal / jaren : (kapitaal * r) / (1 - Math.pow(1 + r, -jaren));
}

// Verwacht kapitaal op de startdatum van de uitkering
function kapitaalBijStart(p, persoon) {
  const startAbs = gebAbs(persoon) + maandenVan(p.startLeeftijd ?? 67);
  const r = (p.rendement ?? 0) / 100;
  const inleg = p.inlegPerJaar ?? 0;
  // Vertrekpunt: verwachte waarde van de aanbieder (als ingevuld), anders huidig saldo
  let basisAbs = NU_ABS, basis = p.saldo ?? 0;
  if (p.verwachteWaarde > 0 && p.verwachtJaar > 0) { basis = p.verwachteWaarde; basisAbs = p.verwachtJaar * 12; }
  const jaren = Math.max(0, (startAbs - basisAbs) / 12);
  const groei = Math.pow(1 + r, jaren);
  const inlegWaarde = r === 0 ? inleg * jaren : inleg * (groei - 1) / r;
  // Inleg tot het peiljaar van de verwachte waarde zit daar al in
  return Math.round(basis * groei + (p.verwachteWaarde > 0 ? 0 : inlegWaarde));
}

// Geeft { bedragJr, kapitaal, totLeeftijd, geschat } voor een product
function productUitkering(p, persoon) {
  if (p.type === "bankspaar") {
    const looptijd = p.looptijd ?? 20;
    const kapitaal = kapitaalBijStart(p, persoon);
    return { bedragJr: annuiteit(kapitaal, p.rente ?? 2, looptijd), kapitaal, totLeeftijd: (p.startLeeftijd ?? 67) + looptijd, geschat: true };
  }
  if (p.type === "koopsom") {
    const looptijd = p.looptijd > 0 ? p.looptijd : null;             // leeg/0 = levenslang
    if (p.uitkeringMnd > 0) return { bedragJr: p.uitkeringMnd * 12, kapitaal: p.koopsom ?? 0, totLeeftijd: looptijd ? p.startLeeftijd + looptijd : null, geschat: false };
    const jaren = looptijd ?? Math.max(5, 90 - (p.startLeeftijd ?? 67)); // levenslang: schatting tot 90
    return { bedragJr: annuiteit(p.koopsom ?? 0, p.rente ?? 2, jaren), kapitaal: p.koopsom ?? 0, totLeeftijd: looptijd ? p.startLeeftijd + looptijd : null, geschat: true };
  }
  return { bedragJr: p.bruto_jaar ?? 0, kapitaal: 0, totLeeftijd: p.totLeeftijd, geschat: false };
}

// Verwachte AOW op de AOW-leeftijd (fix-7)
// AOW bouw je op door in Nederland te WONEN (2% per jaar in de 50 jaar vóór je AOW-leeftijd),
// niet door te werken. Eerder stoppen met werken verandert de AOW dus niet.
// Bron: TeBereiken uit het XML (gaat uit van blijven wonen in NL); anders een schatting.
function berekenAOWBijPensioen(persoon) {
  const { aowSamen, aowAlleen, aowTeBereikenSamen, aowTeBereikenAlleen } = persoon;
  const aowLft = persoon.aowStartLeeftijd ?? 67.25;
  const vol = (samen, alleen) => ({ samen, alleen, pctOpbouw: Math.round(samen / AOW_VOLLEDIG_SAMEN * 100), volledig: samen >= AOW_VOLLEDIG_SAMEN * 0.995 });

  if (aowTeBereikenSamen > 0) return vol(aowTeBereikenSamen, aowTeBereikenAlleen || Math.round(aowTeBereikenSamen * AOW_VOLLEDIG_ALLEEN / AOW_VOLLEDIG_SAMEN));
  if (!aowSamen) return vol(AOW_VOLLEDIG_SAMEN, AOW_VOLLEDIG_ALLEEN);       // geen MPO-data: volledige AOW

  // Schatting: huidige opbouw + 2% per nog te wonen jaar tot de AOW-leeftijd
  const lftNu = lftMaanden(persoon, NU_ABS) / 12;
  let pct = aowSamen / AOW_VOLLEDIG_SAMEN + Math.max(0, aowLft - lftNu) / AOW_MAX_JAREN;
  if (pct > 0.99) pct = 1;                                                  // afrondingsverschillen
  pct = Math.min(1, pct);
  return vol(Math.round(AOW_VOLLEDIG_SAMEN * pct), Math.round(AOW_VOLLEDIG_ALLEEN * pct));
}

// ─── Eerder/later stoppen en pensioeningang (fix-7) ───────────────────────────
// Actuariële schatting met een eenvoudige sterftetafel (Gompertz) en rekenrente.
// Gekalibreerd zodat ingang op 62 i.p.v. 67j3m ≈ 28% lager uitkomt (orde van ABP-factoren).
const ACT = { modaal: 89, spreiding: 9, rente: 0.025 };
const overleving = (x, y) => Math.exp(Math.exp((x - ACT.modaal) / ACT.spreiding) - Math.exp((y - ACT.modaal) / ACT.spreiding));
const pvCache = new Map();
// Contante waarde op leeftijd x van €1/jaar levenslang, vanaf leeftijd s
function pvUitkering(x, s) {
  const key = `${x.toFixed(4)}|${s.toFixed(4)}`;
  if (pvCache.has(key)) return pvCache.get(key);
  let v = 0;
  for (let t = s; t < 110; t += 1 / 12) v += (1 / 12) * Math.pow(1 + ACT.rente, -(t - x)) * overleving(x, t);
  pvCache.set(key, v);
  return v;
}
// Factor waarmee een levenslang pensioen (berekend op rekenleeftijd) wijzigt bij een andere ingang
function ingangsFactor(ingang, rekenLft) {
  if (Math.abs(ingang - rekenLft) < 1e-6) return 1;
  const x = Math.min(ingang, rekenLft);
  return pvUitkering(x, rekenLft) / pvUitkering(x, ingang);
}
const INGANG_TEKST = { standaard: "pensioen op standaardleeftijd", stoppen: "pensioen direct bij stoppen", eigen: "pensioen op eigen leeftijd" };   // fix-9
const MIN_INGANG = 60;      // ABP: vanaf de maand waarin je 60 wordt
const MAX_UITSTEL = 5;      // tot 5 jaar na de AOW-leeftijd
const standAbs = (p) => { const [j, m] = (p.standPer ?? "").split("-").map(Number); return j > 0 ? j * 12 + ((m || 1) - 1) : NU_ABS; };

// Opbouw tot de stopleeftijd, uitgedrukt als jaarbedrag op de rekenleeftijd (lineair tussen
// Opgebouwd op StandPer en TeBereiken; de opbouw loopt hooguit tot rekenleeftijd/AOW-leeftijd)
function opbouwBijStoppen(p, persoon) {
  const opg = p.opgebouwd ?? p.bruto_jaar ?? 0;
  const teb = p.teBereiken ?? opg;
  if (teb <= opg) return opg;
  const g = gebAbs(persoon);
  const eindAbs = g + maandenVan(Math.min(p.startLeeftijd, persoon.aowStartLeeftijd ?? 67.25));
  const stopAbs = g + maandenVan(persoon.pensioenLeeftijd ?? p.startLeeftijd);
  const st = standAbs(p);
  const totaal = eindAbs - st;
  if (totaal <= 0) return teb;
  const gewerkt = Math.max(0, Math.min(stopAbs, eindAbs) - st);
  return opg + (teb - opg) * gewerkt / totaal;
}

function ingangLeeftijd(p, persoon) {
  if (p.totLeeftijd != null) return p.startLeeftijd;                    // tijdelijke uitkering: niet verschuiven
  const modus = persoon.ingangModus ?? "standaard";
  const i = modus === "stoppen" ? persoon.pensioenLeeftijd
          : modus === "eigen"   ? (persoon.ingangLeeftijd ?? p.startLeeftijd)
          : p.startLeeftijd;
  return Math.min((persoon.aowStartLeeftijd ?? 67.25) + MAX_UITSTEL, Math.max(MIN_INGANG, i));
}

// { basis (op rekenleeftijd), ingang, factor, bedrag (levenslang), hoog, laag, aow }
function pensioenDetail(p, persoon) {
  const basis  = opbouwBijStoppen(p, persoon);
  const ingang = ingangLeeftijd(p, persoon);
  const factor = p.totLeeftijd != null ? 1 : ingangsFactor(ingang, p.startLeeftijd);
  const bedrag = basis * factor;
  const aow = persoon.aowStartLeeftijd ?? 67.25;
  let hoog = bedrag, laag = bedrag;
  if (persoon.hoogLaag && p.totLeeftijd == null && ingang < aow - 1e-6) {
    // Hoog tot AOW, daarna 75% daarvan; zelfde contante waarde
    const totaal = pvUitkering(ingang, ingang), naAow = pvUitkering(ingang, aow);
    hoog = bedrag * totaal / (totaal - 0.25 * naAow);
    laag = 0.75 * hoog;
  }
  return { basis, ingang, factor, bedrag, hoog, laag, aow };
}
// Zelfde persoon, maar doorwerken tot de AOW-leeftijd en standaard ingang (referentie)
const doorwerkScenario = (persoon) => ({ ...persoon, pensioenLeeftijd: persoon.aowStartLeeftijd ?? 67.25, ingangModus: "standaard", hoogLaag: false });

// ─── Parsers (ongewijzigd t.o.v. v9) ─────────────────────────────────────────
function parseerJSON(tekst) {
  const data    = JSON.parse(tekst);
  const details = data?.Details?.OuderdomsPensioenDetails?.OuderdomsPensioen ?? [];
  const polisFirstSeen = {}, polisLastSeen = {};
  details.forEach((blok) => {
    const startLft = (blok.Van?.Leeftijd?.Jaren ?? 67) + (blok.Van?.Leeftijd?.Maanden ?? 0) / 12;
    const isLevenslang = !!blok.Tot?.OuderdomsPensioenEvent;
    (blok.IndicatiefPensioen ?? []).forEach((p) => {
      const h = p.HerkenningsNummer; if (!h) return;
      if (!polisFirstSeen[h]) polisFirstSeen[h] = { startLft, naam: p.PensioenUitvoerder, standPer: p.StandPer };
      polisLastSeen[h] = { bedrag: p.Opgebouwd ?? p.TeBereiken ?? 0, opg: p.Opgebouwd ?? null, teb: p.TeBereiken ?? null, isLevenslang, blok };
    });
  });
  const polissen = Object.keys(polisFirstSeen).map(h => ({
    id: `${h}@${polisFirstSeen[h].startLft}`, naam: polisFirstSeen[h].naam, herkenning: h, type: "pensioen",
    bruto_jaar: polisLastSeen[h].bedrag, startLeeftijd: polisFirstSeen[h].startLft,
    opgebouwd: polisLastSeen[h].opg ?? polisLastSeen[h].bedrag, teBereiken: polisLastSeen[h].teb ?? polisLastSeen[h].bedrag,   // fix-7
    totLeeftijd: polisLastSeen[h].isLevenslang ? null : (() => {
      const lb = [...details].reverse().find(b => (b.IndicatiefPensioen ?? []).some(p => p.HerkenningsNummer === h));
      const tot = lb?.Tot?.Leeftijd;
      return tot ? tot.Jaren + (tot.Maanden ?? 0) / 12 : null;
    })(),
    standPer: polisFirstSeen[h].standPer,
  }));
  let aowSamen = 0, aowAlleen = 0, aowStart = 67.25;
  details.forEach((blok) => {
    const a = blok.AOW?.AOWDetailsOpbouw;
    if (a && a.OpgebouwdSamenwonend > aowSamen) {
      aowSamen = a.OpgebouwdSamenwonend; aowAlleen = a.OpgebouwdAlleenstaand;
      aowStart = (blok.Van?.Leeftijd?.Jaren ?? 67) + (blok.Van?.Leeftijd?.Maanden ?? 0) / 12;
    }
  });
  return { pensioenen: polissen, aow: { samen: aowSamen, alleen: aowAlleen, startLeeftijd: aowStart }, naam: null, geboortejaar: null };
}

function parseerXML(tekst) {
  const doc = new DOMParser().parseFromString(tekst, "application/xml");
  const g = (el, tag) => el.getElementsByTagName(tag);
  const t = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
  const naam = t(doc, "Naam") || null;
  const gbStr = t(doc, "Geboortedatum");
  const geboortejaar = gbStr ? parseInt(gbStr.split("-")[0]) : null;
  const geboortemaand = gbStr ? parseInt(gbStr.split("-")[1]) || null : null;
  const levensSituatie = t(doc, "LevensSituatie");
  const samenwonend = levensSituatie ? !/alleen/i.test(levensSituatie) : null;
  const polisFirstSeen = {}, polisLastSeen = {};
  let aowSamen = 0, aowAlleen = 0, aowStart = 67.25, aowTebSamen = 0, aowTebAlleen = 0;
  const blokken = g(doc, "OuderdomsPensioen");
  for (let b = 0; b < blokken.length; b++) {
    const blok = blokken[b];
    const vanEl = g(blok, "Van")[0];
    const startLft = parseInt(vanEl ? t(vanEl, "Jaren") || "67" : "67") + parseInt(vanEl ? t(vanEl, "Maanden") || "0" : "0") / 12;
    const totEl = g(blok, "Tot")[0];
    const isLevenslang = totEl && t(totEl, "Jaren") === "";
    const totLftNum = totEl && t(totEl, "Jaren") !== "" ? parseInt(t(totEl, "Jaren") || "0") + parseInt(t(totEl, "Maanden") || "0") / 12 : null;
    const aowEl = g(blok, "AOWDetailsOpbouw")[0];
    if (aowEl) { const s = parseInt(t(aowEl, "OpgebouwdSamenwonend") || "0"); if (s > aowSamen) { aowSamen = s; aowAlleen = parseInt(t(aowEl, "OpgebouwdAlleenstaand") || "0"); aowStart = startLft; aowTebSamen = parseInt(t(aowEl, "TeBereikenSamenwonend") || "0"); aowTebAlleen = parseInt(t(aowEl, "TeBereikenAlleenstaand") || "0"); } }
    let polissen = g(blok, "IndicatiefPensioen");
    if (polissen.length === 0) polissen = g(blok, "Pensioen");
    for (let p = 0; p < polissen.length; p++) {
      const pEl = polissen[p]; const h = t(pEl, "HerkenningsNummer"); if (!h) continue;
      const opg = parseInt(t(pEl, "Opgebouwd") || "0"), teb = parseInt(t(pEl, "TeBereiken") || "0");
      const bedrag = opg || teb;
      if (!polisFirstSeen[h]) polisFirstSeen[h] = { startLft, naam: t(pEl, "PensioenUitvoerder") || "Onbekend", standPer: t(pEl, "StandPer") };
      polisLastSeen[h] = { bedrag, opg: opg || teb, teb: Math.max(teb, opg), isLevenslang, totLftNum };
    }
  }
  const polissen = Object.keys(polisFirstSeen).map(h => ({
    id: `${h}@${polisFirstSeen[h].startLft}`, naam: polisFirstSeen[h].naam, herkenning: h, type: "pensioen",
    bruto_jaar: polisLastSeen[h].bedrag, startLeeftijd: polisFirstSeen[h].startLft,
    opgebouwd: polisLastSeen[h].opg, teBereiken: polisLastSeen[h].teb,                                // fix-7
    totLeeftijd: polisLastSeen[h].isLevenslang ? null : polisLastSeen[h].totLftNum,
    standPer: polisFirstSeen[h].standPer,
  }));
  // fix-7: partnerpensioen (vóór pensioeningang) — verzekerd (incl. risicodekking) vs. opgebouwd
  const partner = { verzekerd: 0, opgebouwd: 0 };
  const ppTot = g(doc, "PartnerPensioenTotaal")[0];
  if (ppTot) for (const el of Array.from(ppTot.children)) {
    if (el.localName !== "Pensioen" && el.localName !== "IndicatiefPensioen") continue;
    partner.verzekerd += parseInt(t(el, "VerzekerdBedrag") || "0");
    partner.opgebouwd += parseInt(t(el, "OpgebouwdBedrag") || "0");
  }
  return { pensioenen: polissen, aow: { samen: aowSamen, alleen: aowAlleen, startLeeftijd: aowStart, teBereikenSamen: aowTebSamen, teBereikenAlleen: aowTebAlleen }, partner, naam, geboortejaar, geboortemaand, samenwonend };
}

function parseerBestand(inhoud, naam) {
  const lower = naam.toLowerCase();
  if (lower.endsWith(".json")) return parseerJSON(inhoud);
  if (lower.endsWith(".xml"))  return parseerXML(inhoud);
  throw new Error("Gebruik .json of .xml van mijnpensioenoverzicht.nl");
}

const DEFAULT = {
  personen: [], pensioenen: [],
  vermogen: { spaargeld: 0, spaargeldGebruikVanaf: 67, spaargeldPerJaar: 0, woningWaarde: 0, woningGebruikVanaf: 75, woningPerJaar: 0 },
  simulatie: { scenarios: [] },                                   // fix-9
};
// fix-9: oude simulatie (extra aankoop) omzetten naar een koopsom; simulatie = bewaarde scenario's
function normaliseer(d) {
  let pensioenen = d.pensioenen ?? [];
  const oud = d.simulatie ?? {};
  if (oud.aankoopJaar > 0 && d.personen?.length) {
    const oudste = [...d.personen].sort((a, b) => gebAbs(a) - gebAbs(b))[0];
    pensioenen = [...pensioenen, { id: `koopsom_migr_${Date.now()}`, naam: "Extra aankoop (uit oude simulatie)", type: "koopsom", eigenaarId: oudste.id,
      koopsom: oud.aankoopBedrag ?? 0, uitkeringMnd: oud.aankoopUitkering ?? 0, startLeeftijd: (oudste.pensioenLeeftijd ?? 67.25) + oud.aankoopJaar, looptijd: 0, rente: 2 }];
  }
  return { ...d, pensioenen, simulatie: { scenarios: Array.isArray(oud.scenarios) ? oud.scenarios : [] } };
}
const KLEUREN = ["#c9a84c", "#a084c9", "#4caf8a", "#5b9bd5", "#e07b54"];

export default function PensioenApp() {
  const [tab, setTab]                   = useState("profiel");
  const [geladen, setGeladen]           = useState(false);
  const [opgeslagen, setOpgeslagen]     = useState(null);
  const [importStatus, setImportStatus] = useState(null);
  const [prognoseView, setPrognoseView] = useState("tijdlijn");

  // Info-pagina's (fix-4): gekoppeld aan #help / #privacy / #disclaimer
  const INFO = ["help", "privacy", "disclaimer"];
  const leesHash = () => { const h = window.location.hash.replace("#", ""); return INFO.includes(h) ? h : null; };
  const [infoPagina, setInfoPagina] = useState(leesHash);
  useEffect(() => {
    const onHash = () => setInfoPagina(leesHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  function naarInfo(pagina) {
    if (pagina) window.location.hash = pagina;
    else history.replaceState(null, "", window.location.pathname + window.location.search);
    setInfoPagina(pagina);
    window.scrollTo(0, 0);
  }

  const [personen,   setPersonenRaw]   = useState(DEFAULT.personen);
  const [pensioenen, setPensioenenRaw] = useState(DEFAULT.pensioenen);
  const [vermogen,   setVermogenRaw]   = useState(DEFAULT.vermogen);
  const [simulatie,  setSimulatieRaw]  = useState(DEFAULT.simulatie);

  useEffect(() => {
    (async () => {
      try {
        const raw = await dbGet("state");
        const saved = raw ? normaliseer(raw) : null;                  // fix-9
        if (saved) {
          if (saved.personen)   setPersonenRaw(saved.personen);
          if (saved.pensioenen) setPensioenenRaw(saved.pensioenen);
          if (saved.vermogen)   setVermogenRaw(saved.vermogen);
          if (saved.simulatie)  setSimulatieRaw(saved.simulatie);
        }
      } catch (e) { console.warn(e); }
      setGeladen(true);
    })();
  }, []);

  // fix-8: opslaan gebeurt nu op één plek, ná elke wijziging, met de actuele state.
  // Voorheen sloeg elke setter direct op met de (verouderde) waarden van de andere
  // onderdelen. Bij import (setPersonen + setPensioenen) overschreef de tweede opslag
  // daardoor de nieuwe persoon weer, en was die na herladen verdwenen.
  const setPersonen   = setPersonenRaw;
  const setPensioenen = setPensioenenRaw;
  const setVermogen   = setVermogenRaw;
  const setSimulatie  = setSimulatieRaw;
  useEffect(() => {
    if (!geladen) return;                       // niet de opgeslagen data overschrijven tijdens het laden
    dbSet("state", { personen, pensioenen, vermogen, simulatie })
      .then(() => setOpgeslagen(new Date()))
      .catch(e => console.warn(e));
  }, [geladen, personen, pensioenen, vermogen, simulatie]);

  function importeerBestand(e) {
    const file = e.target.files[0]; if (!file) return; e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const result = parseerBestand(ev.target.result, file.name);
        if (!result.pensioenen?.length) { setImportStatus({ ok: false, tekst: "❌ Geen pensioenregelingen gevonden." }); return; }
        let eigenaarId, nieuwePersonen = [...personen];
        // fix-7: AOW te bereiken + partnerpensioen (alleen als het overzicht ze bevat)
        const extra = {
          ...(result.aow.teBereikenSamen > 0 ? { aowTeBereikenSamen: result.aow.teBereikenSamen, aowTeBereikenAlleen: result.aow.teBereikenAlleen } : {}),
          ...(result.partner && result.partner.verzekerd + result.partner.opgebouwd > 0 ? { partnerVerzekerd: result.partner.verzekerd, partnerOpgebouwd: result.partner.opgebouwd } : {}),
        };
        if (result.naam) {
          const bestaand = personen.find(p => p.naam === result.naam);
          if (bestaand) {
            eigenaarId = bestaand.id;
            nieuwePersonen = nieuwePersonen.map(p => p.id === eigenaarId ? { ...p, ...extra, geboortejaar: result.geboortejaar ?? p.geboortejaar, geboortemaand: result.geboortemaand ?? p.geboortemaand, samenwonend: result.samenwonend ?? p.samenwonend, aowSamen: result.aow.samen || p.aowSamen, aowAlleen: result.aow.alleen || p.aowAlleen, aowStartLeeftijd: result.aow.startLeeftijd ?? p.aowStartLeeftijd } : p);
          } else {
            eigenaarId = `persoon_${Date.now()}`;
            nieuwePersonen = [...personen, { id: eigenaarId, naam: result.naam, ...extra, geboortejaar: result.geboortejaar ?? 1970, geboortemaand: result.geboortemaand ?? 1, samenwonend: result.samenwonend ?? undefined, pensioenLeeftijd: result.aow.startLeeftijd ?? 67.25, aowSamen: result.aow.samen, aowAlleen: result.aow.alleen, aowStartLeeftijd: result.aow.startLeeftijd ?? 67.25 }];
          }
        } else {
          if (personen.length === 0) {
            eigenaarId = `persoon_${Date.now()}`;
            nieuwePersonen = [{ id: eigenaarId, naam: "Ik", geboortejaar: 1970, pensioenLeeftijd: result.aow.startLeeftijd ?? 67.25, aowSamen: result.aow.samen, aowAlleen: result.aow.alleen, aowStartLeeftijd: result.aow.startLeeftijd ?? 67.25 }];
          } else {
            const zonder = personen.find(p => !pensioenen.some(x => x.eigenaarId === p.id));
            eigenaarId = zonder?.id ?? personen[0].id;
            nieuwePersonen = nieuwePersonen.map(p => p.id === eigenaarId ? { ...p, aowSamen: result.aow.samen || p.aowSamen, aowAlleen: result.aow.alleen || p.aowAlleen, aowStartLeeftijd: result.aow.startLeeftijd ?? p.aowStartLeeftijd } : p);
          }
        }
        // fix-8: ook pensioenen zonder (bestaande) eigenaar opruimen — achtergebleven door de oude opslagfout
        const bestaandePens = pensioenen.filter(p => p.eigenaarId !== eigenaarId && nieuwePersonen.some(x => x.id === p.eigenaarId));
        const nieuwePens = result.pensioenen.map((p, i) => ({ ...p, id: `${eigenaarId}_${p.herkenning ?? i}_${p.startLeeftijd}`, eigenaarId }));
        setPersonen(nieuwePersonen);
        setPensioenen([...bestaandePens, ...nieuwePens]);
        const naam = nieuwePersonen.find(p => p.id === eigenaarId)?.naam ?? "onbekend";
        setImportStatus({ ok: true, tekst: `✅ ${nieuwePens.length} regelingen ingeladen voor ${naam}${result.aow.samen > 0 ? ` · AOW € ${result.aow.samen.toLocaleString("nl-NL")}/jr` : ""}` });
        setTab("pensioenen");
      } catch (err) { console.error(err); setImportStatus({ ok: false, tekst: `❌ ${err.message}` }); }
    };
    reader.onerror = () => setImportStatus({ ok: false, tekst: "❌ Kon bestand niet lezen" });
    reader.readAsText(file);
  }

  function exporteer() {
    const blob = new Blob([JSON.stringify({ personen, pensioenen, vermogen, simulatie }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `pensioen-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
  }
  function importeerBackup(e) {
    const file = e.target.files[0]; if (!file) return; e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const d = normaliseer(JSON.parse(ev.target.result));          // fix-9
        if (d.personen)   setPersonen(d.personen);
        if (d.pensioenen) setPensioenen(d.pensioenen);
        if (d.vermogen)   setVermogen(d.vermogen);
        if (d.simulatie)  setSimulatie(d.simulatie);
        setImportStatus({ ok: true, tekst: "✅ Backup hersteld" });
      } catch { setImportStatus({ ok: false, tekst: "❌ Ongeldig backup bestand" }); }
    };
    reader.readAsText(file);
  }

  const personenGesorteerd = useMemo(() => [...personen].sort((a, b) => gebAbs(a) - gebAbs(b)), [personen]);

  // Leefsituatie (fix-3): expliciet ingesteld, anders: samen als er >1 persoon is
  const isSamenwonend = (persoon) => persoon.samenwonend ?? (personen.length > 1);

  // ─── Rekenkern per maand (fix-2) ──────────────────────────────────────────────
  // Alle bedragen blijven jaarbedragen (bedragJr); een moment start in de maand
  // waarin de leeftijd bereikt wordt.
  // fix-9: pers = personen met evt. scenario-instellingen (standaard de huidige)
  function berekenMaand(abs, pers = personen) {
    const items = [];
    let totPensioenBruto = 0, totAowBruto = 0, totNetto = 0, totBelasting = 0, totZvw = 0;
    const perPersoon = {};

    pers.forEach((persoon) => {
      const isSamen = isSamenwonend(persoon);
      const lftM = lftMaanden(persoon, abs);
      const eigenaarIdx = personenGesorteerd.findIndex(x => x.id === persoon.id);
      let persoonPensioenBruto = 0;

      pensioenen.filter(p => p.eigenaarId === persoon.id).forEach((p) => {
        let gestart, gestopt, bedrag;
        if (isProduct(p)) {
          const pu = productUitkering(p, persoon);                        // fix-5
          gestart = lftM >= maandenVan(p.startLeeftijd);
          gestopt = pu.totLeeftijd != null && lftM >= maandenVan(pu.totLeeftijd);
          bedrag = pu.bedragJr;
        } else {
          const d = pensioenDetail(p, persoon);                           // fix-7
          gestart = lftM >= maandenVan(d.ingang);
          gestopt = p.totLeeftijd != null && lftM >= maandenVan(p.totLeeftijd);
          bedrag = lftM < maandenVan(d.aow) ? d.hoog : d.laag;
        }
        if (gestart && !gestopt) {
          persoonPensioenBruto += bedrag;
          items.push({ type: "pensioen", naam: p.naam, bedragJr: Math.round(bedrag), eigenaar: persoon.naam, eigenaarIdx, isNetto: false });
        }
      });

      const aowStartM = maandenVan(persoon.aowStartLeeftijd ?? 67.25);
      const aowGerechtigd = lftM >= aowStartM;
      let persoonAowBruto = 0;
      if (aowGerechtigd) {
        const aowBerekend = berekenAOWBijPensioen(persoon);
        persoonAowBruto = isSamen ? aowBerekend.samen : aowBerekend.alleen;
        items.push({ type: "aow", naam: "AOW", bedragJr: Math.round(persoonAowBruto), eigenaar: persoon.naam, eigenaarIdx, isNetto: false, aowVolledig: aowBerekend.volledig, aowPct: aowBerekend.pctOpbouw });
        totAowBruto += persoonAowBruto;
      }

      totPensioenBruto += persoonPensioenBruto;
      const nd = berekenNettoDetail(Math.round(persoonPensioenBruto) + Math.round(persoonAowBruto), aowGerechtigd, !isSamen);
      totNetto += nd.netto; totBelasting += nd.belasting; totZvw += nd.zvw;
      perPersoon[persoon.id] = { lftM, pensioenBruto: persoonPensioenBruto };
    });

    // Vermogen: netto — geen belasting
    const lftOudsteM = personenGesorteerd[0] ? lftMaanden(personenGesorteerd[0], abs) : 0;
    const spaargeld = lftOudsteM >= maandenVan(vermogen.spaargeldGebruikVanaf) ? vermogen.spaargeldPerJaar : 0;
    const woning    = lftOudsteM >= maandenVan(vermogen.woningGebruikVanaf)    ? vermogen.woningPerJaar    : 0;
    if (spaargeld > 0) { items.push({ type: "vermogen", naam: "Spaargeld inzetten", bedragJr: spaargeld, eigenaar: "", eigenaarIdx: -1, isNetto: true }); totNetto += spaargeld; }
    if (woning > 0)    { items.push({ type: "vermogen", naam: "Woning (hypotheek/verkoop)", bedragJr: woning, eigenaar: "", eigenaarIdx: -1, isNetto: true }); totNetto += woning; }

    return {
      totBrutoMnd: Math.round((totPensioenBruto + totAowBruto) / 12),
      totNettoMnd: Math.round(totNetto / 12),
      belastingMnd: Math.round(totBelasting / 12), zvwMnd: Math.round(totZvw / 12),
      totNettoMndZonderVermogen: Math.round((totNetto - spaargeld - woning) / 12),
      spaargeld, woning, items,
      // jaarbedragen voor grafiek/tabel
      pensioenBrutoJr: totPensioenBruto, aowBrutoJr: totAowBruto, nettoJr: totNetto, perPersoon,
    };
  }

  // Eerste maand: vroegste inkomen van wie dan ook (fix-7: ingang kan verschoven zijn)
  const startMaand = useMemo(() => {
    if (personenGesorteerd.length === 0) return JAAR_NU * 12;
    const starts = [];
    personen.forEach(persoon => {
      pensioenen.filter(p => p.eigenaarId === persoon.id).forEach(p =>
        starts.push(gebAbs(persoon) + maandenVan(isProduct(p) ? p.startLeeftijd : ingangLeeftijd(p, persoon))));
    });
    const oudste = personenGesorteerd[0];
    return starts.length > 0 ? Math.min(...starts) : gebAbs(oudste) + maandenVan(oudste.pensioenLeeftijd);
  }, [personen, personenGesorteerd, pensioenen]);
  const startJaar = Math.floor(startMaand / 12);

  // ─── fix-9: kerncijfers van een scenario ──────────────────────────────────────
  // Het salaris zit niet in de app; daarom kijken we vanaf het moment dat jullie
  // ALLEBEI gestopt zijn tot de eindsituatie (alle AOW en pensioenen ingegaan).
  function kerncijfers(pers) {
    if (pers.length === 0) return null;
    const stopAbs = pers.map(p => gebAbs(p) + maandenVan(p.pensioenLeeftijd ?? p.aowStartLeeftijd ?? 67.25));
    const beginAbs = Math.max(...stopAbs);
    let eindAbs = beginAbs;
    pers.forEach(p => {
      eindAbs = Math.max(eindAbs, gebAbs(p) + maandenVan(p.aowStartLeeftijd ?? 67.25));
      pensioenen.filter(x => x.eigenaarId === p.id).forEach(x =>
        eindAbs = Math.max(eindAbs, gebAbs(p) + maandenVan(isProduct(x) ? x.startLeeftijd : ingangLeeftijd(x, p))));
    });
    eindAbs = Math.min(eindAbs, beginAbs + 20 * 12);
    const netto = (abs) => berekenMaand(abs, pers).totNettoMndZonderVermogen;
    const eind = netto(eindAbs);
    let laagste = eind, laagsteAbs = eindAbs, aanvulling = 0;
    for (let a = beginAbs; a < eindAbs; a++) {
      const n = netto(a);
      if (n < laagste) { laagste = n; laagsteAbs = a; }
      aanvulling += Math.max(0, eind - n);
    }
    const pensioenJr = pers.reduce((s, p) => s + pensioenen
      .filter(x => x.eigenaarId === p.id && !isProduct(x) && x.totLeeftijd == null)
      .reduce((t, x) => t + pensioenDetail(x, p).laag, 0), 0);
    // fix-10: per persoon voor de uitleg in gewone woorden
    const info = pers.map((p, i) => {
      const aowAbs = gebAbs(p) + maandenVan(p.aowStartLeeftijd ?? 67.25);
      const eigen = pensioenen.filter(x => x.eigenaarId === p.id);
      const ingangen = eigen.map(x => gebAbs(p) + maandenVan(isProduct(x) ? x.startLeeftijd : ingangLeeftijd(x, p)));
      const pensIngang = eigen.filter(x => !isProduct(x) && x.totLeeftijd == null).map(x => ingangLeeftijd(x, p));
      return { id: p.id, naam: p.naam.split(" ")[0], stopAbs: stopAbs[i], stopLft: p.pensioenLeeftijd ?? p.aowStartLeeftijd ?? 67.25,
        aowAbs, eersteInkomen: Math.min(aowAbs, ...ingangen), modus: p.ingangModus ?? "standaard",
        ingangLft: pensIngang.length ? Math.min(...pensIngang) : null, ingangAbs: pensIngang.length ? gebAbs(p) + maandenVan(Math.min(...pensIngang)) : null,
        laatsteLft: pensIngang.length ? Math.max(...pensIngang) : null, laatsteAbs: pensIngang.length ? gebAbs(p) + maandenVan(Math.max(...pensIngang)) : null,
        hoogLaag: !!p.hoogLaag };
    });
    return { stopAbs, beginAbs, eindAbs, nettoBegin: netto(beginAbs), laagste, laagsteAbs, eind, aanvulling: Math.round(aanvulling), pensioenJr, info };
  }
  const SCEN_VELDEN = ["pensioenLeeftijd", "ingangModus", "ingangLeeftijd", "hoogLaag"];
  const metInstellingen = (inst) => personen.map(p => ({ ...p, ...(inst?.[p.id] ?? {}) }));
  const huidigeInstellingen = () => Object.fromEntries(personen.map(p => [p.id, Object.fromEntries(SCEN_VELDEN.map(k => [k, p[k]]))]));

  // ─── Tijdlijn momenten (per maand) ────────────────────────────────────────────
  const tijdlijnData = useMemo(() => {
    if (personen.length === 0) return [];
    const momenten = [];
    let vorigeHash = null;
    for (let i = 0; i < 35 * 12; i++) {
      const abs = startMaand + i;
      const data = berekenMaand(abs);
      const hash = data.items.map(x => `${x.naam}:${x.eigenaar}:${x.bedragJr}`).join("|");
      if (hash !== vorigeHash) {
        const leeftijdsLabels = personenGesorteerd.map(p => `${p.naam.split(" ")[0]} ${lftLabel(lftMaanden(p, abs))}`).join(" · ");
        momenten.push({ jaar: Math.floor(abs / 12), datumLabel: absNaarLabel(abs), leeftijdsLabels, data });
        vorigeHash = hash;
      }
    }
    return momenten;
  }, [personen, personenGesorteerd, pensioenen, vermogen, simulatie, startMaand]);

  // ─── Chartdata: jaartotalen = som van 12 maanden ─────────────────────────────
  const pensioenmomenten = useMemo(() => personenGesorteerd.map((p, pi) => ({
    jaar: Math.floor((gebAbs(p) + maandenVan(p.pensioenLeeftijd)) / 12), naam: p.naam.split(" ")[0], kleur: KLEUREN[pi % KLEUREN.length],
  })), [personenGesorteerd]);

  const chartData = useMemo(() => {
    if (personen.length === 0) return [];
    return Array.from({ length: 30 }, (_, i) => {
      const jaar = startJaar + i;
      let pens = 0, aow = 0, netto = 0, spaar = 0, won = 0;
      const penPP = {};
      for (let m = 0; m < 12; m++) {
        const d = berekenMaand(jaar * 12 + m);
        pens += d.pensioenBrutoJr / 12; aow += d.aowBrutoJr / 12; netto += d.nettoJr / 12;
        spaar += d.spaargeld / 12; won += d.woning / 12;
        personen.forEach(p => { penPP[p.id] = (penPP[p.id] ?? 0) + d.perPersoon[p.id].pensioenBruto / 12; });
      }
      const totalBruto = Math.round(pens + aow + spaar + won);
      const rij = { jaar, pensioenBruto: Math.round(pens), aowBruto: Math.round(aow), spaargeld: Math.round(spaar), woning: Math.round(won), totalBruto, totalNetto: Math.round(netto), totalNettoMaand: Math.round(netto / 12), totalBrutoMaand: Math.round(totalBruto / 12) };
      personen.forEach(p => {
        const lftDec = lftMaanden(p, jaar * 12 + 11); // leeftijd in december
        rij[`pen_${p.id}`] = Math.round(penPP[p.id] ?? 0);
        rij[`lft_${p.id}`] = lftLabel(lftDec);
        rij[`lftNum_${p.id}`] = lftDec / 12;
      });
      return rij;
    });
  }, [personen, personenGesorteerd, pensioenen, vermogen, simulatie, startJaar]);

  // fix-9: kolommen voor de vergelijking (alleen berekend op het tabblad Simulatie)
  const vergelijking = useMemo(() => {
    if (tab !== "simulatie" || personen.length === 0) return null;
    const kolommen = [
      { id: "door", naam: "Doorwerken tot AOW", pers: personen.map(doorwerkScenario), kleur: "#7a9bb0" },
      { id: "huidig", naam: "Huidige instelling", pers: personen, kleur: "#c9a84c" },
      ...(simulatie.scenarios ?? []).map((sc, i) => ({ id: sc.id, naam: sc.naam, inst: sc.instellingen, pers: metInstellingen(sc.instellingen), kleur: KLEUREN[(i + 1) % KLEUREN.length] })),
    ];
    kolommen.forEach(k => { k.kc = kerncijfers(k.pers); });
    const van = Math.floor(Math.min(...kolommen.map(k => Math.min(...k.kc.stopAbs))) / 12);
    const grafiek = Array.from({ length: 22 }, (_, i) => {
      const jaar = van + i, rij = { jaar };
      kolommen.forEach(k => { let t = 0; for (let m = 0; m < 12; m++) t += berekenMaand(jaar * 12 + m, k.pers).totNettoMndZonderVermogen; rij[k.id] = Math.round(t / 12); });
      return rij;
    });
    return { kolommen, grafiek };
  }, [tab, personen, pensioenen, simulatie]);

  if (!geladen) return <div style={{ background: "#0f1923", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#c9a84c", fontFamily: "Georgia,serif", fontSize: 18 }}>Gegevens laden...</div>;

  return (
    <div style={{ fontFamily: "'Georgia',serif", background: "#0f1923", minHeight: "100vh", color: "#e8dcc8" }}>
      <div style={{ background: "linear-gradient(135deg,#1a2d3d,#0f1923)", borderBottom: "1px solid #2a4a5e", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#c9a84c" }}>🏦 Pensioen Planner <span style={{ fontSize: 11, color: "#555", fontWeight: 400 }}>{FIX_NR}</span></h1>
          <p style={{ margin: "2px 0 0", color: "#7a9bb0", fontSize: 11 }}>Data blijft alleen op jouw apparaat</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {opgeslagen && <span style={{ fontSize: 11, color: "#4caf8a" }}>✓ {opgeslagen.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span>}
          <label style={{ ...btn("#5b9bd5"), cursor: "pointer" }}>📥 Pensioen importeren<input type="file" accept=".json,.xml" onChange={importeerBestand} style={{ display: "none" }} /></label>
          <button onClick={exporteer} style={btn("#c9a84c")}>⬇ Backup</button>
          <button onClick={() => naarInfo("help")} style={btn("#4caf8a")}>❓ Help</button>
          <label style={{ ...btn("#7a9bb0"), cursor: "pointer" }}>⬆ Herstel<input type="file" accept=".json" onChange={importeerBackup} style={{ display: "none" }} /></label>
        </div>
      </div>

      {importStatus && (
        <div style={{ background: importStatus.ok ? "#1a3d2d" : "#3d1a1a", borderBottom: `1px solid ${importStatus.ok ? "#4caf8a" : "#e74c3c"}55`, padding: "10px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: importStatus.ok ? "#4caf8a" : "#e74c3c", fontSize: 13 }}>{importStatus.tekst}</span>
          <button onClick={() => setImportStatus(null)} style={{ background: "transparent", border: "none", color: "#7a9bb0", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      <div style={{ display: "flex", background: "#111d26", borderBottom: "1px solid #2a4a5e", overflowX: "auto" }}>
        {[["profiel","👤 Mijn situatie"],["pensioenen","📄 Pensioenen"],["vermogen","🏠 Vermogen"],["simulatie","🎮 Simulatie"],["prognose","📈 Prognose"]].map(([key, label]) => (
          <button key={key} onClick={() => { setTab(key); if (infoPagina) naarInfo(null); }} style={{ padding: "12px 20px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", background: !infoPagina && tab === key ? "#1a2d3d" : "transparent", color: !infoPagina && tab === key ? "#c9a84c" : "#7a9bb0", borderBottom: !infoPagina && tab === key ? "2px solid #c9a84c" : "2px solid transparent" }}>{label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 20px" }}>

        {/* INFO-PAGINA'S (fix-4) */}
        {infoPagina && (
          <div>
            <button onClick={() => naarInfo(null)} style={{ ...btn("#7a9bb0"), marginBottom: 24 }}>← Terug naar de app</button>
            {infoPagina === "help"       && <HelpPagina naar={naarInfo} />}
            {infoPagina === "privacy"    && <PrivacyPagina />}
            {infoPagina === "disclaimer" && <DisclaimerPagina />}
          </div>
        )}

        {!infoPagina && <>
        {/* PROFIEL */}
        {tab === "profiel" && <Section title="Mijn situatie">
          {personen.length === 0 && (
            <div style={{ padding: 24, background: "#1a2d3d", borderRadius: 12, border: "1px solid #2a4a5e", textAlign: "center", marginBottom: 24 }}>
              <p style={{ color: "#7a9bb0", margin: "0 0 12px" }}>Importeer je pensioenoverzicht om te beginnen.</p>
              <label style={{ ...btn("#5b9bd5"), cursor: "pointer" }}>📥 Importeren<input type="file" accept=".json,.xml" onChange={importeerBestand} style={{ display: "none" }} /></label>
            </div>
          )}
          {personenGesorteerd.map((persoon, pi) => (
            <Inklapbaar key={persoon.id} kleur={KLEUREN[pi % KLEUREN.length]}
              titel={<>{pi === 0 ? "👤 " : "👥 "}{persoon.naam}{pi === 0 && <span style={{ fontSize: 11, color: "#555", marginLeft: 8, fontWeight: 400 }}>· oudste</span>}</>}
              samenvatting={`geb. ${MAANDEN[(persoon.geboortemaand ?? 1) - 1]} ${persoon.geboortejaar} · stopt ${datumBijLeeftijd(persoon, persoon.pensioenLeeftijd)} · ${isSamenwonend(persoon) ? "samenwonend" : "alleenstaand"}`}>
              <Grid>
                <Field label="Naam" value={persoon.naam} onChange={v => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, naam: v } : p))} />
                <Field label="Geboortejaar" value={persoon.geboortejaar} onChange={v => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, geboortejaar: +v } : p))} type="number" />
                <div>
                  <label style={lbl}>Geboortemaand</label>
                  <select value={persoon.geboortemaand ?? 1} onChange={e => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, geboortemaand: +e.target.value } : p))} style={inp}>
                    {MAANDEN.map((m, mi) => <option key={m} value={mi + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Leefsituatie</label>
                  <select value={isSamenwonend(persoon) ? "samen" : "alleen"} onChange={e => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, samenwonend: e.target.value === "samen" } : p))} style={inp}>
                    <option value="samen">Gehuwd / samenwonend</option>
                    <option value="alleen">Alleenstaand</option>
                  </select>
                </div>
                <Field label="AOW vanaf leeftijd" value={persoon.aowStartLeeftijd ?? 67.25} onChange={v => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, aowStartLeeftijd: +v } : p))} type="number" />
              </Grid>
              {/* fix-7: AOW hangt af van wonen in NL, niet van werken */}
              {persoon.aowSamen > 0 && (() => {
                const aow = berekenAOWBijPensioen(persoon);
                const kleur = KLEUREN[pi % KLEUREN.length];
                return (
                  <div style={{ marginTop: 10, marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: "#7a9bb0", marginBottom: 6 }}>
                      AOW (uit mijnpensioenoverzicht) · ingang {datumBijLeeftijd(persoon, persoon.aowStartLeeftijd ?? 67.25)}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(185px,1fr))", gap: 8 }}>
                      <KPI label="Nu opgebouwd — samen" value={`€ ${persoon.aowSamen.toLocaleString("nl-NL")}/jr`} kleur="#4a6a7e" />
                      <KPI label="Verwacht op AOW-leeftijd — samen" value={`€ ${aow.samen.toLocaleString("nl-NL")}/jr`} kleur={aow.volledig ? "#4caf8a" : kleur} />
                      <KPI label="Verwacht op AOW-leeftijd — alleen" value={`€ ${aow.alleen.toLocaleString("nl-NL")}/jr`} kleur={aow.volledig ? "#4caf8a" : kleur} />
                    </div>
                    <div style={{ fontSize: 11, color: aow.volledig ? "#4a6a7e" : "#e07b54", marginTop: 6 }}>
                      {aow.volledig ? "✓ Volledige AOW (100%). " : `⚠ ${aow.pctOpbouw}% — er zitten jaren buiten Nederland in je woonperiode. `}
                      AOW bouw je op door in Nederland te wonen, niet door te werken: eerder stoppen verandert je AOW niet.
                    </div>
                  </div>
                );
              })()}
              {/* fix-9: het scenario zelf staat op het tabblad Simulatie */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#111d26", border: `1px solid ${KLEUREN[pi % KLEUREN.length]}33`, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#b8c8d4" }}>
                <span>🎮 Stopt met werken op <strong style={{ color: KLEUREN[pi % KLEUREN.length] }}>{lftLabel(maandenVan(persoon.pensioenLeeftijd ?? 67.25))}</strong> ({datumBijLeeftijd(persoon, persoon.pensioenLeeftijd ?? 67.25)}) · {INGANG_TEKST[persoon.ingangModus ?? "standaard"]}{persoon.hoogLaag ? " · hoog-laag" : ""}</span>
                <button onClick={() => setTab("simulatie")} style={btn(KLEUREN[pi % KLEUREN.length])}>Aanpassen in Simulatie →</button>
              </div>
              <VerwijderKnop wat={`${persoon.naam} en alle pensioenen van deze persoon`} onVerwijder={() => { setPersonen(personen.filter(p => p.id !== persoon.id)); setPensioenen(pensioenen.filter(p => p.eigenaarId !== persoon.id)); }} />
            </Inklapbaar>
          ))}
          {tijdlijnData.length > 0 && (
            <Inklapbaar titel="📊 Inkomensmomenten" samenvatting={`${tijdlijnData.length} momenten · vanaf ${tijdlijnData[0].datumLabel} € ${tijdlijnData[0].data.totNettoMnd.toLocaleString("nl-NL")} netto/mnd`}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {tijdlijnData.map((m, i) => (
                  <div key={i} style={{ background: "#111d26", border: `1px solid ${KLEUREN[i % KLEUREN.length]}44`, borderRadius: 10, padding: "12px 16px", minWidth: 210 }}>
                    <div style={{ color: KLEUREN[i % KLEUREN.length], fontSize: 12, fontWeight: 600, marginBottom: 2 }}>📍 {m.datumLabel}</div>
                    <div style={{ color: "#7a9bb0", fontSize: 11, marginBottom: 8 }}>{m.leeftijdsLabels}</div>
                    {/* fix-1: componenten per inkomensmoment */}
                    <div style={{ borderTop: "1px solid #2a4a5e", paddingTop: 6, marginBottom: 6 }}>
                      {m.data.items.map((it, ii) => (
                        <div key={ii} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, color: "#b8c8d4", lineHeight: 1.6 }}>
                          <span>{it.naam}{personen.length > 1 && it.eigenaar ? <span style={{ color: "#4a6a7e" }}> · {it.eigenaar.split(" ")[0]}</span> : null}{it.isNetto ? <span style={{ color: "#4a6a7e" }}> (netto)</span> : null}</span>
                          <span style={{ whiteSpace: "nowrap" }}>€ {Math.round(it.bedragJr / 12).toLocaleString("nl-NL")}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#c9a84c", fontSize: 12 }}><span>Bruto</span><span>€ {m.data.totBrutoMnd.toLocaleString("nl-NL")}/mnd</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#e07b54", fontSize: 11 }}><span>− Loonheffing</span><span>€ {m.data.belastingMnd.toLocaleString("nl-NL")}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#e07b54", fontSize: 11, marginBottom: 4 }}><span>− Zvw-bijdrage</span><span>€ {m.data.zvwMnd.toLocaleString("nl-NL")}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#4caf8a", fontSize: 16, fontWeight: 700 }}><span>Netto</span><span>€ {m.data.totNettoMnd.toLocaleString("nl-NL")}/mnd</span></div>
                  </div>
                ))}
              </div>
            </Inklapbaar>
          )}
        </Section>}

        {/* PENSIOENEN */}
        {tab === "pensioenen" && <Section title="Pensioenen & producten">
          {personenGesorteerd.map((persoon, pi) => {
            const eigenPens = pensioenen.filter(p => p.eigenaarId === persoon.id && !isProduct(p));
            const eigenProd = pensioenen.filter(p => p.eigenaarId === persoon.id && isProduct(p));
            const kleur = KLEUREN[pi % KLEUREN.length];
            const nieuw = (type) => setPensioenen([...pensioenen, type === "bankspaar"
              ? { id: `bankspaar_${Date.now()}`, naam: "Banksparen", type, eigenaarId: persoon.id, saldo: 0, inlegPerJaar: 0, rendement: 2, verwachteWaarde: 0, verwachtJaar: 0, startLeeftijd: persoon.aowStartLeeftijd ?? 67, looptijd: 20, rente: 2 }
              : { id: `koopsom_${Date.now()}`, naam: "Koopsom", type, eigenaarId: persoon.id, koopsom: 0, uitkeringMnd: 0, startLeeftijd: persoon.aowStartLeeftijd ?? 67, looptijd: 0, rente: 2 }]);
            const knop = { background: `${kleur}22`, border: `1px solid ${kleur}44`, color: kleur, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 };
            return (
              <Inklapbaar key={persoon.id} kleur={kleur}
                titel={<>{pi === 0 ? "👤" : "👥"} {persoon.naam} <span style={{ fontSize: 11, color: "#7a9bb0", fontWeight: 400 }}>· geb. {MAANDEN[(persoon.geboortemaand ?? 1) - 1]} {persoon.geboortejaar}</span></>}
                samenvatting={`${eigenPens.length} pensioen${eigenPens.length === 1 ? "" : "en"} · ${eigenProd.length} bankspaar/koopsom`}>
                {eigenPens.length === 0 ? <div style={{ padding: 16, color: "#4a6a7e", fontSize: 13, textAlign: "center" }}>Geen pensioenen</div>
                  : eigenPens.map(p => <PensioenRij key={p.id} p={p} persoon={persoon} alle={pensioenen} setPensioenen={setPensioenen} kleur={kleur} />)}
                {/* fix-5: banksparen & koopsommen */}
                <div style={{ color: "#7a9bb0", fontSize: 12, fontWeight: 600, margin: "18px 0 10px" }}>🏦 Banksparen, beleggingsrechten & koopsommen</div>
                {eigenProd.map(p => <ProductRij key={p.id} p={p} persoon={persoon} alle={pensioenen} setPensioenen={setPensioenen} kleur={kleur} />)}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                  <button onClick={() => setPensioenen([...pensioenen, { id: `handmatig_${Date.now()}`, naam: "Nieuw pensioen", type: "pensioen", eigenaarId: persoon.id, bruto_jaar: 0, startLeeftijd: persoon.aowStartLeeftijd ?? 67.25, totLeeftijd: null }])} style={knop}>+ Pensioen</button>
                  <button onClick={() => nieuw("bankspaar")} style={knop}>+ Banksparen / beleggen</button>
                  <button onClick={() => nieuw("koopsom")} style={knop}>+ Koopsom</button>
                </div>
              </Inklapbaar>
            );
          })}
        </Section>}

        {/* VERMOGEN */}
        {tab === "vermogen" && <Section title="Spaargeld & Woning">
          <div style={{ padding: 12, background: "#1a3d2d", borderRadius: 10, border: "1px solid #4caf8a33", marginBottom: 20 }}>
            <p style={{ margin: 0, color: "#4caf8a", fontSize: 13 }}>
              💡 Deze bedragen zijn <strong>netto</strong> — er wordt geen belasting over berekend. Ze worden direct opgeteld bij het netto inkomen.
            </p>
          </div>
          <Inklapbaar titel="💰 Spaargeld inzetten als inkomen" samenvatting={vermogen.spaargeldPerJaar > 0 ? `€ ${vermogen.spaargeldPerJaar.toLocaleString("nl-NL")}/jr vanaf ${vermogen.spaargeldGebruikVanaf} jaar` : "niet ingezet"}>
          <Grid>
            <Field label="Totaal spaargeld (€)" value={vermogen.spaargeld} onChange={v=>setVermogen({...vermogen,spaargeld:+v})} type="number" />
            <Field label="Gebruik vanaf leeftijd oudste" value={vermogen.spaargeldGebruikVanaf} onChange={v=>setVermogen({...vermogen,spaargeldGebruikVanaf:+v})} type="number" />
            <Field label="Per jaar opnemen — netto (€)" value={vermogen.spaargeldPerJaar} onChange={v=>setVermogen({...vermogen,spaargeldPerJaar:+v})} type="number" />
          </Grid>
          </Inklapbaar>
          <Inklapbaar titel="🏠 Woning inzetten als inkomen" samenvatting={vermogen.woningPerJaar > 0 ? `€ ${vermogen.woningPerJaar.toLocaleString("nl-NL")}/jr vanaf ${vermogen.woningGebruikVanaf} jaar` : "niet ingezet"}>
          <p style={{ color: "#7a9bb0", fontSize: 12, marginBottom: 12 }}>Bijv. verzilverhypotheek of verkoop + terughuur. Vul het netto bedrag in dat vrijkomt.</p>
          <Grid>
            <Field label="Woningwaarde (€)" value={vermogen.woningWaarde} onChange={v=>setVermogen({...vermogen,woningWaarde:+v})} type="number" />
            <Field label="Gebruik vanaf leeftijd oudste" value={vermogen.woningGebruikVanaf} onChange={v=>setVermogen({...vermogen,woningGebruikVanaf:+v})} type="number" />
            <Field label="Per jaar vrijmaken — netto (€)" value={vermogen.woningPerJaar} onChange={v=>setVermogen({...vermogen,woningPerJaar:+v})} type="number" />
          </Grid>
          </Inklapbaar>
        </Section>}

        {/* SIMULATIE */}
        {/* SIMULATIE (fix-9): scenario's stoppen met werken */}
        {tab === "simulatie" && <Section title="Simulatie: wanneer stoppen we?">
          {personen.length === 0 ? <p style={{ color: "#7a9bb0" }}>Importeer eerst je pensioenoverzicht.</p> : <>
          <div style={{ padding: 12, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e", marginBottom: 20, fontSize: 13, color: "#b8c8d4", lineHeight: 1.6 }}>
            Speel hier met <strong>wanneer ieder van jullie stopt met werken</strong> en <strong>wanneer het pensioen ingaat</strong>.
            Wat je instelt, werkt direct door in de Prognose. Tevreden over een variant? <strong>Bewaar</strong> hem en vergelijk hem onderaan
            met andere varianten en met doorwerken tot de AOW-leeftijd.
          </div>
          {personenGesorteerd.map((persoon, pi) => (
            <StopScenario key={persoon.id} sub={false} persoon={persoon} kleur={KLEUREN[pi % KLEUREN.length]}
              titel={<>{pi === 0 ? "👤" : "👥"} {persoon.naam}</>}
              pensioenen={pensioenen.filter(p => p.eigenaarId === persoon.id && !isProduct(p))}
              partnerNaam={personen.find(p => p.id !== persoon.id)?.naam?.split(" ")[0]}
              update={(velden) => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, ...velden } : p))} />
          ))}
          {vergelijking && <>
            <Inklapbaar titel="⚖️ Vergelijken" samenvatting={`${vergelijking.kolommen.length - 2} bewaard`}>
              <BewaarScenario standaardNaam={personenGesorteerd.map(p => `${p.naam.split(" ")[0]} ${lftLabel(maandenVan(p.pensioenLeeftijd ?? 67.25))}`).join(" · ")}
                onBewaar={naam => setSimulatie({ ...simulatie, scenarios: [...(simulatie.scenarios ?? []), { id: `sc_${Date.now()}`, naam, instellingen: huidigeInstellingen() }] })} />
              <ScenarioVergelijking kolommen={vergelijking.kolommen} personenGesorteerd={personenGesorteerd}
                onToepassen={inst => setPersonen(metInstellingen(inst))}
                onVerwijder={id => setSimulatie({ ...simulatie, scenarios: simulatie.scenarios.filter(x => x.id !== id) })} />
            </Inklapbaar>
            <Inklapbaar titel="📈 Netto per maand per scenario" samenvatting="gemiddeld per jaar">
              <div style={{ fontSize: 11, color: "#4a6a7e", marginBottom: 8 }}>Pensioen + AOW na belasting, zonder salaris en zonder spaargeld/woning.</div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={vergelijking.grafiek}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a4a5e" />
                  <XAxis dataKey="jaar" stroke="#7a9bb0" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#7a9bb0" tick={{ fontSize: 11 }} tickFormatter={v => `€${(v / 1000).toFixed(1)}k`} />
                  <Tooltip formatter={v => [`€ ${Number(v).toLocaleString("nl-NL")}/mnd`]} contentStyle={{ background: "#0f1923", border: "1px solid #2a4a5e", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {vergelijking.kolommen.map(k => <Line key={k.id} type="stepAfter" dataKey={k.id} name={k.naam} stroke={k.kleur} strokeWidth={k.id === "huidig" ? 2.5 : 1.5} strokeDasharray={k.id === "door" ? "5 3" : undefined} dot={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </Inklapbaar>
          </>}
          <div style={{ fontSize: 12, color: "#7a9bb0", marginTop: 4 }}>
            💶 Extra pensioen kopen (bijv. met spaargeld)? Voeg bij <a href="#" onClick={e => { e.preventDefault(); setTab("pensioenen"); }} style={{ color: "#c9a84c" }}>Pensioenen</a> een <strong>koopsom</strong> toe; die telt dan mee in alle scenario's.
          </div>
          </>}
        </Section>}

        {/* PROGNOSE */}
        {tab === "prognose" && <Section title="Inkomensprognose">
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <button onClick={() => setPrognoseView("tijdlijn")} style={{ ...btn(prognoseView === "tijdlijn" ? "#c9a84c" : "#3a5a6e"), fontWeight: prognoseView === "tijdlijn" ? 700 : 400 }}>📋 Tijdlijn</button>
            <button onClick={() => setPrognoseView("grafiek")}  style={{ ...btn(prognoseView === "grafiek"  ? "#c9a84c" : "#3a5a6e"), fontWeight: prognoseView === "grafiek"  ? 700 : 400 }}>📈 Grafiek & tabel</button>
          </div>

          {prognoseView === "tijdlijn" && (
            <div>
              {/* fix-7: stopleeftijd per persoon met schuifregelaar */}
              <ScenarioBalk personenGesorteerd={personenGesorteerd} personen={personen} setPersonen={setPersonen} />
              <div style={{ position: "relative", paddingLeft: 24 }}>
                <div style={{ position: "absolute", left: 8, top: 12, bottom: 12, width: 2, background: "#2a4a5e", borderRadius: 1 }} />
                {tijdlijnData.map((moment, mi) => (
                  <TijdlijnMoment key={`${moment.datumLabel}-${mi}`} moment={moment} mi={mi} personenGesorteerd={personenGesorteerd} KLEUREN={KLEUREN} />
                ))}
              </div>
            </div>
          )}

          {prognoseView === "grafiek" && (
            <>
              {/* fix-7: stopleeftijd per persoon met schuifregelaar */}
              <ScenarioBalk personenGesorteerd={personenGesorteerd} personen={personen} setPersonen={setPersonen} />
              <Inklapbaar titel="📈 Grafiek" samenvatting="bruto, netto en AOW per jaar">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a4a5e" />
                    <XAxis dataKey="jaar" stroke="#7a9bb0" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#7a9bb0" tick={{ fontSize: 11 }} tickFormatter={v=>`€${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={v=>[`€ ${Number(v).toLocaleString("nl-NL")}`]} contentStyle={{ background: "#0f1923", border: "1px solid #2a4a5e", borderRadius: 8, fontSize: 12 }} />
                    <Legend />
                    {pensioenmomenten.map((m, i) => <ReferenceLine key={i} x={m.jaar} stroke={m.kleur} strokeDasharray="4 2" label={{ value: m.naam, position: "insideTopLeft", fill: m.kleur, fontSize: 10 }} />)}
                    <Line type="monotone" dataKey="totalBruto" name="Bruto" stroke="#c9a84c" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="totalNetto" name="Netto" stroke="#4caf8a" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="aowBruto"   name="AOW"   stroke="#5b9bd5" strokeWidth={1} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </Inklapbaar>
              <Inklapbaar titel="📋 Tabel per jaar" samenvatting={`${chartData.length} jaar`}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#1a2d3d" }}>
                      <th style={th}>Jaar</th>
                      {personenGesorteerd.map((p, pi) => <th key={p.id} style={{ ...th, color: KLEUREN[pi % KLEUREN.length] }}>{p.naam.split(" ")[0]} lft</th>)}
                      <th style={th}>Pensioen/jr</th><th style={th}>AOW/jr</th>
                      <th style={{ ...th, color: "#4caf8a" }}>Spaar netto/jr</th>
                      <th style={{ ...th, color: "#4caf8a" }}>Woning netto/jr</th>
                      <th style={th}>Bruto/mnd</th><th style={th}>Netto/mnd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((r, i) => {
                      const isMoment = pensioenmomenten.some(m => m.jaar === r.jaar);
                      return (
                        <tr key={i} style={{ background: isMoment ? "#1a2d1a" : i % 2 === 0 ? "#111d26" : "#0f1923", borderTop: isMoment ? "2px solid #4caf8a44" : undefined }}>
                          <td style={{ ...cel, color: isMoment ? "#4caf8a" : "#e8dcc8", fontWeight: isMoment ? 700 : 400 }}>{r.jaar}{isMoment ? " 📍" : ""}</td>
                          {personenGesorteerd.map((p, pi) => <td key={p.id} style={{ ...cel, color: r[`lftNum_${p.id}`] >= p.pensioenLeeftijd ? KLEUREN[pi % KLEUREN.length] : "#4a6a7e" }}>{r[`lft_${p.id}`]}</td>)}
                          <td style={cel}>€ {r.pensioenBruto.toLocaleString("nl-NL")}</td>
                          <td style={cel}>€ {r.aowBruto.toLocaleString("nl-NL")}</td>
                          <td style={{ ...cel, color: r.spaargeld > 0 ? "#4caf8a" : "#4a6a7e" }}>{r.spaargeld > 0 ? `€ ${r.spaargeld.toLocaleString("nl-NL")}` : "—"}</td>
                          <td style={{ ...cel, color: r.woning > 0 ? "#4caf8a" : "#4a6a7e" }}>{r.woning > 0 ? `€ ${r.woning.toLocaleString("nl-NL")}` : "—"}</td>
                          <td style={{ ...cel, color: "#c9a84c" }}>€ {r.totalBrutoMaand.toLocaleString("nl-NL")}</td>
                          <td style={{ ...cel, color: "#4caf8a", fontWeight: 600 }}>€ {r.totalNettoMaand.toLocaleString("nl-NL")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </Inklapbaar>
            </>
          )}
        </Section>}
        </>}
      </div>

      {/* Voettekst (fix-4) */}
      <footer style={{ borderTop: "1px solid #2a4a5e", padding: "18px 20px 28px", textAlign: "center", fontSize: 12, color: "#4a6a7e" }}>
        {[["help", "Help"], ["privacy", "Privacy"], ["disclaimer", "Disclaimer"]].map(([k, l], i) => (
          <span key={k}>{i > 0 && " · "}<a href={`#${k}`} onClick={e => { e.preventDefault(); naarInfo(k); }} style={{ color: "#7a9bb0" }}>{l}</a></span>
        ))}
        <div style={{ marginTop: 6 }}>Indicatieve berekening — aan de uitkomsten kunnen geen rechten worden ontleend.</div>
      </footer>
    </div>
  );
}

// ─── TijdlijnMoment ───────────────────────────────────────────────────────────
function TijdlijnMoment({ moment, mi, personenGesorteerd, KLEUREN }) {
  const [open, setOpen] = useState(mi === 0);
  const kleur = KLEUREN[mi % KLEUREN.length];
  const { data } = moment;

  // Groepeer pensioen+aow per eigenaar, vermogen apart
  const perEigenaar = {};
  data.items.filter(x => x.type !== "vermogen").forEach(item => {
    const key = item.eigenaar || "Algemeen";
    if (!perEigenaar[key]) perEigenaar[key] = { items: [], eigenaarIdx: item.eigenaarIdx };
    perEigenaar[key].items.push(item);
  });
  const vermogenItems = data.items.filter(x => x.type === "vermogen");

  return (
    <div style={{ marginBottom: 12, position: "relative" }}>
      <div style={{ position: "absolute", left: -20, top: 18, width: 12, height: 12, borderRadius: "50%", background: open ? kleur : "#2a4a5e", border: `2px solid ${kleur}`, transition: "background 0.2s" }} />

      <button onClick={() => setOpen(!open)} style={{
        width: "100%", textAlign: "left", background: open ? "#1a2d3d" : "#111d26",
        border: `1px solid ${open ? kleur + "66" : "#2a4a5e"}`,
        borderRadius: open ? "10px 10px 0 0" : 10,
        padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
        transition: "all 0.2s",
      }}>
        <div>
          <div style={{ color: kleur, fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{open ? "▼ " : "▶ "}Vanaf {moment.datumLabel}</div>
          <div style={{ color: "#7a9bb0", fontSize: 12 }}>{moment.leeftijdsLabels}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#4caf8a", fontSize: 20, fontWeight: 700 }}>€ {data.totNettoMnd.toLocaleString("nl-NL")}</div>
          <div style={{ color: "#7a9bb0", fontSize: 11 }}>netto per maand</div>
        </div>
      </button>

      {open && (
        <div style={{ background: "#1a2d3d", border: `1px solid ${kleur}44`, borderTop: "none", borderRadius: "0 0 10px 10px", padding: "0 18px 18px" }}>

          {/* Per persoon: AOW + pensioenen */}
          {Object.entries(perEigenaar).map(([eigenaar, groep]) => {
            const pi = groep.eigenaarIdx;
            const ec = pi >= 0 ? KLEUREN[pi % KLEUREN.length] : "#7a9bb0";
            const aowItems      = groep.items.filter(x => x.type === "aow");
            const pensioenItems = groep.items.filter(x => x.type === "pensioen");
            const subtotaal     = groep.items.reduce((s, x) => s + x.bedragJr, 0);
            return (
              <div key={eigenaar} style={{ marginTop: 16 }}>
                <div style={{ color: ec, fontSize: 12, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${ec}22` }}>
                  {pi === 0 ? "👤" : "👥"} {eigenaar}
                </div>
                {aowItems.map((item, i) => (
                  <RegelItem key={`aow${i}`} label="AOW" sublabel={item.aowVolledig ? "Sociale Verzekeringsbank · volledig opgebouwd" : `Sociale Verzekeringsbank · ${item.aowPct}% opgebouwd`} bedrag={item.bedragJr} kleur={item.aowVolledig ? "#5b9bd5" : "#e07b54"} tag="bruto" />
                ))}
                {pensioenItems.length > 0 && (
                  <div style={{ color: "#7a9bb0", fontSize: 11, margin: "8px 0 4px" }}>{pensioenItems.length} pensioen{pensioenItems.length > 1 ? "en" : ""}</div>
                )}
                {pensioenItems.map((item, i) => (
                  <RegelItem key={`pen${i}`} label={item.naam} bedrag={item.bedragJr} kleur="#e8dcc8" tag="bruto" />
                ))}
              </div>
            );
          })}

          {/* Vermogen — apart blok, duidelijk netto gelabeld */}
          {vermogenItems.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ color: "#4caf8a", fontSize: 12, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #4caf8a22" }}>
                💰 Vermogen inzetten
              </div>
              {vermogenItems.map((item, i) => (
                <RegelItem key={`verm${i}`} label={item.naam} sublabel="Netto — geen belasting over berekend" bedrag={item.bedragJr} kleur="#4caf8a" tag="netto" />
              ))}
            </div>
          )}

          {/* Totaalregel */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${kleur}33` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "#c9a84c", fontSize: 13 }}>Totaal pensioen + AOW</span>
              <span style={{ color: "#c9a84c", fontSize: 13 }}>€ {data.totBrutoMnd.toLocaleString("nl-NL")} bruto/mnd</span>
            </div>
            {(data.spaargeld > 0 || data.woning > 0) && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "#4caf8a", fontSize: 13 }}>Vermogen (netto)</span>
                <span style={{ color: "#4caf8a", fontSize: 13 }}>+ € {Math.round((data.spaargeld + data.woning) / 12).toLocaleString("nl-NL")}/mnd</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: `1px solid ${kleur}22` }}>
              <div>
                <div style={{ color: "#7a9bb0", fontSize: 11 }}>Dit is omgerekend:</div>
                {(data.spaargeld > 0 || data.woning > 0) && (
                  <div style={{ color: "#7a9bb0", fontSize: 10 }}>Zonder vermogen: € {data.totNettoMndZonderVermogen.toLocaleString("nl-NL")}/mnd</div>
                )}
              </div>
              <div style={{ color: "#4caf8a", fontSize: 20, fontWeight: 700 }}>€ {data.totNettoMnd.toLocaleString("nl-NL")} netto/mnd</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RegelItem({ label, sublabel, bedrag, kleur, tag }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #2a4a5e22" }}>
      <div>
        <div style={{ color: kleur, fontSize: 13 }}>{label}</div>
        {sublabel && <div style={{ color: "#4a6a7e", fontSize: 11 }}>{sublabel}</div>}
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ color: "#e8dcc8", fontSize: 13 }}>€ {bedrag.toLocaleString("nl-NL")}</div>
        <div style={{ color: "#4a6a7e", fontSize: 11 }}>{tag} per jaar</div>
      </div>
    </div>
  );
}

// ─── fix-9: huidig scenario bewaren onder een naam ────────────────────────────
function BewaarScenario({ standaardNaam, onBewaar }) {
  const [naam, setNaam] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
      <input value={naam} placeholder={standaardNaam} onChange={e => setNaam(e.target.value)} style={{ ...inp, flex: "1 1 200px", width: "auto" }} aria-label="Naam van het scenario" />
      <button onClick={() => { onBewaar(naam.trim() || standaardNaam); setNaam(""); }} style={btn("#4caf8a")}>💾 Huidige instelling bewaren</button>
    </div>
  );
}

// ─── fix-9: scenario's naast elkaar ───────────────────────────────────────────
function ScenarioVergelijking({ kolommen, personenGesorteerd, onToepassen, onVerwijder }) {
  const euro = (v) => `€ ${Math.round(v).toLocaleString("nl-NL")}`;
  const ref = kolommen[0].kc;
  const delta = (v, r) => { const d = Math.round(v - r); return d === 0 ? null : <div style={{ fontSize: 10, color: d < 0 ? "#e07b54" : "#4caf8a" }}>{d < 0 ? "−" : "+"}{euro(Math.abs(d))}</div>; };
  const rijen = [
    ...personenGesorteerd.map((p) => ({ label: `${p.naam.split(" ")[0]} stopt`, cel: (k) => {
      const q = k.pers.find(x => x.id === p.id);
      return <>{lftLabel(maandenVan(q.pensioenLeeftijd ?? 67.25))}<div style={{ fontSize: 10, color: "#4a6a7e" }}>{datumBijLeeftijd(q, q.pensioenLeeftijd ?? 67.25)}{q.hoogLaag ? " · hoog-laag" : ""}</div><div style={{ fontSize: 10, color: "#4a6a7e" }}>{INGANG_TEKST[q.ingangModus ?? "standaard"].replace("pensioen ", "")}</div></>;
    } })),
    { label: "Allebei gestopt", cel: (k) => absNaarLabel(k.kc.beginAbs) },
    { label: "Netto/mnd direct daarna", cel: (k) => <>{euro(k.kc.nettoBegin)}{k.id !== "door" && delta(k.kc.nettoBegin, ref.nettoBegin)}</> },
    { label: "Laagste netto/mnd", cel: (k) => <>{euro(k.kc.laagste)}<div style={{ fontSize: 10, color: "#4a6a7e" }}>{absNaarLabel(k.kc.laagsteAbs)}</div></> },
    { label: "Netto/mnd eindsituatie", sub: "alle AOW en pensioenen ingegaan", cel: (k) => <>{euro(k.kc.eind)}<div style={{ fontSize: 10, color: "#4a6a7e" }}>vanaf {absNaarLabel(k.kc.eindAbs)}</div>{k.id !== "door" && delta(k.kc.eind, ref.eind)}</> },
    { label: "Aanvulling nodig", sub: "om tot de eindsituatie al op dat niveau te leven", cel: (k) => <span style={{ color: k.kc.aanvulling > 0 ? "#e07b54" : undefined }}>{euro(k.kc.aanvulling)}</span> },
    { label: "Levenslang pensioen", sub: "bruto per jaar, vanaf AOW", cel: (k) => <>{euro(k.kc.pensioenJr)}{k.id !== "door" && delta(k.kc.pensioenJr, ref.pensioenJr)}</> },
  ];
  const volgorde = (k) => personenGesorteerd.map(p => k.kc.info.find(x => x.id === p.id)).filter(Boolean);
  return (
    <div>
      {/* fix-10: eerst in gewone woorden, daarna de cijfers op een rij */}
      <div style={{ fontSize: 13, color: "#b8c8d4", lineHeight: 1.6, marginBottom: 12 }}>
        Hieronder staat per plan in gewone woorden wat het betekent. Elk plan wordt vergeleken met
        <strong> doorwerken tot de AOW-leeftijd</strong> (allebei werken tot de AOW, pensioenen op de gewone leeftijd).
      </div>
      {kolommen.filter(k => k.id !== "door").map((k, i) => (
        <Inklapbaar key={k.id} sub kleur={k.kleur} standaardOpen={i === 0} titel={<>📖 {k.naam}</>} samenvatting={`€ ${Math.round(k.kc.eind).toLocaleString("nl-NL")} netto/mnd als alles is ingegaan`}>
          <UitlegScenario k={k} ref_={kolommen[0]} personen={volgorde(k)} />
        </Inklapbaar>
      ))}
      <div style={{ color: "#7a9bb0", fontSize: 12, fontWeight: 600, margin: "18px 0 8px" }}>📊 De cijfers op een rij</div>
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}>
        <thead><tr>
          <th style={{ ...thK, textAlign: "left", position: "sticky", left: 0, background: "#1a2d3d" }}></th>
          {kolommen.map(k => (
            <th key={k.id} style={{ ...thK, color: k.kleur, minWidth: 108, verticalAlign: "top" }}>
              {k.naam}
              {k.inst && <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 6, flexWrap: "wrap" }}>
                <button onClick={() => onToepassen(k.inst)} style={{ ...btn(k.kleur), padding: "3px 8px", fontSize: 11 }}>Toepassen</button>
                <VerwijderKnop compact wat={`"${k.naam}"`} onVerwijder={() => onVerwijder(k.id)} />
              </div>}
            </th>
          ))}
        </tr></thead>
        <tbody>
          {rijen.map((r, ri) => (
            <tr key={ri} style={{ borderTop: "1px solid #2a4a5e55" }}>
              <td style={{ ...celK, textAlign: "left", color: "#b8c8d4", position: "sticky", left: 0, background: "#1a2d3d", minWidth: 110 }}>{r.label}{r.sub && <div style={{ fontSize: 10, color: "#4a6a7e" }}>{r.sub}</div>}</td>
              {kolommen.map(k => <td key={k.id} style={{ ...celK, color: k.id === "huidig" ? "#e8dcc8" : "#a0b8c8" }}>{r.cel(k)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      <div style={{ fontSize: 11, color: "#4a6a7e", marginTop: 8 }}>
        Bedragen: pensioen + AOW na belasting, voor jullie samen, zonder salaris, spaargeld en woning. Verschillen (rood/groen) zijn t.o.v. doorwerken tot de AOW-leeftijd.
        Stopt een van jullie eerder dan de ander, dan valt diens salaris in de tussentijd weg; dat rekent de app niet mee.
      </div>
      <Inklapbaar sub kleur="#7a9bb0" standaardOpen={false} titel="❓ Hoe lees je de tabel?">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#b8c8d4", lineHeight: 1.7 }}>
          <li><strong>… stopt</strong> — wanneer iemand stopt met werken, en wanneer het pensioen ingaat.</li>
          <li><strong>Allebei gestopt</strong> — de maand waarin de laatste van jullie stopt. Vanaf dan is er geen salaris meer.</li>
          <li><strong>Netto/mnd direct daarna</strong> — wat jullie samen per maand overhouden in die eerste maand zonder salaris.</li>
          <li><strong>Laagste netto/mnd</strong> — de krapste maand na het stoppen, en wanneer die is.</li>
          <li><strong>Netto/mnd eindsituatie</strong> — wat jullie per maand hebben als alle AOW en pensioenen zijn ingegaan. Dit bedrag blijft daarna (ongeveer) zo.</li>
          <li><strong>Aanvulling nodig</strong> — hoeveel spaargeld je in totaal nodig hebt om in de tussentijd al van het eindbedrag te leven. Bij doorwerken is dat € 0, want dan gaat alles meteen in.</li>
          <li><strong>Levenslang pensioen</strong> — jullie pensioenen samen per jaar, bruto, zonder AOW. Eerder stoppen of eerder laten ingaan maakt dit bedrag voor de rest van je leven lager.</li>
          <li><strong>Rood/groen getal</strong> — hoeveel minder (rood) of meer (groen) dan bij doorwerken tot de AOW-leeftijd.</li>
        </ul>
      </Inklapbaar>
    </div>
  );
}

// ─── fix-10: één scenario uitgelegd in gewone woorden ────────────────────────
function UitlegScenario({ k, ref_, personen }) {
  const kc = k.kc, rk = ref_.kc;
  const euro = (v) => `€ ${Math.round(v).toLocaleString("nl-NL")}`;
  const ongeveer = (v) => euro(v >= 10000 ? Math.round(v / 1000) * 1000 : Math.round(v / 100) * 100);
  const duur = (m) => m >= 12 ? `${Math.floor(m / 12)} jaar${m % 12 ? ` en ${m % 12} maanden` : ""}` : `${m} maand${m === 1 ? "" : "en"}`;
  const zin = { marginBottom: 8 };
  const stop = (p) => `${p.naam} stopt in ${absNaarLabel(p.stopAbs)} (${lftLabel(maandenVan(p.stopLft))})`;
  const ingang = (p) => p.ingangAbs == null ? null
    : p.modus === "stoppen" ? <>Het pensioen van {p.naam} gaat <strong>direct bij het stoppen</strong> in.</>
    : maandenVan(p.laatsteLft) > maandenVan(p.ingangLft)
      ? <>Het eerste pensioen van {p.naam} gaat in op {lftLabel(maandenVan(p.ingangLft))} ({absNaarLabel(p.ingangAbs)}), het laatste op {lftLabel(maandenVan(p.laatsteLft))} ({absNaarLabel(p.laatsteAbs)}).</>
      : <>Het pensioen van {p.naam} gaat in op {lftLabel(maandenVan(p.ingangLft))} ({absNaarLabel(p.ingangAbs)}).</>;
  const zelfde = Math.round(kc.eind) === Math.round(rk.eind) && kc.beginAbs === rk.beginAbs && Math.round(kc.pensioenJr) === Math.round(rk.pensioenJr);
  if (zelfde) return <div style={{ fontSize: 13, color: "#b8c8d4" }}>Dit plan is hetzelfde als doorwerken tot de AOW-leeftijd. Vanaf {absNaarLabel(kc.eindAbs)} is alles ingegaan en hebben jullie samen <strong>{euro(kc.eind)} netto per maand</strong>.</div>;

  const verschil = Math.round(kc.eind - rk.eind);
  const pensVerschil = Math.round(kc.pensioenJr - rk.pensioenJr);
  const eerste = personen.reduce((a, b) => (b.stopAbs < a.stopAbs ? b : a));
  const laatste = personen.reduce((a, b) => (b.stopAbs > a.stopAbs ? b : a));
  const hoogLaag = personen.filter(p => p.hoogLaag);
  return (
    <div style={{ fontSize: 13, color: "#d4dde4", lineHeight: 1.6 }}>
      <p style={zin}>
        <strong>Wanneer:</strong> {personen.map(stop).join(", ")}.{" "}
        {personen.map(p => <span key={p.id}>{ingang(p)} </span>)}
      </p>
      {personen.filter(p => p.eersteInkomen > p.stopAbs).map(p => (
        <p key={p.id} style={{ ...zin, color: "#e0a07b" }}>
          ⚠ {p.naam} heeft na het stoppen <strong>{duur(p.eersteInkomen - p.stopAbs)} géén eigen inkomen</strong>: nog geen pensioen en nog geen AOW (tot {absNaarLabel(p.eersteInkomen)}).
        </p>
      ))}
      {eerste.stopAbs < laatste.stopAbs && (
        <p style={{ ...zin, color: "#7a9bb0" }}>
          Van {absNaarLabel(eerste.stopAbs)} tot {absNaarLabel(laatste.stopAbs)} werkt alleen {laatste.naam} nog. Dat salaris zit niet in de app, dus die periode telt hier niet mee.
        </p>
      )}
      <p style={zin}>
        <strong>Zodra jullie allebei gestopt zijn</strong> ({absNaarLabel(kc.beginAbs)}), hebben jullie samen <strong>{euro(kc.nettoBegin)} netto per maand</strong>.
        {kc.laagste < kc.nettoBegin - 1 && <> Het krapst is het in {absNaarLabel(kc.laagsteAbs)}: {euro(kc.laagste)} per maand.</>}
      </p>
      <p style={zin}>
        <strong>Vanaf {absNaarLabel(kc.eindAbs)} is alles ingegaan</strong> (AOW en alle pensioenen). Dan hebben jullie <strong>{euro(kc.eind)} netto per maand</strong>.{" "}
        {verschil === 0 ? <>Dat is evenveel als bij doorwerken tot de AOW-leeftijd.</>
          : <>Dat is <strong style={{ color: verschil < 0 ? "#e07b54" : "#4caf8a" }}>{euro(Math.abs(verschil))} {verschil < 0 ? "minder" : "meer"}</strong> dan bij doorwerken tot de AOW-leeftijd ({euro(rk.eind)}), en dat verschil blijft de rest van jullie leven.</>}
      </p>
      {kc.aanvulling > 0 && (
        <p style={zin}>
          <strong>Spaargeld:</strong> willen jullie tussen {absNaarLabel(kc.beginAbs)} en {absNaarLabel(kc.eindAbs)} al van {euro(kc.eind)} per maand leven?
          Dan hebben jullie daarvoor in totaal <strong style={{ color: "#e07b54" }}>ongeveer {ongeveer(kc.aanvulling)}</strong> spaargeld nodig.
        </p>
      )}
      {hoogLaag.length > 0 && (
        <p style={zin}>
          <strong>Hoog-laag</strong> ({hoogLaag.map(p => p.naam).join(" en ")}): tot de AOW-leeftijd een hoger pensioen, daarna 75% daarvan.
          Daardoor is de tussenperiode minder krap, maar is het pensioen daarna lager.
        </p>
      )}
      {pensVerschil !== 0 && (
        <p style={{ ...zin, marginBottom: 0, color: "#7a9bb0" }}>
          Het pensioen zelf (zonder AOW) is levenslang {euro(Math.abs(pensVerschil))} per jaar bruto {pensVerschil < 0 ? "lager" : "hoger"} dan bij doorwerken.
        </p>
      )}
    </div>
  );
}

// ─── fix-7: balk op Prognose om per persoon met de stopleeftijd te spelen ─────
function ScenarioBalk({ personenGesorteerd, personen, setPersonen }) {
  if (personenGesorteerd.length === 0) return null;
  const tekst = INGANG_TEKST;
  return (
    <div style={{ padding: "12px 14px 4px", background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e", marginBottom: 20 }}>
      <div style={{ color: "#7a9bb0", fontSize: 12, marginBottom: 8 }}>🎮 Stoppen met werken — schuif en zie direct het effect <span style={{ color: "#4a6a7e" }}>(meer opties en vergelijken: tabblad Simulatie)</span></div>
      {personenGesorteerd.map((persoon, pi) => {
        const kleur = KLEUREN[pi % KLEUREN.length];
        const aowLft = persoon.aowStartLeeftijd ?? 67.25;
        return (
          <LeeftijdSchuif key={persoon.id} persoon={persoon} kleur={kleur} min={55} max={aowLft + MAX_UITSTEL}
            label={`${persoon.naam.split(" ")[0]} · ${tekst[persoon.ingangModus ?? "standaard"]}${persoon.hoogLaag ? " · hoog-laag" : ""}`}
            waarde={persoon.pensioenLeeftijd ?? aowLft}
            onChange={v => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, pensioenLeeftijd: v } : p))} />
        );
      })}
    </div>
  );
}

// ─── fix-7: schuifregelaar voor een leeftijd (per maand) ─────────────────────
function LeeftijdSchuif({ label, persoon, waarde, min, max, onChange, kleur = "#c9a84c" }) {
  const zet = (v) => onChange(Math.min(max, Math.max(min, Math.round(v * 12) / 12)));
  const stap = { background: "#111d26", border: `1px solid ${kleur}55`, color: kleur, borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 15, lineHeight: 1, flexShrink: 0 };
  return (
    <div style={{ marginBottom: 10 }}>
      {label && <label style={lbl}>{label}</label>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => zet(waarde - 1 / 12)} style={stap} aria-label="Een maand eerder">−</button>
        <input type="range" min={min} max={max} step={1 / 12} value={waarde} onChange={e => zet(+e.target.value)}
          style={{ flex: "1 1 140px", accentColor: kleur, minWidth: 120 }} aria-label={label} />
        <button onClick={() => zet(waarde + 1 / 12)} style={stap} aria-label="Een maand later">+</button>
        <span style={{ minWidth: 130, color: kleur, fontSize: 14, fontWeight: 700 }}>
          {lftLabel(maandenVan(waarde))} <span style={{ color: "#7a9bb0", fontWeight: 400, fontSize: 12 }}>· {datumBijLeeftijd(persoon, waarde)}</span>
        </span>
      </div>
    </div>
  );
}

// ─── fix-7: scenario stoppen met werken ──────────────────────────────────────
function StopScenario({ persoon, pensioenen, kleur, partnerNaam, update, titel, sub = true }) {
  const aowLft = persoon.aowStartLeeftijd ?? 67.25;
  const stop   = persoon.pensioenLeeftijd ?? aowLft;
  const modus  = persoon.ingangModus ?? "standaard";
  const ref    = doorwerkScenario(persoon);
  const euro   = (v) => `€ ${Math.round(v).toLocaleString("nl-NL")}`;
  const metTeken = (v) => `${v < 0 ? "−" : "+"}${euro(Math.abs(v))}`;

  const rijen = pensioenen.map(p => ({ p, nu: pensioenDetail(p, persoon), basis: pensioenDetail(p, ref) }));
  const levenslang = rijen.filter(r => r.p.totLeeftijd == null);
  const totRef = levenslang.reduce((s, r) => s + r.basis.bedrag, 0);
  const totNa  = levenslang.reduce((s, r) => s + r.nu.laag, 0);       // vanaf AOW-leeftijd
  const totVoor = levenslang.reduce((s, r) => s + r.nu.hoog, 0);      // vóór AOW-leeftijd (bij hoog-laag hoger)
  const verschil = totNa - totRef;
  const heeftHoogLaag = persoon.hoogLaag && levenslang.some(r => r.nu.ingang < aowLft - 1e-6);
  const kanHoogLaag = levenslang.some(r => r.nu.ingang < aowLft - 1e-6);
  // fix-9: hoog-laag uitzetten als het niet (meer) kan, zodat samenvattingen kloppen
  useEffect(() => { if (persoon.hoogLaag && !kanHoogLaag) update({ hoogLaag: false }); }, [persoon.hoogLaag, kanHoogLaag]);

  const eersteIngang = rijen.length ? Math.min(...rijen.map(r => r.nu.ingang)) : aowLft;
  const mndZonderAow = Math.max(0, maandenVan(aowLft) - maandenVan(stop));
  const mndZonderIets = Math.max(0, maandenVan(Math.min(eersteIngang, aowLft)) - maandenVan(stop));
  const zonderOpbouwData = pensioenen.some(p => p.teBereiken == null);
  const partnerGat = stop < aowLft && persoon.partnerVerzekerd > (persoon.partnerOpgebouwd ?? 0);
  const duur = (m) => m >= 12 ? `${Math.floor(m / 12)} jaar${m % 12 ? ` en ${m % 12} mnd` : ""}` : `${m} mnd`;

  const knop = (actief) => ({ background: actief ? `${kleur}33` : "transparent", border: `1px solid ${actief ? kleur : "#2a4a5e"}`, color: actief ? kleur : "#7a9bb0", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontFamily: "inherit" });
  const melding = (k) => ({ fontSize: 12, padding: "8px 12px", borderRadius: 8, marginTop: 6, background: k === "let" ? "#2d1a0e" : "#111d26", border: `1px solid ${k === "let" ? "#e07b5433" : "#2a4a5e"}`, color: k === "let" ? "#e0a07b" : "#b8c8d4" });

  return (
    <Inklapbaar sub={sub} kleur={kleur} titel={titel ?? "🎮 Scenario: stoppen met werken"}
      samenvatting={`stopt ${lftLabel(maandenVan(stop))} · pensioen ${euro(totNa / 12)}/mnd${Math.round(verschil) !== 0 ? ` (${metTeken(verschil / 12)})` : ""}`}>
      <LeeftijdSchuif label="Stopt met werken op" persoon={persoon} waarde={stop} min={55} max={aowLft + MAX_UITSTEL} kleur={kleur}
        onChange={v => update({ pensioenLeeftijd: v })} />

      <label style={lbl}>Pensioen laten ingaan</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button style={knop(modus === "standaard")} onClick={() => update({ ingangModus: "standaard" })}>Op de standaardleeftijd</button>
        <button style={knop(modus === "stoppen")}   onClick={() => update({ ingangModus: "stoppen" })}>Direct bij stoppen</button>
        <button style={knop(modus === "eigen")}     onClick={() => update({ ingangModus: "eigen", ingangLeeftijd: persoon.ingangLeeftijd ?? Math.max(MIN_INGANG, stop) })}>Op een eigen leeftijd</button>
      </div>
      {modus === "eigen" && (
        <LeeftijdSchuif label="Pensioen gaat in op" persoon={persoon} waarde={persoon.ingangLeeftijd ?? Math.max(MIN_INGANG, stop)} min={MIN_INGANG} max={aowLft + MAX_UITSTEL} kleur={kleur}
          onChange={v => update({ ingangLeeftijd: v })} />
      )}
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: kanHoogLaag ? "#b8c8d4" : "#4a6a7e", marginBottom: 12, cursor: kanHoogLaag ? "pointer" : "default" }}>
        <input type="checkbox" checked={!!persoon.hoogLaag} disabled={!kanHoogLaag} onChange={e => update({ hoogLaag: e.target.checked })} style={{ accentColor: kleur }} />
        Hoog-laag: tot de AOW-leeftijd een hoger pensioen, daarna 75% daarvan
        {!kanHoogLaag && <span style={{ color: "#4a6a7e" }}>(alleen bij ingang vóór de AOW-leeftijd)</span>}
      </label>

      {rijen.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              <th style={{ ...thK, textAlign: "left" }}>Regeling</th>
              <th style={thK}>Ingang</th>
              <th style={thK}>Doorwerken<br />€/jr</th>
              <th style={thK}>Scenario<br />€/jr</th>
            </tr></thead>
            <tbody>
              {rijen.map(({ p, nu, basis }) => (
                <tr key={p.id} style={{ borderBottom: "1px solid #2a4a5e33" }}>
                  <td style={{ ...celK, textAlign: "left", color: "#e8dcc8" }}>{p.naam}{p.totLeeftijd != null && <span style={{ color: "#4a6a7e" }}> (tijdelijk)</span>}</td>
                  <td style={celK}>{lftLabel(maandenVan(nu.ingang))}{nu.factor !== 1 && <div style={{ fontSize: 10, color: nu.factor < 1 ? "#e07b54" : "#4caf8a" }}>{nu.factor < 1 ? "−" : "+"}{Math.abs(Math.round((nu.factor - 1) * 100))}% {nu.factor < 1 ? "vervroeging" : "uitstel"}</div>}</td>
                  <td style={celK}>{euro(basis.bedrag).slice(2)}</td>
                  <td style={{ ...celK, color: kleur }}>{nu.hoog !== nu.laag ? <>{euro(nu.hoog).slice(2)}<br />→ {euro(nu.laag).slice(2)}</> : euro(nu.bedrag).slice(2)}</td>
                </tr>
              ))}
              {levenslang.length > 0 && (
                <tr>
                  <td style={{ ...celK, textAlign: "left", color: "#c9a84c", fontWeight: 700 }}>Totaal vanaf AOW</td>
                  <td style={celK}></td>
                  <td style={{ ...celK, fontWeight: 700 }}>{euro(totRef).slice(2)}</td>
                  <td style={{ ...celK, fontWeight: 700, color: kleur }}>{euro(totNa).slice(2)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {levenslang.length > 0 && Math.round(verschil) !== 0 && (
        <div style={{ ...melding(verschil < 0 ? "let" : "info"), fontSize: 13 }}>
          Levenslang <strong>{metTeken(verschil)}/jr bruto</strong> ({metTeken(verschil / 12)}/mnd{totRef > 0 ? `, ${verschil < 0 ? "−" : "+"}${Math.abs(Math.round(verschil / totRef * 100))}%` : ""}) t.o.v. doorwerken tot de AOW-leeftijd.
          {heeftHoogLaag && <> Tot de AOW-leeftijd {euro(totVoor)}/jr.</>}
        </div>
      )}

      {mndZonderAow > 0 && <div style={melding("info")}>Van {datumBijLeeftijd(persoon, stop)} tot {datumBijLeeftijd(persoon, aowLft)}: <strong>{duur(mndZonderAow)}</strong> nog geen AOW. Onder de AOW-leeftijd betaal je ook meer belasting; de Prognose rekent daarmee.</div>}
      {mndZonderIets > 0 && <div style={melding("let")}>⚠ <strong>{duur(mndZonderIets)}</strong> zonder pensioen én AOW (tot {datumBijLeeftijd(persoon, Math.min(eersteIngang, aowLft))}) — dat moet uit spaargeld of ander inkomen komen.</div>}
      {modus === "stoppen" && stop < MIN_INGANG && <div style={melding("info")}>Pensioen kan op z'n vroegst ingaan op {MIN_INGANG} jaar.</div>}
      {partnerGat && (
        <div style={melding("let")}>
          ⚠ <strong>Partnerpensioen{partnerNaam ? ` voor ${partnerNaam}` : ""}</strong>: nu verzekerd {euro(persoon.partnerVerzekerd)}/jr, waarvan {euro(persoon.partnerOpgebouwd ?? 0)}/jr opgebouwd.
          De rest is een risicodekking die na stoppen nog ca. 3 maanden doorloopt. Overlijden daarna (vóór pensioeningang) levert dan ongeveer {euro(persoon.partnerOpgebouwd ?? 0)}/jr op.
          Vraag je fonds naar het (deels) voortzetten of uitruilen.
        </div>
      )}
      {zonderOpbouwData && <div style={melding("info")}>Importeer het XML-overzicht opnieuw: dan rekent de app ook de opbouw tot je stopleeftijd mee (Opgebouwd → Te bereiken).</div>}
      <div style={{ fontSize: 11, color: "#4a6a7e", marginTop: 8 }}>
        Eerder/later laten ingaan is een schatting (sterftetafel + rekenrente). De exacte factoren van je fonds zie je in MijnABP of bij je uitvoerder.
      </div>
    </Inklapbaar>
  );
}

// ─── PensioenRij ──────────────────────────────────────────────────────────────
function PensioenRij({ p, persoon, alle, setPensioenen, kleur }) {
  const update = (veld, waarde) => setPensioenen(alle.map(x => x.id === p.id ? { ...x, [veld]: waarde } : x));
  const d = persoon ? pensioenDetail(p, persoon) : { ingang: p.startLeeftijd, bedrag: p.bruto_jaar ?? 0 };   // fix-7
  const heeftOpbouw = p.teBereiken != null;
  return (
    <Inklapbaar sub kleur={kleur} standaardOpen={!(p.bruto_jaar > 0)}
      titel={<>{p.type === "lijfrente" ? "📋" : "🏛️"} {p.naam}</>}
      samenvatting={`€ ${Math.round(d.bedrag / 12).toLocaleString("nl-NL")}/mnd bruto · vanaf ${lftLabel(maandenVan(d.ingang))}${p.totLeeftijd ? ` tot ${p.totLeeftijd}` : ""}`}>
      <div style={{ marginBottom: 8 }}>
        <label style={lbl}>Naam</label>
        <input value={p.naam} onChange={e => update("naam", e.target.value)} style={{ ...inp, maxWidth: 360 }} />
        <div style={{ fontSize: 11, color: "#4a6a7e", marginTop: 4 }}>
          {p.herkenning && `#${p.herkenning} · `}start lft {p.startLeeftijd}{p.totLeeftijd ? ` · stopt lft ${p.totLeeftijd}` : " · levenslang"}{p.standPer ? ` · ${p.standPer}` : ""}
        </div>
      </div>
      <Grid>
        <div><label style={lbl}>Type</label>
          <select value={p.type} onChange={e => update("type", e.target.value)} style={inp}>
            <option value="pensioen">Pensioenfonds</option>
            <option value="lijfrente">Lijfrente</option>
          </select>
        </div>
        <Field label="Startleeftijd" value={p.startLeeftijd} onChange={v => update("startLeeftijd", +v)} type="number" />
        <Field label="Stopt leeftijd (leeg=levenslang)" value={p.totLeeftijd ?? ""} onChange={v => update("totLeeftijd", v === "" ? null : +v)} type="number" />
        {heeftOpbouw ? <>
          {/* fix-7: opgebouwd nu vs. te bereiken bij doorwerken; bruto_jaar blijft gelijk aan opgebouwd */}
          <Field label="Opgebouwd/jr (€)" value={p.opgebouwd ?? 0} onChange={v => setPensioenen(alle.map(x => x.id === p.id ? { ...x, opgebouwd: +v, bruto_jaar: +v } : x))} type="number" />
          <Field label="Te bereiken/jr bij doorwerken (€)" value={p.teBereiken ?? 0} onChange={v => update("teBereiken", +v)} type="number" />
        </> : <Field label="Bruto/jr (€)" value={p.bruto_jaar??0} onChange={v => update("bruto_jaar", +v)} type="number" />}
      </Grid>
      {persoon && heeftOpbouw && (
        <div style={{ fontSize: 12, color: "#b8c8d4", background: "#1a2d3d", borderRadius: 8, padding: "8px 12px" }}>
          Bij stoppen op {lftLabel(maandenVan(persoon.pensioenLeeftijd ?? p.startLeeftijd))}: <strong style={{ color: kleur }}>€ {Math.round(d.basis).toLocaleString("nl-NL")}/jr</strong> op {lftLabel(maandenVan(p.startLeeftijd))}
          {d.ingang !== p.startLeeftijd && <> → ingang {lftLabel(maandenVan(d.ingang))}: <strong style={{ color: "#c9a84c" }}>€ {Math.round(d.bedrag).toLocaleString("nl-NL")}/jr</strong></>}
          <span style={{ color: "#4a6a7e" }}> · instellen via Mijn situatie → Scenario</span>
        </div>
      )}
      <VerwijderKnop wat={p.naam} onVerwijder={() => setPensioenen(alle.filter(x => x.id !== p.id))} />
    </Inklapbaar>
  );
}

// ─── fix-5: invoer banksparen / koopsom ───────────────────────────────────────
function ProductRij({ p, persoon, alle, setPensioenen, kleur }) {
  const update = (veld, waarde) => setPensioenen(alle.map(x => x.id === p.id ? { ...x, [veld]: waarde } : x));
  const num = (v) => (v === "" ? 0 : +v);
  const pu = productUitkering(p, persoon);
  const isBank = p.type === "bankspaar";
  const eind = pu.totLeeftijd != null ? `tot ${datumBijLeeftijd(persoon, pu.totLeeftijd)}` : "levenslang";
  return (
    <Inklapbaar sub kleur={kleur} standaardOpen={!(pu.bedragJr > 0)}
      titel={<>{isBank ? "🏦" : "💶"} {p.naam}</>}
      samenvatting={`€ ${Math.round(pu.bedragJr / 12).toLocaleString("nl-NL")}/mnd bruto vanaf ${datumBijLeeftijd(persoon, p.startLeeftijd)}`}>
      <div style={{ marginBottom: 8 }}>
        <label style={lbl}>Naam</label>
        <input value={p.naam} onChange={e => update("naam", e.target.value)} style={{ ...inp, maxWidth: 360 }} />
      </div>
      <Grid>
        <div><label style={lbl}>Soort</label>
          <select value={p.type} onChange={e => update("type", e.target.value)} style={inp}>
            <option value="bankspaar">Banksparen / beleggingsrecht</option>
            <option value="koopsom">Koopsom (lijfrente-uitkering)</option>
          </select>
        </div>
        {isBank ? <>
          <Field label="Saldo nu (€)" value={p.saldo ?? 0} onChange={v => update("saldo", num(v))} type="number" />
          <Field label="Inleg per jaar (€)" value={p.inlegPerJaar ?? 0} onChange={v => update("inlegPerJaar", num(v))} type="number" />
          <Field label="Verwacht rendement (%/jr)" value={p.rendement ?? 0} onChange={v => update("rendement", num(v))} type="number" />
          <Field label="Verwachte waarde aanbieder (€)" value={p.verwachteWaarde ?? 0} onChange={v => update("verwachteWaarde", num(v))} type="number" />
          <Field label="…in jaar" value={p.verwachtJaar ?? 0} onChange={v => update("verwachtJaar", num(v))} type="number" />
        </> : <>
          <Field label="Koopsom (€)" value={p.koopsom ?? 0} onChange={v => update("koopsom", num(v))} type="number" />
          <Field label="Uitkering uit offerte (€/mnd bruto)" value={p.uitkeringMnd ?? 0} onChange={v => update("uitkeringMnd", num(v))} type="number" />
        </>}
        <Field label="Uitkering vanaf leeftijd" value={p.startLeeftijd} onChange={v => update("startLeeftijd", num(v))} type="number" />
        <Field label={isBank ? "Looptijd uitkering (jaren)" : "Looptijd (jaren, 0 = levenslang)"} value={p.looptijd ?? (isBank ? 20 : 0)} onChange={v => update("looptijd", num(v))} type="number" />
        {(isBank || !(p.uitkeringMnd > 0)) && <Field label="Rente tijdens uitkering (%)" value={p.rente ?? 2} onChange={v => update("rente", num(v))} type="number" />}
      </Grid>
      <div style={{ fontSize: 12, color: "#b8c8d4", background: "#1a2d3d", borderRadius: 8, padding: "8px 12px" }}>
        {isBank && <>Verwacht kapitaal op {datumBijLeeftijd(persoon, p.startLeeftijd)}: <strong style={{ color: kleur }}>€ {pu.kapitaal.toLocaleString("nl-NL")}</strong> → </>}
        uitkering <strong style={{ color: "#c9a84c" }}>€ {Math.round(pu.bedragJr / 12).toLocaleString("nl-NL")}/mnd bruto</strong> vanaf {datumBijLeeftijd(persoon, p.startLeeftijd)}, {eind}
        {pu.geschat && <span style={{ color: "#4a6a7e" }}> · schatting{!isBank && pu.totLeeftijd == null ? " (levenslang gerekend tot 90 jaar)" : ""}</span>}
        <div style={{ color: "#4a6a7e", fontSize: 11, marginTop: 2 }}>Telt als bruto inkomen (box 1): belasting en Zvw worden ingehouden.</div>
      </div>
      <VerwijderKnop wat={p.naam} onVerwijder={() => setPensioenen(alle.filter(x => x.id !== p.id))} />
    </Inklapbaar>
  );
}

// ─── fix-6: inklapbaar blok ───────────────────────────────────────────────────
// sub = kleiner blok binnen een ander blok (pensioenregeling, product)
function Inklapbaar({ titel, samenvatting, kleur = "#c9a84c", standaardOpen = true, sub = false, children }) {
  const [open, setOpen] = useState(standaardOpen);
  return (
    <div style={{ background: sub ? "#111d26" : "#1a2d3d", border: `1px solid ${kleur}${sub ? "33" : "44"}`, borderRadius: sub ? 10 : 12, padding: sub ? "0 14px" : "0 18px", marginBottom: sub ? 10 : 16 }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ width: "100%", display: "grid", gridTemplateColumns: "14px 1fr", alignItems: "baseline", columnGap: 8, background: "transparent", border: "none", padding: sub ? "11px 0" : "14px 0", cursor: "pointer", textAlign: "left", color: kleur, fontFamily: "inherit" }}>
        <span style={{ fontSize: 11, color: "#7a9bb0" }}>{open ? "▼" : "▶"}</span>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 12, rowGap: 2, minWidth: 0 }}>
          <span style={{ fontSize: sub ? 13 : 15, fontWeight: 700, minWidth: 0 }}>{titel}</span>
          {!open && samenvatting && <span style={{ fontSize: 12, color: "#7a9bb0", marginLeft: "auto" }}>{samenvatting}</span>}
        </span>
      </button>
      {open && <div style={{ paddingBottom: sub ? 12 : 18 }}>{children}</div>}
    </div>
  );
}

// ─── fix-6: veilig verwijderen (eerst bevestigen) ─────────────────────────────
function VerwijderKnop({ wat, onVerwijder, compact = false }) {
  const [bevestig, setBevestig] = useState(false);
  useEffect(() => {
    if (!bevestig) return;
    const t = setTimeout(() => setBevestig(false), 6000);   // vanzelf annuleren
    return () => clearTimeout(t);
  }, [bevestig]);
  const basis = { borderRadius: 6, cursor: "pointer", fontSize: 12, padding: "5px 12px", fontFamily: "inherit" };
  return (
    <div style={compact ? { display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" } : { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a4a5e" }}>
      {!bevestig
        ? <button onClick={() => setBevestig(true)} aria-label={`${wat} verwijderen`} style={{ ...basis, background: "transparent", border: "1px solid #2a4a5e", color: "#7a9bb0", ...(compact ? { padding: "3px 7px", fontSize: 11 } : {}) }}>{compact ? "🗑" : "🗑 Verwijderen"}</button>
        : <>
            <span style={{ fontSize: 12, color: "#e07b54" }}>{wat} verwijderen?</span>
            <button onClick={() => setBevestig(false)} style={{ ...basis, background: "transparent", border: "1px solid #3a5a6e", color: "#b8c8d4" }}>Annuleren</button>
            <button onClick={() => { setBevestig(false); onVerwijder(); }} style={{ ...basis, background: "#c0392b", border: "1px solid #c0392b", color: "#fff", fontWeight: 600 }}>Ja, verwijderen</button>
          </>}
    </div>
  );
}

function Section({ title, children }) { return <div><h2 style={{ color: "#c9a84c", fontSize: 18, marginBottom: 20, paddingBottom: 10, borderBottom: "1px solid #2a4a5e" }}>{title}</h2>{children}</div>; }
function Grid({ children }) { return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(185px,1fr))", gap: 12, marginBottom: 12 }}>{children}</div>; }
function Field({ label, value, onChange, type = "text" }) { return <div><label style={lbl}>{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} style={inp} /></div>; }
function KPI({ label, value, kleur }) {
  return (
    <div style={{ background: "#0f1923", borderRadius: 8, padding: "10px 14px", border: `1px solid ${kleur}44` }}>
      <div style={{ fontSize: 11, color: "#7a9bb0", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: kleur }}>{value}</div>
    </div>
  );
}

const inp = { width: "100%", padding: "7px 10px", background: "#111d26", border: "1px solid #2a4a5e", borderRadius: 7, color: "#e8dcc8", fontSize: 13, boxSizing: "border-box" };
const lbl = { display: "block", fontSize: 11, color: "#7a9bb0", marginBottom: 4 };
const cel = { padding: "7px 10px", textAlign: "right", color: "#a0b8c8" };
const celK = { padding: "6px 5px", textAlign: "right", color: "#a0b8c8", verticalAlign: "top" };   // fix-7: compact (mobiel)
const thK  = { padding: "6px 5px", textAlign: "right", color: "#c9a84c", borderBottom: "1px solid #2a4a5e", fontSize: 11, verticalAlign: "bottom" };
const th  = { padding: "8px 10px", textAlign: "right", color: "#c9a84c", borderBottom: "1px solid #2a4a5e", whiteSpace: "nowrap" };
const btn = (color) => ({ background: `${color}22`, border: `1px solid ${color}44`, color, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 });
