// PENSIOEN PLANNER - src/App.jsx
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

const FIX_NR = "fix-6";

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

// Bereken de verwachte AOW bij een gegeven pensioenleeftijd
// - bij normale leeftijd (>= aowStartLeeftijd): volledige AOW
// - bij eerder stoppen: huidig opgebouwde % + nog op te bouwen jaren tot pensioenleeftijd
function berekenAOWBijPensioen(persoon) {
  const { geboortejaar, pensioenLeeftijd, aowStartLeeftijd, aowSamen, aowAlleen } = persoon;
  const aowLft = aowStartLeeftijd ?? 67.25;

  // Zonder MPO data: gebruik volledige AOW als default
  if (!aowSamen || aowSamen === 0) {
    return {
      samen:  AOW_VOLLEDIG_SAMEN,
      alleen: AOW_VOLLEDIG_ALLEEN,
      volledig: true,
      pctOpbouw: 100,
      kortingPerJaar: 0,
    };
  }

  // Normale pensionering: volledig opgebouwd
  if (pensioenLeeftijd >= aowLft) {
    return {
      samen:  AOW_VOLLEDIG_SAMEN,
      alleen: AOW_VOLLEDIG_ALLEEN,
      volledig: true,
      pctOpbouw: 100,
      kortingPerJaar: 0,
    };
  }

  // Eerder stoppen: bereken opbouw op pensioenleeftijd
  // Huidige opbouw als percentage
  const pctNu = aowSamen / AOW_VOLLEDIG_SAMEN;
  const jarenNu = pctNu * AOW_MAX_JAREN;

  // Leeftijd op peildatum (benadering obv geboortejaar)
  const lftNu = JAAR_NU - geboortejaar;

  // Extra jaren tot pensioenleeftijd
  const extraJaren = Math.max(0, pensioenLeeftijd - lftNu);
  const totaleJaren = Math.min(AOW_MAX_JAREN, jarenNu + extraJaren);
  const pctBijPensioen = totaleJaren / AOW_MAX_JAREN;

  const samen  = Math.round(AOW_VOLLEDIG_SAMEN  * pctBijPensioen);
  const alleen = Math.round(AOW_VOLLEDIG_ALLEEN * pctBijPensioen);

  // Korting per jaar eerder stoppen (voor weergave)
  const jarenEerder = aowLft - pensioenLeeftijd;
  const kortingPerJaar = jarenEerder > 0
    ? Math.round((AOW_VOLLEDIG_SAMEN - samen) / jarenEerder)
    : 0;

  return {
    samen,
    alleen,
    volledig: false,
    pctOpbouw: Math.round(pctBijPensioen * 100),
    kortingPerJaar,
    jarenEerder: +jarenEerder.toFixed(1),
    verschilSamen: AOW_VOLLEDIG_SAMEN - samen,
  };
}

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
      polisLastSeen[h] = { bedrag: p.Opgebouwd ?? p.TeBereiken ?? 0, isLevenslang, blok };
    });
  });
  const polissen = Object.keys(polisFirstSeen).map(h => ({
    id: `${h}@${polisFirstSeen[h].startLft}`, naam: polisFirstSeen[h].naam, herkenning: h, type: "pensioen",
    bruto_jaar: polisLastSeen[h].bedrag, startLeeftijd: polisFirstSeen[h].startLft,
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
  let aowSamen = 0, aowAlleen = 0, aowStart = 67.25;
  const blokken = g(doc, "OuderdomsPensioen");
  for (let b = 0; b < blokken.length; b++) {
    const blok = blokken[b];
    const vanEl = g(blok, "Van")[0];
    const startLft = parseInt(vanEl ? t(vanEl, "Jaren") || "67" : "67") + parseInt(vanEl ? t(vanEl, "Maanden") || "0" : "0") / 12;
    const totEl = g(blok, "Tot")[0];
    const isLevenslang = totEl && t(totEl, "Jaren") === "";
    const totLftNum = totEl && t(totEl, "Jaren") !== "" ? parseInt(t(totEl, "Jaren") || "0") + parseInt(t(totEl, "Maanden") || "0") / 12 : null;
    const aowEl = g(blok, "AOWDetailsOpbouw")[0];
    if (aowEl) { const s = parseInt(t(aowEl, "OpgebouwdSamenwonend") || "0"); if (s > aowSamen) { aowSamen = s; aowAlleen = parseInt(t(aowEl, "OpgebouwdAlleenstaand") || "0"); aowStart = startLft; } }
    let polissen = g(blok, "IndicatiefPensioen");
    if (polissen.length === 0) polissen = g(blok, "Pensioen");
    for (let p = 0; p < polissen.length; p++) {
      const pEl = polissen[p]; const h = t(pEl, "HerkenningsNummer"); if (!h) continue;
      const bedrag = parseInt(t(pEl, "Opgebouwd") || "0") || parseInt(t(pEl, "TeBereiken") || "0");
      if (!polisFirstSeen[h]) polisFirstSeen[h] = { startLft, naam: t(pEl, "PensioenUitvoerder") || "Onbekend", standPer: t(pEl, "StandPer") };
      polisLastSeen[h] = { bedrag, isLevenslang, totLftNum };
    }
  }
  const polissen = Object.keys(polisFirstSeen).map(h => ({
    id: `${h}@${polisFirstSeen[h].startLft}`, naam: polisFirstSeen[h].naam, herkenning: h, type: "pensioen",
    bruto_jaar: polisLastSeen[h].bedrag, startLeeftijd: polisFirstSeen[h].startLft,
    totLeeftijd: polisLastSeen[h].isLevenslang ? null : polisLastSeen[h].totLftNum,
    standPer: polisFirstSeen[h].standPer,
  }));
  return { pensioenen: polissen, aow: { samen: aowSamen, alleen: aowAlleen, startLeeftijd: aowStart }, naam, geboortejaar, geboortemaand, samenwonend };
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
  simulatie: { aankoopJaar: 0, aankoopBedrag: 10000, aankoopUitkering: 600 },
};
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
        const saved = await dbGet("state");
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

  async function slaOp(pe, ps, v, s) {
    try { await dbSet("state", { personen: pe, pensioenen: ps, vermogen: v, simulatie: s }); setOpgeslagen(new Date()); }
    catch (e) { console.warn(e); }
  }
  function setPersonen(v)   { setPersonenRaw(v);   slaOp(v, pensioenen, vermogen, simulatie); }
  function setPensioenen(v) { setPensioenenRaw(v); slaOp(personen, v, vermogen, simulatie); }
  function setVermogen(v)   { setVermogenRaw(v);   slaOp(personen, pensioenen, v, simulatie); }
  function setSimulatie(v)  { setSimulatieRaw(v);  slaOp(personen, pensioenen, vermogen, v); }

  function importeerBestand(e) {
    const file = e.target.files[0]; if (!file) return; e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const result = parseerBestand(ev.target.result, file.name);
        if (!result.pensioenen?.length) { setImportStatus({ ok: false, tekst: "❌ Geen pensioenregelingen gevonden." }); return; }
        let eigenaarId, nieuwePersonen = [...personen];
        if (result.naam) {
          const bestaand = personen.find(p => p.naam === result.naam);
          if (bestaand) {
            eigenaarId = bestaand.id;
            nieuwePersonen = nieuwePersonen.map(p => p.id === eigenaarId ? { ...p, geboortejaar: result.geboortejaar ?? p.geboortejaar, geboortemaand: result.geboortemaand ?? p.geboortemaand, samenwonend: result.samenwonend ?? p.samenwonend, aowSamen: result.aow.samen || p.aowSamen, aowAlleen: result.aow.alleen || p.aowAlleen, aowStartLeeftijd: result.aow.startLeeftijd ?? p.aowStartLeeftijd } : p);
          } else {
            eigenaarId = `persoon_${Date.now()}`;
            nieuwePersonen = [...personen, { id: eigenaarId, naam: result.naam, geboortejaar: result.geboortejaar ?? 1970, geboortemaand: result.geboortemaand ?? 1, samenwonend: result.samenwonend ?? undefined, pensioenLeeftijd: result.aow.startLeeftijd ?? 67.25, aowSamen: result.aow.samen, aowAlleen: result.aow.alleen, aowStartLeeftijd: result.aow.startLeeftijd ?? 67.25 }];
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
        const bestaandePens = pensioenen.filter(p => p.eigenaarId !== eigenaarId);
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
        const d = JSON.parse(ev.target.result);
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
  function berekenMaand(abs) {
    const items = [];
    let totPensioenBruto = 0, totAowBruto = 0, totNetto = 0, totBelasting = 0, totZvw = 0;
    const perPersoon = {};

    personen.forEach((persoon) => {
      const isSamen = isSamenwonend(persoon);
      const lftM = lftMaanden(persoon, abs);
      const eigenaarIdx = personenGesorteerd.findIndex(x => x.id === persoon.id);
      let persoonPensioenBruto = 0;

      pensioenen.filter(p => p.eigenaarId === persoon.id).forEach((p) => {
        const pu = productUitkering(p, persoon);                          // fix-5
        const gestart = lftM >= maandenVan(p.startLeeftijd);
        const gestopt = pu.totLeeftijd != null && lftM >= maandenVan(pu.totLeeftijd);
        if (gestart && !gestopt) {
          const bedrag = pu.bedragJr;
          persoonPensioenBruto += bedrag;
          items.push({ type: "pensioen", naam: p.naam, bedragJr: Math.round(bedrag), eigenaar: persoon.naam, eigenaarIdx, isNetto: false });
        }
      });

      if (persoon.id === personenGesorteerd[0]?.id && simulatie.aankoopJaar > 0 &&
          lftM >= maandenVan(persoon.pensioenLeeftijd + simulatie.aankoopJaar)) {
        const extra = simulatie.aankoopUitkering * 12;
        persoonPensioenBruto += extra;
        items.push({ type: "pensioen", naam: "Extra aankoop", bedragJr: extra, eigenaar: persoon.naam, eigenaarIdx, isNetto: false });
      }

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

  // Eerste maand: vroegste pensioenstart van de oudste persoon
  const startMaand = useMemo(() => {
    if (personenGesorteerd.length === 0) return JAAR_NU * 12;
    const oudste = personenGesorteerd[0];
    const eigenPens = pensioenen.filter(p => p.eigenaarId === oudste.id);
    const vroegsteLft = eigenPens.length > 0 ? Math.min(...eigenPens.map(p => p.startLeeftijd)) : oudste.pensioenLeeftijd;
    return gebAbs(oudste) + maandenVan(vroegsteLft);
  }, [personenGesorteerd, pensioenen]);
  const startJaar = Math.floor(startMaand / 12);

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
                <div>
                  <label style={lbl}>Pensioenleeftijd{pi > 0 && <span style={{ color: "#a084c9", fontSize: 10, marginLeft: 6 }}>← speel hiermee</span>}</label>
                  <input type="number" step="0.25" value={persoon.pensioenLeeftijd} onChange={e => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, pensioenLeeftijd: +e.target.value } : p))} style={inp} />
                  <div style={{ fontSize: 10, color: "#4a6a7e", marginTop: 3 }}>= {datumBijLeeftijd(persoon, +persoon.pensioenLeeftijd)}</div>
                </div>
                <Field label="AOW vanaf leeftijd" value={persoon.aowStartLeeftijd ?? 67.25} onChange={v => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, aowStartLeeftijd: +v } : p))} type="number" />
              </Grid>
              {persoon.aowSamen > 0 && (() => {
                const aow = berekenAOWBijPensioen(persoon);
                const kleur = KLEUREN[pi % KLEUREN.length];
                return (
                  <div style={{ marginTop: 10 }}>
                    {/* Huidig opgebouwde AOW (uit MPO) */}
                    <div style={{ fontSize: 11, color: "#7a9bb0", marginBottom: 6 }}>
                      AOW opgebouwd per {new Date().toLocaleDateString("nl-NL", { month: "long", year: "numeric" })}
                      <span style={{ marginLeft: 8, color: "#4a6a7e" }}>(uit mijnpensioenoverzicht)</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                      <KPI label="AOW nu opgebouwd — samen" value={`€ ${persoon.aowSamen.toLocaleString("nl-NL")}/jr`} kleur="#4a6a7e" />
                      <KPI label="AOW nu opgebouwd — alleen" value={`€ ${persoon.aowAlleen.toLocaleString("nl-NL")}/jr`} kleur="#4a6a7e" />
                    </div>
                    {/* Verwachte AOW bij gekozen pensioenleeftijd */}
                    <div style={{ fontSize: 11, color: "#7a9bb0", marginBottom: 6 }}>
                      AOW bij pensionering op leeftijd <strong style={{ color: kleur }}>{persoon.pensioenLeeftijd}</strong>
                      {aow.volledig
                        ? <span style={{ marginLeft: 8, color: "#4caf8a" }}>✓ volledig opgebouwd (100%)</span>
                        : <span style={{ marginLeft: 8, color: "#e07b54" }}>⚠ {aow.pctOpbouw}% opgebouwd — {aow.jarenEerder} jaar eerder gestopt</span>
                      }
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <KPI label="AOW bij pensioen — samen" value={`€ ${aow.samen.toLocaleString("nl-NL")}/jr`} kleur={aow.volledig ? "#4caf8a" : kleur} />
                      <KPI label="AOW bij pensioen — alleen" value={`€ ${aow.alleen.toLocaleString("nl-NL")}/jr`} kleur={aow.volledig ? "#4caf8a" : kleur} />
                    </div>
                    {!aow.volledig && (
                      <div style={{ marginTop: 8, padding: "8px 12px", background: "#2d1a0e", borderRadius: 8, border: "1px solid #e07b5433" }}>
                        <span style={{ color: "#e07b54", fontSize: 12 }}>
                          Korting t.o.v. volledig: <strong>€ {aow.verschilSamen.toLocaleString("nl-NL")}/jr</strong> (€ {Math.round(aow.verschilSamen / 12).toLocaleString("nl-NL")}/mnd) minder AOW — levenslang.
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
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
                  : eigenPens.map(p => <PensioenRij key={p.id} p={p} alle={pensioenen} setPensioenen={setPensioenen} kleur={kleur} />)}
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
        {tab === "simulatie" && <Section title="Pensioen aankoop simulatie">
          <Inklapbaar titel="🎮 Extra aankoop" samenvatting={simulatie.aankoopJaar > 0 ? `€ ${simulatie.aankoopUitkering}/mnd, ${simulatie.aankoopJaar} jaar na pensionering` : "uit"}>
          <Grid>
            <Field label="Extra aankoop X jaar na 1e pensionering" value={simulatie.aankoopJaar} onChange={v=>setSimulatie({...simulatie,aankoopJaar:+v})} type="number" />
            <Field label="Aankoopbedrag (€)" value={simulatie.aankoopBedrag} onChange={v=>setSimulatie({...simulatie,aankoopBedrag:+v})} type="number" />
            <Field label="Extra uitkering per maand (€)" value={simulatie.aankoopUitkering} onChange={v=>setSimulatie({...simulatie,aankoopUitkering:+v})} type="number" />
          </Grid>
          </Inklapbaar>
        </Section>}

        {/* PROGNOSE */}
        {tab === "prognose" && <Section title="Inkomensprognose">
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <button onClick={() => setPrognoseView("tijdlijn")} style={{ ...btn(prognoseView === "tijdlijn" ? "#c9a84c" : "#3a5a6e"), fontWeight: prognoseView === "tijdlijn" ? 700 : 400 }}>📋 Tijdlijn</button>
            <button onClick={() => setPrognoseView("grafiek")}  style={{ ...btn(prognoseView === "grafiek"  ? "#c9a84c" : "#3a5a6e"), fontWeight: prognoseView === "grafiek"  ? 700 : 400 }}>📈 Grafiek & tabel</button>
          </div>

          {prognoseView === "tijdlijn" && (
            <div>
              {personenGesorteerd.length > 1 && (
                <div style={{ padding: 12, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e", marginBottom: 20, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ color: "#7a9bb0", fontSize: 12 }}>🎮 Pensioenleeftijd aanpassen:</span>
                  {personenGesorteerd.slice(1).map((persoon, pi) => (
                    <div key={persoon.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: KLEUREN[(pi+1) % KLEUREN.length], fontSize: 13 }}>{persoon.naam.split(" ")[0]}</span>
                      <input type="number" step="0.25" value={persoon.pensioenLeeftijd} min="55" max="75" onChange={e => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, pensioenLeeftijd: +e.target.value } : p))} style={{ ...inp, width: 70 }} />
                      <span style={{ color: "#7a9bb0", fontSize: 11 }}>= {datumBijLeeftijd(persoon, +persoon.pensioenLeeftijd)}</span>
                    </div>
                  ))}
                </div>
              )}
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
              {personenGesorteerd.length > 1 && (
                <div style={{ padding: 12, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e", marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ color: "#7a9bb0", fontSize: 12 }}>🎮 Pensioenleeftijd:</span>
                  {personenGesorteerd.slice(1).map((persoon, pi) => (
                    <div key={persoon.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: KLEUREN[(pi+1) % KLEUREN.length], fontSize: 13 }}>{persoon.naam.split(" ")[0]}</span>
                      <input type="number" step="0.25" value={persoon.pensioenLeeftijd} min="55" max="75" onChange={e => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, pensioenLeeftijd: +e.target.value } : p))} style={{ ...inp, width: 70 }} />
                      <span style={{ color: "#7a9bb0", fontSize: 11 }}>= {datumBijLeeftijd(persoon, +persoon.pensioenLeeftijd)}</span>
                    </div>
                  ))}
                </div>
              )}
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

// ─── PensioenRij ──────────────────────────────────────────────────────────────
function PensioenRij({ p, alle, setPensioenen, kleur }) {
  const update = (veld, waarde) => setPensioenen(alle.map(x => x.id === p.id ? { ...x, [veld]: waarde } : x));
  return (
    <Inklapbaar sub kleur={kleur} standaardOpen={!(p.bruto_jaar > 0)}
      titel={<>{p.type === "lijfrente" ? "📋" : "🏛️"} {p.naam}</>}
      samenvatting={`€ ${Math.round((p.bruto_jaar ?? 0) / 12).toLocaleString("nl-NL")}/mnd bruto · vanaf ${p.startLeeftijd} jr${p.totLeeftijd ? ` tot ${p.totLeeftijd}` : ""}`}>
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
        <Field label="Bruto/jr (€)" value={p.bruto_jaar??0} onChange={v => update("bruto_jaar", +v)} type="number" />
      </Grid>
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
function VerwijderKnop({ wat, onVerwijder }) {
  const [bevestig, setBevestig] = useState(false);
  useEffect(() => {
    if (!bevestig) return;
    const t = setTimeout(() => setBevestig(false), 6000);   // vanzelf annuleren
    return () => clearTimeout(t);
  }, [bevestig]);
  const basis = { borderRadius: 6, cursor: "pointer", fontSize: 12, padding: "5px 12px", fontFamily: "inherit" };
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a4a5e" }}>
      {!bevestig
        ? <button onClick={() => setBevestig(true)} style={{ ...basis, background: "transparent", border: "1px solid #2a4a5e", color: "#7a9bb0" }}>🗑 Verwijderen</button>
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
const th  = { padding: "8px 10px", textAlign: "right", color: "#c9a84c", borderBottom: "1px solid #2a4a5e", whiteSpace: "nowrap" };
const btn = (color) => ({ background: `${color}22`, border: `1px solid ${color}44`, color, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 });
