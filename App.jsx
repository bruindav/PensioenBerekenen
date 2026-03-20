// PENSIOEN PLANNER - src/App.jsx
// v10: spaargeld en woning zichtbaar in uitklapbare tijdlijn,
//      duidelijk gelabeld als "netto" (geen belasting berekend over deze bedragen),
//      apart blok per bron in de uitklap

import { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

const FIX_NR = "v10";

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

// ─── Belasting box 1 2024 ─────────────────────────────────────────────────────
function berekenNetto(bruto) {
  if (bruto <= 0) return 0;
  const schijf1 = Math.min(bruto, 75518);
  const schijf2 = Math.max(0, bruto - 75518);
  let bel = schijf1 * 0.3697 + schijf2 * 0.495;
  const ahk = bruto < 24812 ? 3362 : Math.max(0, 3362 - (bruto - 24812) * 0.06095);
  bel = Math.max(0, bel - ahk - 1982);
  return Math.round(bruto - bel);
}

const AOW_SAMEN_MND  = 1014;
const AOW_ALLEEN_MND = 1450;
const JAAR_NU        = new Date().getFullYear();

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
  return { pensioenen: polissen, aow: { samen: aowSamen, alleen: aowAlleen, startLeeftijd: aowStart }, naam, geboortejaar };
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
            nieuwePersonen = nieuwePersonen.map(p => p.id === eigenaarId ? { ...p, geboortejaar: result.geboortejaar ?? p.geboortejaar, aowSamen: result.aow.samen || p.aowSamen, aowAlleen: result.aow.alleen || p.aowAlleen, aowStartLeeftijd: result.aow.startLeeftijd ?? p.aowStartLeeftijd } : p);
          } else {
            eigenaarId = `persoon_${Date.now()}`;
            nieuwePersonen = [...personen, { id: eigenaarId, naam: result.naam, geboortejaar: result.geboortejaar ?? 1970, pensioenLeeftijd: result.aow.startLeeftijd ?? 67.25, aowSamen: result.aow.samen, aowAlleen: result.aow.alleen, aowStartLeeftijd: result.aow.startLeeftijd ?? 67.25 }];
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

  const personenGesorteerd = useMemo(() => [...personen].sort((a, b) => a.geboortejaar - b.geboortejaar), [personen]);

  const startJaar = useMemo(() => {
    if (personenGesorteerd.length === 0) return JAAR_NU;
    const oudste = personenGesorteerd[0];
    const eigenPens = pensioenen.filter(p => p.eigenaarId === oudste.id);
    const vroegsteLft = eigenPens.length > 0 ? Math.min(...eigenPens.map(p => p.startLeeftijd)) : oudste.pensioenLeeftijd;
    return oudste.geboortejaar + Math.floor(vroegsteLft);
  }, [personenGesorteerd, pensioenen]);

  // ─── Tijdlijn momenten ────────────────────────────────────────────────────────
  const tijdlijnData = useMemo(() => {
    if (personen.length === 0) return [];
    const isSamen = personen.length > 1;

    function berekenJaar(jaar) {
      const items = [];
      let totPensioenBruto = 0, totAowBruto = 0;
      let totNetto = 0;

      personen.forEach((persoon) => {
        const lft = jaar - persoon.geboortejaar;
        let persoonPensioenBruto = 0;

        // Pensioenen
        pensioenen.filter(p => p.eigenaarId === persoon.id).forEach((p) => {
          const gestart = lft >= p.startLeeftijd;
          const gestopt = p.totLeeftijd != null && lft >= p.totLeeftijd;
          if (gestart && !gestopt) {
            const bedrag = p.type === "bankspaar"
              ? (() => { const r = (p.rente ?? 2) / 100; return r === 0 ? (p.saldo ?? 0) / 20 : ((p.saldo ?? 0) * r) / (1 - Math.pow(1 + r, -20)); })()
              : (p.bruto_jaar ?? 0);
            persoonPensioenBruto += bedrag;
            items.push({ type: "pensioen", naam: p.naam, bedragJr: Math.round(bedrag), eigenaar: persoon.naam, eigenaarIdx: personenGesorteerd.findIndex(x => x.id === persoon.id), isNetto: false });
          }
        });

        // Simulatie
        if (persoon.id === personenGesorteerd[0]?.id && simulatie.aankoopJaar > 0) {
          const simStart = persoon.geboortejaar + Math.floor(persoon.pensioenLeeftijd) + simulatie.aankoopJaar;
          if (jaar >= simStart) {
            const extra = simulatie.aankoopUitkering * 12;
            persoonPensioenBruto += extra;
            items.push({ type: "pensioen", naam: "Extra aankoop", bedragJr: extra, eigenaar: persoon.naam, eigenaarIdx: personenGesorteerd.findIndex(x => x.id === persoon.id), isNetto: false });
          }
        }

        // AOW
        const aowStart = persoon.aowStartLeeftijd ?? 67.25;
        let persoonAowBruto = 0;
        if (lft >= aowStart) {
          persoonAowBruto = isSamen ? (persoon.aowSamen || AOW_SAMEN_MND * 12) : (persoon.aowAlleen || AOW_ALLEEN_MND * 12);
          items.push({ type: "aow", naam: "AOW", bedragJr: Math.round(persoonAowBruto), eigenaar: persoon.naam, eigenaarIdx: personenGesorteerd.findIndex(x => x.id === persoon.id), isNetto: false });
          totAowBruto += persoonAowBruto;
        }

        totPensioenBruto += persoonPensioenBruto;
        // Netto per persoon: belasting over pensioen + AOW samen
        totNetto += berekenNetto(Math.round(persoonPensioenBruto) + Math.round(persoonAowBruto));
      });

      // Vermogen: netto — geen belasting, direct optellen
      const lftOudste = personenGesorteerd[0] ? jaar - personenGesorteerd[0].geboortejaar : 0;
      const spaargeld = lftOudste >= vermogen.spaargeldGebruikVanaf ? vermogen.spaargeldPerJaar : 0;
      const woning    = lftOudste >= vermogen.woningGebruikVanaf    ? vermogen.woningPerJaar    : 0;

      if (spaargeld > 0) {
        items.push({ type: "vermogen", naam: "Spaargeld inzetten", bedragJr: spaargeld, eigenaar: "", eigenaarIdx: -1, isNetto: true });
        totNetto += spaargeld; // netto: geen belasting
      }
      if (woning > 0) {
        items.push({ type: "vermogen", naam: "Woning (hypotheek/verkoop)", bedragJr: woning, eigenaar: "", eigenaarIdx: -1, isNetto: true });
        totNetto += woning; // netto: geen belasting
      }

      const totBrutoMnd = Math.round((totPensioenBruto + totAowBruto) / 12);
      const totNettoMnd = Math.round(totNetto / 12);

      return { totBrutoMnd, totNettoMnd, totNettoMndZonderVermogen: Math.round((totNetto - spaargeld - woning) / 12), spaargeld, woning, items };
    }

    const momenten = [];
    let vorigeHash = null;

    for (let i = 0; i < 35; i++) {
      const jaar = startJaar + i;
      const data = berekenJaar(jaar);
      const hash = data.items.map(x => `${x.naam}:${x.eigenaar}:${x.bedragJr}`).join("|");

      if (hash !== vorigeHash) {
        const leeftijdsLabels = personenGesorteerd.map(p => {
          const lft = jaar - p.geboortejaar;
          const jaren = Math.floor(lft);
          const mnd = Math.round((lft - jaren) * 12);
          return `${p.naam.split(" ")[0]} ${jaren}${mnd > 0 ? `j${mnd}m` : "j"}`;
        }).join(" · ");

        momenten.push({ jaar, leeftijdsLabels, data });
        vorigeHash = hash;
      }
    }
    return momenten;
  }, [personen, personenGesorteerd, pensioenen, vermogen, simulatie, startJaar]);

  // ─── Chartdata ────────────────────────────────────────────────────────────────
  const pensioenmomenten = useMemo(() => personenGesorteerd.map((p, pi) => ({
    jaar: p.geboortejaar + Math.floor(p.pensioenLeeftijd), naam: p.naam.split(" ")[0], kleur: KLEUREN[pi % KLEUREN.length],
  })), [personenGesorteerd]);

  const chartData = useMemo(() => {
    if (personen.length === 0) return [];
    const isSamen = personen.length > 1;
    return Array.from({ length: 30 }, (_, i) => {
      const jaar = startJaar + i;
      let totPensioen = 0, totAow = 0, totNetto = 0;
      const pp = {};
      personen.forEach((persoon) => {
        const lft = jaar - persoon.geboortejaar;
        let pensioenBruto = 0;
        pensioenen.filter(p => p.eigenaarId === persoon.id).forEach((p) => {
          if (lft >= p.startLeeftijd && !(p.totLeeftijd != null && lft >= p.totLeeftijd)) {
            pensioenBruto += p.type === "bankspaar" ? (() => { const r = (p.rente ?? 2) / 100; return r === 0 ? (p.saldo ?? 0) / 20 : ((p.saldo ?? 0) * r) / (1 - Math.pow(1 + r, -20)); })() : (p.bruto_jaar ?? 0);
          }
        });
        if (persoon.id === personenGesorteerd[0]?.id && simulatie.aankoopJaar > 0 && jaar >= persoon.geboortejaar + Math.floor(persoon.pensioenLeeftijd) + simulatie.aankoopJaar) pensioenBruto += simulatie.aankoopUitkering * 12;
        const aowStart = persoon.aowStartLeeftijd ?? 67.25;
        const aowBruto = lft >= aowStart ? (isSamen ? (persoon.aowSamen || AOW_SAMEN_MND * 12) : (persoon.aowAlleen || AOW_ALLEEN_MND * 12)) : 0;
        if (lft >= aowStart) totAow += aowBruto;
        pp[persoon.id] = { lft: lft.toFixed(1), pensioenBruto: Math.round(pensioenBruto) };
        totPensioen += pensioenBruto;
        totNetto += berekenNetto(Math.round(pensioenBruto) + aowBruto);
      });
      const lftOudste = parseFloat(pp[personenGesorteerd[0]?.id]?.lft ?? 0);
      const spaargeld = lftOudste >= vermogen.spaargeldGebruikVanaf ? vermogen.spaargeldPerJaar : 0;
      const woning    = lftOudste >= vermogen.woningGebruikVanaf    ? vermogen.woningPerJaar    : 0;
      totNetto += spaargeld + woning; // netto: geen belasting
      const totalBruto = Math.round(totPensioen + totAow + spaargeld + woning);
      const rij = { jaar, pensioenBruto: Math.round(totPensioen), aowBruto: Math.round(totAow), spaargeld: Math.round(spaargeld), woning: Math.round(woning), totalBruto, totalNetto: Math.round(totNetto), totalNettoMaand: Math.round(totNetto / 12), totalBrutoMaand: Math.round(totalBruto / 12) };
      personen.forEach(p => { rij[`pen_${p.id}`] = pp[p.id]?.pensioenBruto ?? 0; rij[`lft_${p.id}`] = pp[p.id]?.lft ?? "-"; });
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
        {[["profiel","👤 Profiel"],["pensioenen","📄 Pensioenen"],["vermogen","🏠 Vermogen"],["simulatie","🎮 Simulatie"],["prognose","📈 Prognose"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{ padding: "12px 20px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", background: tab === key ? "#1a2d3d" : "transparent", color: tab === key ? "#c9a84c" : "#7a9bb0", borderBottom: tab === key ? "2px solid #c9a84c" : "2px solid transparent" }}>{label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 20px" }}>

        {/* PROFIEL */}
        {tab === "profiel" && <Section title="Profiel">
          {personen.length === 0 && (
            <div style={{ padding: 24, background: "#1a2d3d", borderRadius: 12, border: "1px solid #2a4a5e", textAlign: "center", marginBottom: 24 }}>
              <p style={{ color: "#7a9bb0", margin: "0 0 12px" }}>Importeer je pensioenoverzicht om te beginnen.</p>
              <label style={{ ...btn("#5b9bd5"), cursor: "pointer" }}>📥 Importeren<input type="file" accept=".json,.xml" onChange={importeerBestand} style={{ display: "none" }} /></label>
            </div>
          )}
          {personenGesorteerd.map((persoon, pi) => (
            <div key={persoon.id} style={{ background: "#1a2d3d", border: `1px solid ${KLEUREN[pi % KLEUREN.length]}44`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h3 style={{ margin: 0, color: KLEUREN[pi % KLEUREN.length], fontSize: 15 }}>
                  {pi === 0 ? "👤 " : "👥 "}{persoon.naam}{pi === 0 && <span style={{ fontSize: 11, color: "#555", marginLeft: 8 }}>· oudste</span>}
                </h3>
                <button onClick={() => { setPersonen(personen.filter(p => p.id !== persoon.id)); setPensioenen(pensioenen.filter(p => p.eigenaarId !== persoon.id)); }} style={{ background: "#c0392b22", border: "1px solid #c0392b44", color: "#e74c3c", padding: "3px 9px", borderRadius: 6, cursor: "pointer" }}>✕</button>
              </div>
              <Grid>
                <Field label="Naam" value={persoon.naam} onChange={v => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, naam: v } : p))} />
                <Field label="Geboortejaar" value={persoon.geboortejaar} onChange={v => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, geboortejaar: +v } : p))} type="number" />
                <div>
                  <label style={lbl}>Pensioenleeftijd{pi > 0 && <span style={{ color: "#a084c9", fontSize: 10, marginLeft: 6 }}>← speel hiermee</span>}</label>
                  <input type="number" step="0.25" value={persoon.pensioenLeeftijd} onChange={e => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, pensioenLeeftijd: +e.target.value } : p))} style={inp} />
                </div>
                <Field label="AOW vanaf leeftijd" value={persoon.aowStartLeeftijd ?? 67.25} onChange={v => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, aowStartLeeftijd: +v } : p))} type="number" />
              </Grid>
              {persoon.aowSamen > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  <KPI label="AOW samenwonend/jr" value={`€ ${persoon.aowSamen.toLocaleString("nl-NL")}`} kleur={KLEUREN[pi % KLEUREN.length]} />
                  <KPI label="AOW alleenstaand/jr" value={`€ ${persoon.aowAlleen.toLocaleString("nl-NL")}`} kleur={KLEUREN[pi % KLEUREN.length]} />
                </div>
              )}
            </div>
          ))}
          {tijdlijnData.length > 0 && (
            <div style={{ padding: 20, background: "#1a2d3d", borderRadius: 12, border: "1px solid #2a4a5e" }}>
              <h3 style={{ margin: "0 0 14px", color: "#c9a84c", fontSize: 14 }}>📊 Inkomensmomenten</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {tijdlijnData.map((m, i) => (
                  <div key={i} style={{ background: "#111d26", border: `1px solid ${KLEUREN[i % KLEUREN.length]}44`, borderRadius: 10, padding: "12px 16px", minWidth: 170 }}>
                    <div style={{ color: KLEUREN[i % KLEUREN.length], fontSize: 12, fontWeight: 600, marginBottom: 2 }}>📍 {m.jaar}</div>
                    <div style={{ color: "#7a9bb0", fontSize: 11, marginBottom: 8 }}>{m.leeftijdsLabels}</div>
                    <div style={{ color: "#c9a84c", fontSize: 12 }}>€ {m.data.totBrutoMnd.toLocaleString("nl-NL")}/mnd bruto</div>
                    <div style={{ color: "#4caf8a", fontSize: 16, fontWeight: 700 }}>€ {m.data.totNettoMnd.toLocaleString("nl-NL")}/mnd netto</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>}

        {/* PENSIOENEN */}
        {tab === "pensioenen" && <Section title="Pensioenen & producten">
          {personenGesorteerd.map((persoon, pi) => {
            const eigenPens = pensioenen.filter(p => p.eigenaarId === persoon.id);
            return (
              <div key={persoon.id} style={{ marginBottom: 28 }}>
                <h3 style={{ color: KLEUREN[pi % KLEUREN.length], fontSize: 14, marginBottom: 12 }}>{pi === 0 ? "👤" : "👥"} {persoon.naam} · geb. {persoon.geboortejaar}</h3>
                {eigenPens.length === 0 ? <div style={{ padding: 16, color: "#4a6a7e", fontSize: 13, textAlign: "center" }}>Geen pensioenen</div>
                  : eigenPens.map(p => <PensioenRij key={p.id} p={p} alle={pensioenen} setPensioenen={setPensioenen} kleur={KLEUREN[pi % KLEUREN.length]} />)}
              </div>
            );
          })}
          <button onClick={() => { const id = personenGesorteerd[0]?.id ?? "onbekend"; setPensioenen([...pensioenen, { id: `handmatig_${Date.now()}`, naam: "Nieuw pensioen", type: "pensioen", eigenaarId: id, bruto_jaar: 0, startLeeftijd: 67.25, totLeeftijd: null }]); }} style={{ background: "#c9a84c22", border: "1px solid #c9a84c44", color: "#c9a84c", padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>+ Handmatig toevoegen</button>
        </Section>}

        {/* VERMOGEN */}
        {tab === "vermogen" && <Section title="Spaargeld & Woning">
          <div style={{ padding: 12, background: "#1a3d2d", borderRadius: 10, border: "1px solid #4caf8a33", marginBottom: 20 }}>
            <p style={{ margin: 0, color: "#4caf8a", fontSize: 13 }}>
              💡 Deze bedragen zijn <strong>netto</strong> — er wordt geen belasting over berekend. Ze worden direct opgeteld bij het netto inkomen.
            </p>
          </div>
          <h3 style={{ color: "#c9a84c", fontSize: 14, marginBottom: 12 }}>💰 Spaargeld inzetten als inkomen</h3>
          <Grid>
            <Field label="Totaal spaargeld (€)" value={vermogen.spaargeld} onChange={v=>setVermogen({...vermogen,spaargeld:+v})} type="number" />
            <Field label="Gebruik vanaf leeftijd oudste" value={vermogen.spaargeldGebruikVanaf} onChange={v=>setVermogen({...vermogen,spaargeldGebruikVanaf:+v})} type="number" />
            <Field label="Per jaar opnemen — netto (€)" value={vermogen.spaargeldPerJaar} onChange={v=>setVermogen({...vermogen,spaargeldPerJaar:+v})} type="number" />
          </Grid>
          <h3 style={{ color: "#c9a84c", fontSize: 14, marginBottom: 12, marginTop: 24 }}>🏠 Woning inzetten als inkomen</h3>
          <p style={{ color: "#7a9bb0", fontSize: 12, marginBottom: 12 }}>Bijv. verzilverhypotheek of verkoop + terughuur. Vul het netto bedrag in dat vrijkomt.</p>
          <Grid>
            <Field label="Woningwaarde (€)" value={vermogen.woningWaarde} onChange={v=>setVermogen({...vermogen,woningWaarde:+v})} type="number" />
            <Field label="Gebruik vanaf leeftijd oudste" value={vermogen.woningGebruikVanaf} onChange={v=>setVermogen({...vermogen,woningGebruikVanaf:+v})} type="number" />
            <Field label="Per jaar vrijmaken — netto (€)" value={vermogen.woningPerJaar} onChange={v=>setVermogen({...vermogen,woningPerJaar:+v})} type="number" />
          </Grid>
        </Section>}

        {/* SIMULATIE */}
        {tab === "simulatie" && <Section title="Pensioen aankoop simulatie">
          <Grid>
            <Field label="Extra aankoop X jaar na 1e pensionering" value={simulatie.aankoopJaar} onChange={v=>setSimulatie({...simulatie,aankoopJaar:+v})} type="number" />
            <Field label="Aankoopbedrag (€)" value={simulatie.aankoopBedrag} onChange={v=>setSimulatie({...simulatie,aankoopBedrag:+v})} type="number" />
            <Field label="Extra uitkering per maand (€)" value={simulatie.aankoopUitkering} onChange={v=>setSimulatie({...simulatie,aankoopUitkering:+v})} type="number" />
          </Grid>
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
                      <span style={{ color: "#7a9bb0", fontSize: 11 }}>= {persoon.geboortejaar + Math.floor(+persoon.pensioenLeeftijd)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ position: "relative", paddingLeft: 24 }}>
                <div style={{ position: "absolute", left: 8, top: 12, bottom: 12, width: 2, background: "#2a4a5e", borderRadius: 1 }} />
                {tijdlijnData.map((moment, mi) => (
                  <TijdlijnMoment key={`${moment.jaar}-${mi}`} moment={moment} mi={mi} personenGesorteerd={personenGesorteerd} KLEUREN={KLEUREN} />
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
                      <span style={{ color: "#7a9bb0", fontSize: 11 }}>= {persoon.geboortejaar + Math.floor(+persoon.pensioenLeeftijd)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ background: "#1a2d3d", borderRadius: 12, padding: 18, marginBottom: 20 }}>
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
              </div>
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
                          {personenGesorteerd.map((p, pi) => <td key={p.id} style={{ ...cel, color: parseFloat(r[`lft_${p.id}`]) >= p.pensioenLeeftijd ? KLEUREN[pi % KLEUREN.length] : "#4a6a7e" }}>{r[`lft_${p.id}`]}</td>)}
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
            </>
          )}
        </Section>}
      </div>
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
          <div style={{ color: kleur, fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{open ? "▼ " : "▶ "}Vanaf {moment.jaar}</div>
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
                  <RegelItem key={`aow${i}`} label="AOW" sublabel="Sociale Verzekeringsbank" bedrag={item.bedragJr} kleur="#5b9bd5" tag="bruto" />
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
    <div style={{ background: "#111d26", border: `1px solid ${kleur}33`, borderRadius: 10, padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
            <span>{p.type === "bankspaar" ? "🏦" : p.type === "lijfrente" ? "📋" : "🏛️"}</span>
            <input value={p.naam} onChange={e => update("naam", e.target.value)} style={{ ...inp, maxWidth: 280 }} />
          </div>
          <div style={{ fontSize: 11, color: "#4a6a7e", marginLeft: 24 }}>
            {p.herkenning && `#${p.herkenning} · `}start lft {p.startLeeftijd}{p.totLeeftijd ? ` · stopt lft ${p.totLeeftijd}` : " · levenslang"}{p.standPer ? ` · ${p.standPer}` : ""}
          </div>
        </div>
        <button onClick={() => setPensioenen(alle.filter(x => x.id !== p.id))} style={{ background: "#c0392b22", border: "1px solid #c0392b44", color: "#e74c3c", padding: "3px 9px", borderRadius: 6, cursor: "pointer", marginLeft: 10 }}>✕</button>
      </div>
      <Grid>
        <div><label style={lbl}>Type</label>
          <select value={p.type} onChange={e => update("type", e.target.value)} style={inp}>
            <option value="pensioen">Pensioenfonds</option>
            <option value="bankspaar">Bankspaarrekening</option>
            <option value="lijfrente">Lijfrente</option>
          </select>
        </div>
        <Field label="Startleeftijd" value={p.startLeeftijd} onChange={v => update("startLeeftijd", +v)} type="number" />
        <Field label="Stopt leeftijd (leeg=levenslang)" value={p.totLeeftijd ?? ""} onChange={v => update("totLeeftijd", v === "" ? null : +v)} type="number" />
        {p.type === "bankspaar"
          ? <><Field label="Saldo (€)" value={p.saldo??0} onChange={v => update("saldo", +v)} type="number" /><Field label="Rente (%)" value={p.rente??2} onChange={v => update("rente", +v)} type="number" /></>
          : <Field label="Bruto/jr (€)" value={p.bruto_jaar??0} onChange={v => update("bruto_jaar", +v)} type="number" />
        }
      </Grid>
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
