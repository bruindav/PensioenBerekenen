// PENSIOEN PLANNER - src/App.jsx
// v3: partner MPO import (namespace fix, Pensioen i.p.v. IndicatiefPensioen, naam+geboortedatum uit bestand)

import { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const FIX_NR = "v3";

// ─── IndexedDB ────────────────────────────────────────────────────────────────
const DB_NAME = "pensioenPlanner";
const STORE = "gegevens";
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Belasting box 1 2024 ─────────────────────────────────────────────────────
function berekenNetto(bruto) {
  if (bruto <= 0) return 0;
  const schijf1 = Math.min(bruto, 75518);
  const schijf2 = Math.max(0, bruto - 75518);
  let belasting = schijf1 * 0.3697 + schijf2 * 0.495;
  const ahk = bruto < 24812 ? 3362 : Math.max(0, 3362 - (bruto - 24812) * 0.06095);
  belasting = Math.max(0, belasting - ahk - 1982);
  return Math.round(bruto - belasting);
}

const AOW_SAMEN = 1014;
const AOW_ALLEEN = 1450;
const JAAR_NU = new Date().getFullYear();

// ─── XML helper: getElementsByTagName werkt ook met namespaces ────────────────
function xmlTag(el, tag) {
  return el.getElementsByTagName(tag);
}
function xmlText(el, tag) {
  return el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
}

// ─── MPO XML parser (beide formaten) ─────────────────────────────────────────
// Formaat A (jouw bestand):  OuderdomsPensioen > IndicatiefPensioen > HerkenningsNummer
// Formaat B (partner):       OuderdomsPensioen > Pensioen > HerkenningsNummer
function parseerMPOxml(xmlText, eigenaar) {
  console.log("[MPO XML] Parseren voor:", eigenaar);
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");

  // Naam en geboortedatum uit bestand halen
  const naam = xmlText.includes("<Naam>") ? doc.getElementsByTagName("Naam")[0]?.textContent?.trim() : eigenaar;
  const geboortedatumStr = doc.getElementsByTagName("Geboortedatum")[0]?.textContent?.trim();
  const geboortejaar = geboortedatumStr ? parseInt(geboortedatumStr.split("-")[0]) : null;
  console.log("[MPO XML] Naam:", naam, "| Geboortejaar:", geboortejaar);

  const resultMap = {};
  let aowOpgebouwdSamen = 0, aowOpgebouwdAlleen = 0;

  const ouderdomsBlokken = xmlTag(doc, "OuderdomsPensioen");
  console.log("[MPO XML] OuderdomsPensioen blokken:", ouderdomsBlokken.length);

  for (let b = 0; b < ouderdomsBlokken.length; b++) {
    const blok = ouderdomsBlokken[b];

    // Startleeftijd: zoek <Van><Jaren> direct onder dit blok
    const vanEl = xmlTag(blok, "Van")[0];
    const startJaren = parseInt(vanEl ? xmlText(vanEl, "Jaren") || "67" : "67");

    // AOW opbouw
    const aowOpbouw = xmlTag(blok, "AOWDetailsOpbouw")[0];
    if (aowOpbouw) {
      const samen = parseInt(xmlText(aowOpbouw, "OpgebouwdSamenwonend") || "0");
      if (samen > aowOpgebouwdSamen) {
        aowOpgebouwdSamen = samen;
        aowOpgebouwdAlleen = parseInt(xmlText(aowOpbouw, "OpgebouwdAlleenstaand") || "0");
      }
    }

    // Probeer eerst IndicatiefPensioen (formaat A), dan Pensioen (formaat B)
    let polissen = xmlTag(blok, "IndicatiefPensioen");
    if (polissen.length === 0) polissen = xmlTag(blok, "Pensioen");
    console.log("[MPO XML] Blok", b, "startJaren:", startJaren, "| polissen:", polissen.length);

    for (let p = 0; p < polissen.length; p++) {
      const pEl = polissen[p];
      const herkenning = xmlText(pEl, "HerkenningsNummer");
      if (!herkenning) continue;
      const opgebouwd = parseInt(xmlText(pEl, "Opgebouwd") || "0");
      const teBereiken = parseInt(xmlText(pEl, "TeBereiken") || "0");
      const bedrag = opgebouwd || teBereiken;
      const uitvoerder = xmlText(pEl, "PensioenUitvoerder") || "Onbekend";
      const standPer = xmlText(pEl, "StandPer");
      const key = `${eigenaar}:${herkenning}@${startJaren}`;

      if (!resultMap[key]) {
        resultMap[key] = { id: key, naam: uitvoerder, herkenning, eigenaar, type: "pensioen", bruto_jaar: bedrag, startLeeftijd: startJaren, standPer };
        console.log("[MPO XML]  +", uitvoerder, herkenning, bedrag, "v.a.", startJaren);
      }
    }
  }

  // Dedupliceer: zelfde herkenning + zelfde bedrag → bewaar laagste startleeftijd
  const seen = {};
  const dedup = {};
  Object.values(resultMap)
    .sort((a, b) => a.startLeeftijd - b.startLeeftijd)
    .forEach((p) => {
      const base = `${p.eigenaar}:${p.herkenning}`;
      if (!seen[base]) {
        seen[base] = p.bruto_jaar;
        dedup[p.id] = p;
      } else if (p.bruto_jaar !== seen[base]) {
        dedup[p.id] = p;
        seen[base] = p.bruto_jaar;
      }
    });

  console.log("[MPO XML] Resultaat:", Object.keys(dedup).length, "polissen | AOW samen:", aowOpgebouwdSamen);
  return { pensioenen: Object.values(dedup), aow: { opgebouwdSamen: aowOpgebouwdSamen, opgebouwdAlleen: aowOpgebouwdAlleen }, naam, geboortejaar };
}

// ─── MPO JSON parser ──────────────────────────────────────────────────────────
function parseerMPO(data, eigenaar) {
  console.log("[MPO JSON] Parseren voor:", eigenaar);
  const resultMap = {};
  const details = data?.Details?.OuderdomsPensioenDetails?.OuderdomsPensioen ?? [];

  details.forEach((blok) => {
    const startJaren = blok.Van?.Leeftijd?.Jaren ?? 67;
    (blok.IndicatiefPensioen ?? []).forEach((p) => {
      const herkenning = p.HerkenningsNummer;
      if (!herkenning) return;
      const bedrag = p.Opgebouwd ?? p.TeBereiken ?? 0;
      const key = `${eigenaar}:${herkenning}@${startJaren}`;
      if (!resultMap[key]) {
        resultMap[key] = { id: key, naam: p.PensioenUitvoerder, herkenning, eigenaar, type: "pensioen", bruto_jaar: bedrag, startLeeftijd: startJaren, standPer: p.StandPer };
      }
    });
  });

  const seen = {};
  const dedup = {};
  Object.values(resultMap)
    .sort((a, b) => a.startLeeftijd - b.startLeeftijd)
    .forEach((p) => {
      const base = `${p.eigenaar}:${p.herkenning}`;
      if (!seen[base]) { seen[base] = p.bruto_jaar; dedup[p.id] = p; }
      else if (p.bruto_jaar !== seen[base]) { dedup[p.id] = p; seen[base] = p.bruto_jaar; }
    });

  let aowOpgebouwdSamen = 0, aowOpgebouwdAlleen = 0;
  details.forEach((blok) => {
    const a = blok.AOW?.AOWDetailsOpbouw;
    if (a && a.OpgebouwdSamenwonend > aowOpgebouwdSamen) {
      aowOpgebouwdSamen = a.OpgebouwdSamenwonend;
      aowOpgebouwdAlleen = a.OpgebouwdAlleenstaand;
    }
  });

  return { pensioenen: Object.values(dedup), aow: { opgebouwdSamen: aowOpgebouwdSamen, opgebouwdAlleen: aowOpgebouwdAlleen }, naam: null, geboortejaar: null };
}

// ─── Default state ────────────────────────────────────────────────────────────
const DEFAULT = {
  pensioenen: [],
  profiel: { geboortejaar: 1970, pensioenLeeftijd: 67, partnerGeboortejaar: 1972, partnerNaam: "", partnerPensioenLeeftijd: 67, heeftPartner: true, aowOpgebouwdSamen: 0, aowOpgebouwdAlleen: 0, partnerAowOpgebouwdSamen: 0 },
  vermogen: { spaargeld: 0, spaargeldGebruikVanaf: 67, spaargeldPerJaar: 0, woningWaarde: 0, woningGebruikVanaf: 75, woningPerJaar: 0 },
  simulatie: { aankoopJaar: 0, aankoopBedrag: 10000, aankoopUitkering: 600 },
};

// ─── App ──────────────────────────────────────────────────────────────────────
export default function PensioenApp() {
  const [tab, setTab] = useState("profiel");
  const [geladen, setGeladen] = useState(false);
  const [opgeslagen, setOpgeslagen] = useState(null);
  const [importStatus, setImportStatus] = useState(null);

  const [pensioenen, setPensioenenRaw] = useState(DEFAULT.pensioenen);
  const [profiel, setProfielRaw] = useState(DEFAULT.profiel);
  const [vermogen, setVermogenRaw] = useState(DEFAULT.vermogen);
  const [simulatie, setSimulatieRaw] = useState(DEFAULT.simulatie);

  useEffect(() => {
    (async () => {
      try {
        const saved = await dbGet("state");
        if (saved) {
          if (saved.pensioenen) setPensioenenRaw(saved.pensioenen);
          if (saved.profiel)   setProfielRaw(saved.profiel);
          if (saved.vermogen)  setVermogenRaw(saved.vermogen);
          if (saved.simulatie) setSimulatieRaw(saved.simulatie);
        }
      } catch (e) { console.warn("Laden mislukt:", e); }
      setGeladen(true);
    })();
  }, []);

  async function slaOp(p, pr, v, s) {
    try {
      await dbSet("state", { pensioenen: p, profiel: pr, vermogen: v, simulatie: s });
      setOpgeslagen(new Date());
    } catch (e) { console.warn("Opslaan mislukt:", e); }
  }
  function setPensioenen(v) { setPensioenenRaw(v);  slaOp(v, profiel, vermogen, simulatie); }
  function setProfiel(v)    { setProfielRaw(v);     slaOp(pensioenen, v, vermogen, simulatie); }
  function setVermogen(v)   { setVermogenRaw(v);    slaOp(pensioenen, profiel, v, simulatie); }
  function setSimulatie(v)  { setSimulatieRaw(v);   slaOp(pensioenen, profiel, vermogen, v); }

  // ─── MPO import ──────────────────────────────────────────────────────────────
  function importeerMPO(e, eigenaar) {
    const file = e.target.files[0];
    console.log("[MPO] Bestand:", file?.name, "| eigenaar:", eigenaar);
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        let result;
        const isJSON = file.name.toLowerCase().endsWith(".json");
        const isXML  = file.name.toLowerCase().endsWith(".xml");
        if (!isJSON && !isXML) {
          setImportStatus({ ok: false, tekst: "Gebruik .json of .xml van mijnpensioenoverzicht.nl" });
          return;
        }
        result = isJSON ? parseerMPO(JSON.parse(ev.target.result), eigenaar) : parseerMPOxml(ev.target.result, eigenaar);

        if (!result.pensioenen?.length) {
          setImportStatus({ ok: false, tekst: `❌ Geen pensioenregelingen gevonden in dit bestand.` });
          return;
        }

        // Merge: verwijder bestaande polissen van dezelfde eigenaar, voeg nieuwe toe
        const bestaand = pensioenen.filter(p => p.eigenaar !== eigenaar);
        const nieuw = result.pensioenen.map((p, i) => ({ ...p, id: p.id || `${eigenaar}_${Date.now()}_${i}` }));
        setPensioenen([...bestaand, ...nieuw]);

        // Update profiel: AOW en evt. geboortejaar partner
        let nieuwProfiel = { ...profiel };
        if (eigenaar === "ikzelf" && result.aow.opgebouwdSamen > 0) {
          nieuwProfiel = { ...nieuwProfiel, aowOpgebouwdSamen: result.aow.opgebouwdSamen, aowOpgebouwdAlleen: result.aow.opgebouwdAlleen };
        }
        if (eigenaar === "partner") {
          if (result.aow.opgebouwdSamen > 0) nieuwProfiel = { ...nieuwProfiel, partnerAowOpgebouwdSamen: result.aow.opgebouwdSamen };
          if (result.geboortejaar) nieuwProfiel = { ...nieuwProfiel, partnerGeboortejaar: result.geboortejaar };
          if (result.naam) nieuwProfiel = { ...nieuwProfiel, partnerNaam: result.naam };
        }
        setProfiel(nieuwProfiel);

        const aowTekst = eigenaar === "ikzelf" && result.aow.opgebouwdSamen > 0
          ? ` · AOW € ${result.aow.opgebouwdSamen.toLocaleString("nl-NL")}/jr`
          : eigenaar === "partner" && result.aow.opgebouwdSamen > 0
          ? ` · Partner AOW € ${result.aow.opgebouwdSamen.toLocaleString("nl-NL")}/jr`
          : "";
        const naamTekst = result.naam ? ` (${result.naam})` : "";

        setImportStatus({ ok: true, tekst: `✅ ${nieuw.length} regelingen ingeladen voor ${eigenaar === "partner" ? "partner" + naamTekst : "jou"}${aowTekst}` });
        setTab("pensioenen");
      } catch (err) {
        console.error("[MPO] Fout:", err);
        setImportStatus({ ok: false, tekst: `❌ Fout: ${err.message}` });
      }
    };
    reader.onerror = () => setImportStatus({ ok: false, tekst: "❌ Kon bestand niet lezen" });
    reader.readAsText(file);
  }

  // ─── Backup export / import ──────────────────────────────────────────────────
  function exporteer() {
    const blob = new Blob([JSON.stringify({ pensioenen, profiel, vermogen, simulatie }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `pensioen-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
  }
  function importeerBackup(e) {
    const file = e.target.files[0]; if (!file) return; e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.pensioenen) setPensioenen(data.pensioenen);
        if (data.profiel)    setProfiel(data.profiel);
        if (data.vermogen)   setVermogen(data.vermogen);
        if (data.simulatie)  setSimulatie(data.simulatie);
        setImportStatus({ ok: true, tekst: "✅ Backup hersteld" });
      } catch { setImportStatus({ ok: false, tekst: "❌ Ongeldig backup bestand" }); }
    };
    reader.readAsText(file);
  }

  // ─── Berekeningen ─────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    return Array.from({ length: 26 }, (_, i) => {
      const leeftijd = profiel.pensioenLeeftijd + i;
      const jaar = JAAR_NU + (leeftijd - (JAAR_NU - profiel.geboortejaar));
      const partnerLeeftijd = leeftijd + (profiel.geboortejaar - profiel.partnerGeboortejaar);

      let pensioenEigen = 0, pensioenPartner = 0;
      pensioenen.forEach((p) => {
        if (p.eigenaar === "partner") {
          if (partnerLeeftijd >= p.startLeeftijd) pensioenPartner += p.bruto_jaar ?? 0;
        } else {
          if (leeftijd >= p.startLeeftijd) {
            if (p.type === "bankspaar") {
              const r = (p.rente ?? 2) / 100;
              pensioenEigen += r === 0 ? (p.saldo ?? 0) / 20 : ((p.saldo ?? 0) * r) / (1 - Math.pow(1 + r, -20));
            } else {
              pensioenEigen += p.bruto_jaar ?? 0;
            }
          }
        }
      });

      if (simulatie.aankoopJaar > 0 && leeftijd >= profiel.pensioenLeeftijd + simulatie.aankoopJaar) pensioenEigen += simulatie.aankoopUitkering * 12;

      const aowEigen = profiel.aowOpgebouwdSamen > 0
        ? (profiel.heeftPartner ? profiel.aowOpgebouwdSamen : profiel.aowOpgebouwdAlleen)
        : (profiel.heeftPartner ? AOW_SAMEN * 12 : AOW_ALLEEN * 12);

      let aowBruto = 0;
      if (leeftijd >= 67) aowBruto += aowEigen;
      if (profiel.heeftPartner && partnerLeeftijd >= 67) {
        aowBruto += profiel.partnerAowOpgebouwdSamen > 0 ? profiel.partnerAowOpgebouwdSamen : AOW_SAMEN * 12;
      }

      const spaargeldInkomen = leeftijd >= vermogen.spaargeldGebruikVanaf ? vermogen.spaargeldPerJaar : 0;
      const woningInkomen    = leeftijd >= vermogen.woningGebruikVanaf    ? vermogen.woningPerJaar    : 0;

      const pensioenBruto = Math.round(pensioenEigen + pensioenPartner);
      const totalBruto = Math.round(pensioenBruto + aowBruto + spaargeldInkomen + woningInkomen);
      const totalNetto = berekenNetto(pensioenEigen + aowBruto) + berekenNetto(pensioenPartner) + spaargeldInkomen + woningInkomen;

      return {
        leeftijd, jaar, pensioenBruto, pensioenEigen: Math.round(pensioenEigen),
        pensioenPartner: Math.round(pensioenPartner), aowBruto: Math.round(aowBruto),
        spaargeldInkomen: Math.round(spaargeldInkomen), woningInkomen: Math.round(woningInkomen),
        totalBruto, totalNetto: Math.round(totalNetto),
        totalNettoMaand: Math.round(totalNetto / 12), totalBrutoMaand: Math.round(totalBruto / 12),
      };
    });
  }, [pensioenen, profiel, vermogen, simulatie]);

  const ps = chartData[0];

  if (!geladen) return (
    <div style={{ background: "#0f1923", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#c9a84c", fontFamily: "Georgia,serif", fontSize: 18 }}>Gegevens laden...</div>
  );

  const eigenPensioenen  = pensioenen.filter(p => p.eigenaar !== "partner");
  const partnerPensioenen = pensioenen.filter(p => p.eigenaar === "partner");

  return (
    <div style={{ fontFamily: "'Georgia',serif", background: "#0f1923", minHeight: "100vh", color: "#e8dcc8" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1a2d3d,#0f1923)", borderBottom: "1px solid #2a4a5e", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#c9a84c" }}>
            🏦 Pensioen Planner <span style={{ fontSize: 11, color: "#555", fontWeight: 400 }}>{FIX_NR}</span>
          </h1>
          <p style={{ margin: "2px 0 0", color: "#7a9bb0", fontSize: 11 }}>Data blijft alleen op jouw apparaat</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {opgeslagen && <span style={{ fontSize: 11, color: "#4caf8a" }}>✓ {opgeslagen.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span>}
          <label style={{ ...btn("#5b9bd5"), cursor: "pointer" }} title="Jouw JSON of XML van mijnpensioenoverzicht.nl">
            📥 Mijn overzicht
            <input type="file" accept=".json,.xml" onChange={e => importeerMPO(e, "ikzelf")} style={{ display: "none" }} />
          </label>
          <label style={{ ...btn("#a084c9"), cursor: "pointer" }} title="XML of JSON van mijnpensioenoverzicht.nl van partner">
            👫 Partner overzicht
            <input type="file" accept=".json,.xml" onChange={e => importeerMPO(e, "partner")} style={{ display: "none" }} />
          </label>
          <button onClick={exporteer} style={btn("#c9a84c")}>⬇ Backup</button>
          <label style={{ ...btn("#7a9bb0"), cursor: "pointer" }}>
            ⬆ Herstel
            <input type="file" accept=".json" onChange={importeerBackup} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {/* Import melding */}
      {importStatus && (
        <div style={{ background: importStatus.ok ? "#1a3d2d" : "#3d1a1a", borderBottom: `1px solid ${importStatus.ok ? "#4caf8a" : "#e74c3c"}55`, padding: "10px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: importStatus.ok ? "#4caf8a" : "#e74c3c", fontSize: 13 }}>{importStatus.tekst}</span>
          <button onClick={() => setImportStatus(null)} style={{ background: "transparent", border: "none", color: "#7a9bb0", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", background: "#111d26", borderBottom: "1px solid #2a4a5e", overflowX: "auto" }}>
        {[["profiel","👤 Profiel"],["pensioenen","📄 Pensioenen"],["vermogen","🏠 Vermogen"],["simulatie","🎮 Simulatie"],["prognose","📈 Prognose"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{ padding: "12px 20px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", background: tab === key ? "#1a2d3d" : "transparent", color: tab === key ? "#c9a84c" : "#7a9bb0", borderBottom: tab === key ? "2px solid #c9a84c" : "2px solid transparent" }}>{label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 20px" }}>

        {/* PROFIEL */}
        {tab === "profiel" && <Section title="Profiel">
          <Grid>
            <Field label="Jouw geboortejaar" value={profiel.geboortejaar} onChange={v => setProfiel({ ...profiel, geboortejaar: +v })} type="number" />
            <Field label="Jouw pensioenleeftijd" value={profiel.pensioenLeeftijd} onChange={v => setProfiel({ ...profiel, pensioenLeeftijd: +v })} type="number" />
          </Grid>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}><input type="checkbox" checked={profiel.heeftPartner} onChange={e => setProfiel({ ...profiel, heeftPartner: e.target.checked })} style={{ marginRight: 8 }} />Ik heb een partner</label>
          </div>
          {profiel.heeftPartner && <Grid>
            <Field label={`Geboortejaar partner${profiel.partnerNaam ? ` (${profiel.partnerNaam})` : ""}`} value={profiel.partnerGeboortejaar} onChange={v => setProfiel({ ...profiel, partnerGeboortejaar: +v })} type="number" />
            <Field label="Pensioenleeftijd partner" value={profiel.partnerPensioenLeeftijd} onChange={v => setProfiel({ ...profiel, partnerPensioenLeeftijd: +v })} type="number" />
          </Grid>}

          {/* AOW blokken */}
          <div style={{ display: "grid", gridTemplateColumns: profiel.heeftPartner ? "1fr 1fr" : "1fr", gap: 16, marginBottom: 20 }}>
            {profiel.aowOpgebouwdSamen > 0 && (
              <div style={{ padding: 14, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e" }}>
                <p style={{ margin: "0 0 10px", color: "#5b9bd5", fontSize: 12, fontWeight: 600 }}>AOW jij (opgebouwd)</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <KPI label="Samenwonend/jr" value={`€ ${profiel.aowOpgebouwdSamen.toLocaleString("nl-NL")}`} />
                  <KPI label="Alleenstaand/jr" value={`€ ${profiel.aowOpgebouwdAlleen.toLocaleString("nl-NL")}`} />
                </div>
              </div>
            )}
            {profiel.heeftPartner && profiel.partnerAowOpgebouwdSamen > 0 && (
              <div style={{ padding: 14, background: "#1a2d3d", borderRadius: 10, border: "1px solid #3a2a5e" }}>
                <p style={{ margin: "0 0 10px", color: "#a084c9", fontSize: 12, fontWeight: 600 }}>AOW partner (opgebouwd)</p>
                <KPI label="Samenwonend/jr" value={`€ ${profiel.partnerAowOpgebouwdSamen.toLocaleString("nl-NL")}`} />
              </div>
            )}
          </div>

          <div style={{ padding: 20, background: "#1a2d3d", borderRadius: 12, border: "1px solid #2a4a5e" }}>
            <h3 style={{ margin: "0 0 14px", color: "#c9a84c", fontSize: 14 }}>📊 Huishouden bij pensionering (jouw leeftijd {profiel.pensioenLeeftijd})</h3>
            {ps && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(155px,1fr))", gap: 12 }}>
              <KPI label="Bruto/maand" value={`€ ${ps.totalBrutoMaand.toLocaleString("nl-NL")}`} />
              <KPI label="Netto/maand" value={`€ ${ps.totalNettoMaand.toLocaleString("nl-NL")}`} accent />
              <KPI label="Jouw pensioen/jr" value={`€ ${ps.pensioenEigen.toLocaleString("nl-NL")}`} />
              <KPI label="Partner pensioen/jr" value={`€ ${ps.pensioenPartner.toLocaleString("nl-NL")}`} partner />
              <KPI label="AOW totaal/jr" value={`€ ${ps.aowBruto.toLocaleString("nl-NL")}`} />
            </div>}
          </div>
        </Section>}

        {/* PENSIOENEN */}
        {tab === "pensioenen" && <Section title="Pensioenen & producten">
          <div style={{ padding: 14, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e", marginBottom: 20 }}>
            <p style={{ margin: 0, color: "#7a9bb0", fontSize: 13 }}>
              Gebruik <strong style={{ color: "#5b9bd5" }}>📥 Mijn overzicht</strong> voor jouw bestand en <strong style={{ color: "#a084c9" }}>👫 Partner overzicht</strong> voor het bestand van je partner.
            </p>
          </div>

          {/* Eigen pensioenen */}
          <h3 style={{ color: "#5b9bd5", fontSize: 14, marginBottom: 12 }}>👤 Jouw pensioenen</h3>
          {eigenPensioenen.length === 0
            ? <div style={{ padding: 20, color: "#4a6a7e", fontSize: 13, textAlign: "center" }}>Nog leeg — importeer jouw mijnpensioenoverzicht</div>
            : eigenPensioenen.map((p, i) => <PensioenRij key={p.id} p={p} i={i} alle={pensioenen} setPensioenen={setPensioenen} />)
          }

          {/* Partner pensioenen */}
          {profiel.heeftPartner && <>
            <h3 style={{ color: "#a084c9", fontSize: 14, marginBottom: 12, marginTop: 24 }}>👫 Partner pensioenen {profiel.partnerNaam ? `(${profiel.partnerNaam})` : ""}</h3>
            {partnerPensioenen.length === 0
              ? <div style={{ padding: 20, color: "#4a6a7e", fontSize: 13, textAlign: "center" }}>Nog leeg — importeer het mijnpensioenoverzicht van je partner</div>
              : partnerPensioenen.map((p, i) => <PensioenRij key={p.id} p={p} i={i} alle={pensioenen} setPensioenen={setPensioenen} partner />)
            }
          </>}

          <button onClick={() => setPensioenen([...pensioenen, { id: Date.now(), naam: "Nieuw pensioen", type: "pensioen", eigenaar: "ikzelf", bruto_jaar: 0, startLeeftijd: 67 }])}
            style={{ background: "#c9a84c22", border: "1px solid #c9a84c44", color: "#c9a84c", padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13, marginTop: 16 }}>
            + Handmatig toevoegen
          </button>
        </Section>}

        {/* VERMOGEN */}
        {tab === "vermogen" && <Section title="Spaargeld & Woning">
          <h3 style={{ color: "#c9a84c", fontSize: 14, marginBottom: 12 }}>💰 Spaargeld</h3>
          <Grid>
            <Field label="Totaal spaargeld (€)" value={vermogen.spaargeld} onChange={v=>setVermogen({...vermogen,spaargeld:+v})} type="number" />
            <Field label="Gebruik vanaf leeftijd" value={vermogen.spaargeldGebruikVanaf} onChange={v=>setVermogen({...vermogen,spaargeldGebruikVanaf:+v})} type="number" />
            <Field label="Per jaar opnemen (€)" value={vermogen.spaargeldPerJaar} onChange={v=>setVermogen({...vermogen,spaargeldPerJaar:+v})} type="number" />
          </Grid>
          <h3 style={{ color: "#c9a84c", fontSize: 14, marginBottom: 12, marginTop: 24 }}>🏠 Woning</h3>
          <Grid>
            <Field label="Woningwaarde (€)" value={vermogen.woningWaarde} onChange={v=>setVermogen({...vermogen,woningWaarde:+v})} type="number" />
            <Field label="Gebruik vanaf leeftijd" value={vermogen.woningGebruikVanaf} onChange={v=>setVermogen({...vermogen,woningGebruikVanaf:+v})} type="number" />
            <Field label="Inkomen per jaar (€)" value={vermogen.woningPerJaar} onChange={v=>setVermogen({...vermogen,woningPerJaar:+v})} type="number" />
          </Grid>
        </Section>}

        {/* SIMULATIE */}
        {tab === "simulatie" && <Section title="Pensioen aankoop simulatie">
          <Grid>
            <Field label="Aankoop X jaar na pensionering" value={simulatie.aankoopJaar} onChange={v=>setSimulatie({...simulatie,aankoopJaar:+v})} type="number" />
            <Field label="Aankoopbedrag (€)" value={simulatie.aankoopBedrag} onChange={v=>setSimulatie({...simulatie,aankoopBedrag:+v})} type="number" />
            <Field label="Extra uitkering per maand (€)" value={simulatie.aankoopUitkering} onChange={v=>setSimulatie({...simulatie,aankoopUitkering:+v})} type="number" />
          </Grid>
          {simulatie.aankoopJaar > 0 && (
            <div style={{ padding: 14, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e" }}>
              <p style={{ margin: 0, color: "#c9a84c" }}>Vanaf leeftijd <strong>{profiel.pensioenLeeftijd + simulatie.aankoopJaar}</strong> extra <strong>€ {(simulatie.aankoopUitkering * 12).toLocaleString("nl-NL")}</strong>/jr bruto.</p>
            </div>
          )}
        </Section>}

        {/* PROGNOSE */}
        {tab === "prognose" && <Section title="Inkomensprognose huishouden">
          <p style={{ color: "#7a9bb0", fontSize: 12, marginBottom: 18 }}>Gecombineerd inkomen over 25 jaar. Netto o.b.v. box 1 schijven 2024.</p>
          <div style={{ background: "#1a2d3d", borderRadius: 12, padding: 18, marginBottom: 20 }}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a4a5e" />
                <XAxis dataKey="leeftijd" stroke="#7a9bb0" tick={{ fontSize: 11 }} />
                <YAxis stroke="#7a9bb0" tick={{ fontSize: 11 }} tickFormatter={v=>`€${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v=>[`€ ${v.toLocaleString("nl-NL")}`]} labelFormatter={l=>`Leeftijd ${l}`} contentStyle={{ background: "#0f1923", border: "1px solid #2a4a5e", borderRadius: 8, fontSize: 12 }} />
                <Legend />
                <Line type="monotone" dataKey="totalBruto" name="Bruto" stroke="#c9a84c" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="totalNetto" name="Netto" stroke="#4caf8a" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="aowBruto" name="AOW" stroke="#5b9bd5" strokeWidth={1} dot={false} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="pensioenPartner" name="Partner pensioen" stroke="#a084c9" strokeWidth={1} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#1a2d3d" }}>
                  {["Lft","Jaar","Eigen pens/jr","Partner pens/jr","AOW/jr","Spaar/jr","Woning/jr","Bruto/mnd","Netto/mnd"].map(h=>(
                    <th key={h} style={{ padding: "8px 10px", textAlign: "right", color: "#c9a84c", borderBottom: "1px solid #2a4a5e", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chartData.map((r,i)=>(
                  <tr key={i} style={{ background: i%2===0?"#111d26":"#0f1923" }}>
                    <td style={{ ...cel, color: "#e8dcc8", fontWeight:600 }}>{r.leeftijd}</td>
                    <td style={cel}>{r.jaar}</td>
                    <td style={cel}>€ {r.pensioenEigen.toLocaleString("nl-NL")}</td>
                    <td style={{ ...cel, color: "#a084c9" }}>€ {r.pensioenPartner.toLocaleString("nl-NL")}</td>
                    <td style={cel}>€ {r.aowBruto.toLocaleString("nl-NL")}</td>
                    <td style={cel}>€ {r.spaargeldInkomen.toLocaleString("nl-NL")}</td>
                    <td style={cel}>€ {r.woningInkomen.toLocaleString("nl-NL")}</td>
                    <td style={{ ...cel, color: "#c9a84c" }}>€ {r.totalBrutoMaand.toLocaleString("nl-NL")}</td>
                    <td style={{ ...cel, color: "#4caf8a", fontWeight:600 }}>€ {r.totalNettoMaand.toLocaleString("nl-NL")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>}
      </div>
    </div>
  );
}

// ─── PensioenRij component ────────────────────────────────────────────────────
function PensioenRij({ p, alle, setPensioenen, partner }) {
  const idx = alle.findIndex(x => x.id === p.id);
  const kleur = partner ? "#a084c9" : "#5b9bd5";
  return (
    <div style={{ background: "#1a2d3d", border: `1px solid ${kleur}33`, borderRadius: 12, padding: 16, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
            <span>{p.type === "bankspaar" ? "🏦" : p.type === "lijfrente" ? "📋" : "🏛️"}</span>
            <input value={p.naam} onChange={e=>{const n=[...alle];n[idx]={...n[idx],naam:e.target.value};setPensioenen(n);}} style={{ ...inp, maxWidth: 280 }} />
          </div>
          {p.herkenning && <div style={{ fontSize: 11, color: "#4a6a7e", marginLeft: 24 }}>#{p.herkenning}{p.standPer ? ` · ${p.standPer}` : ""}</div>}
        </div>
        <button onClick={() => setPensioenen(alle.filter(x=>x.id!==p.id))} style={{ background: "#c0392b22", border: "1px solid #c0392b44", color: "#e74c3c", padding: "3px 9px", borderRadius: 6, cursor: "pointer", marginLeft: 10 }}>✕</button>
      </div>
      <Grid>
        <div>
          <label style={lbl}>Type</label>
          <select value={p.type} onChange={e=>{const n=[...alle];n[idx]={...n[idx],type:e.target.value};setPensioenen(n);}} style={inp}>
            <option value="pensioen">Pensioenfonds</option>
            <option value="bankspaar">Bankspaarrekening</option>
            <option value="lijfrente">Lijfrente</option>
          </select>
        </div>
        <Field label="Startleeftijd" value={p.startLeeftijd} onChange={v=>{const n=[...alle];n[idx]={...n[idx],startLeeftijd:+v};setPensioenen(n);}} type="number" />
        {p.type === "bankspaar" ? <>
          <Field label="Saldo (€)" value={p.saldo??0} onChange={v=>{const n=[...alle];n[idx]={...n[idx],saldo:+v};setPensioenen(n);}} type="number" />
          <Field label="Rente (%)" value={p.rente??2} onChange={v=>{const n=[...alle];n[idx]={...n[idx],rente:+v};setPensioenen(n);}} type="number" />
        </> : <Field label="Bruto/jr (€)" value={p.bruto_jaar??0} onChange={v=>{const n=[...alle];n[idx]={...n[idx],bruto_jaar:+v};setPensioenen(n);}} type="number" />}
      </Grid>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Section({ title, children }) {
  return <div><h2 style={{ color: "#c9a84c", fontSize: 18, marginBottom: 20, paddingBottom: 10, borderBottom: "1px solid #2a4a5e" }}>{title}</h2>{children}</div>;
}
function Grid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(185px,1fr))", gap: 12, marginBottom: 12 }}>{children}</div>;
}
function Field({ label, value, onChange, type="text" }) {
  return <div><label style={lbl}>{label}</label><input type={type} value={value} onChange={e=>onChange(e.target.value)} style={inp} /></div>;
}
function KPI({ label, value, accent, partner }) {
  const kleur = accent ? "#4caf8a" : partner ? "#a084c9" : "#c9a84c";
  return (
    <div style={{ background: "#111d26", borderRadius: 8, padding: "10px 14px", border: `1px solid ${kleur}44` }}>
      <div style={{ fontSize: 11, color: "#7a9bb0", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: kleur }}>{value}</div>
    </div>
  );
}

const inp = { width: "100%", padding: "7px 10px", background: "#111d26", border: "1px solid #2a4a5e", borderRadius: 7, color: "#e8dcc8", fontSize: 13, boxSizing: "border-box" };
const lbl = { display: "block", fontSize: 11, color: "#7a9bb0", marginBottom: 4 };
const cel = { padding: "7px 10px", textAlign: "right", color: "#a0b8c8" };
const btn = (color) => ({ background: `${color}22`, border: `1px solid ${color}44`, color, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 });
