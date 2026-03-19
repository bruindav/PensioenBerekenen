// PENSIOEN PLANNER - v2
// v2: fix MPO import (FileReader dubbele aanroep), favicon toegevoegd, console.log debug toegevoegd

import { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const FIX_NR = "v2";

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

// ─── MPO JSON parser ──────────────────────────────────────────────────────────
function parseerMPO(data) {
  console.log("[MPO] Start parseren JSON");
  const resultMap = {};
  const details = data?.Details?.OuderdomsPensioenDetails?.OuderdomsPensioen ?? [];
  console.log("[MPO] Aantal blokken:", details.length);

  details.forEach((blok) => {
    const startJaren = blok.Van?.Leeftijd?.Jaren ?? 67;
    (blok.IndicatiefPensioen ?? []).forEach((p) => {
      const herkenning = p.HerkenningsNummer;
      if (!herkenning) return;
      const bedrag = p.Opgebouwd ?? p.TeBereiken ?? 0;
      const key = `${herkenning}@${startJaren}`;
      if (!resultMap[key]) {
        resultMap[key] = {
          id: key, naam: p.PensioenUitvoerder, herkenning,
          type: "pensioen", bruto_jaar: bedrag,
          startLeeftijd: startJaren, standPer: p.StandPer,
        };
      }
    });
  });

  // Dedupliceer: zelfde herkenning + zelfde bedrag → bewaar alleen laagste startleeftijd
  const seen = {};
  const dedup = {};
  Object.values(resultMap)
    .sort((a, b) => a.startLeeftijd - b.startLeeftijd)
    .forEach((p) => {
      const base = p.herkenning;
      if (!seen[base]) {
        seen[base] = p.bruto_jaar;
        dedup[p.id] = p;
      } else if (p.bruto_jaar !== seen[base]) {
        dedup[p.id] = p;
        seen[base] = p.bruto_jaar;
      }
    });

  // AOW
  let aowOpgebouwdSamen = 0, aowOpgebouwdAlleen = 0;
  details.forEach((blok) => {
    const a = blok.AOW?.AOWDetailsOpbouw;
    if (a && a.OpgebouwdSamenwonend > aowOpgebouwdSamen) {
      aowOpgebouwdSamen = a.OpgebouwdSamenwonend;
      aowOpgebouwdAlleen = a.OpgebouwdAlleenstaand;
    }
  });

  const resultaat = { pensioenen: Object.values(dedup), aow: { opgebouwdSamen: aowOpgebouwdSamen, opgebouwdAlleen: aowOpgebouwdAlleen } };
  console.log("[MPO] Resultaat:", resultaat.pensioenen.length, "pensioenen, AOW samen:", aowOpgebouwdSamen);
  return resultaat;
}

// ─── MPO XML parser ───────────────────────────────────────────────────────────
function parseerMPOxml(xmlText) {
  console.log("[MPO] Start parseren XML");
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const resultMap = {};
  let aowOpgebouwdSamen = 0, aowOpgebouwdAlleen = 0;

  doc.querySelectorAll("OuderdomsPensioen").forEach((blok) => {
    const startJaren = parseInt(blok.querySelector("Van > Leeftijd > Jaren")?.textContent ?? "67");
    const aowSamen = parseInt(blok.querySelector("OpgebouwdSamenwonend")?.textContent ?? "0");
    if (aowSamen > aowOpgebouwdSamen) {
      aowOpgebouwdSamen = aowSamen;
      aowOpgebouwdAlleen = parseInt(blok.querySelector("OpgebouwdAlleenstaand")?.textContent ?? "0");
    }
    blok.querySelectorAll("IndicatiefPensioen").forEach((p) => {
      const herkenning = p.querySelector("HerkenningsNummer")?.textContent;
      if (!herkenning) return;
      const opgebouwd = parseInt(p.querySelector("Opgebouwd")?.textContent ?? "0");
      const teBereiken = parseInt(p.querySelector("TeBereiken")?.textContent ?? "0");
      const key = `${herkenning}@${startJaren}`;
      if (!resultMap[key]) {
        resultMap[key] = {
          id: key, naam: p.querySelector("PensioenUitvoerder")?.textContent ?? "Onbekend",
          herkenning, type: "pensioen", bruto_jaar: opgebouwd || teBereiken,
          startLeeftijd: startJaren, standPer: p.querySelector("StandPer")?.textContent,
        };
      }
    });
  });

  return { pensioenen: Object.values(resultMap), aow: { opgebouwdSamen: aowOpgebouwdSamen, opgebouwdAlleen: aowOpgebouwdAlleen } };
}

// ─── Default state ────────────────────────────────────────────────────────────
const DEFAULT = {
  pensioenen: [],
  profiel: { geboortejaar: 1970, pensioenLeeftijd: 67, partnerGeboortejaar: 1972, partnerPensioenLeeftijd: 67, heeftPartner: true, aowOpgebouwdSamen: 0, aowOpgebouwdAlleen: 0 },
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
          if (saved.profiel) setProfielRaw(saved.profiel);
          if (saved.vermogen) setVermogenRaw(saved.vermogen);
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

  function setPensioenen(v) { setPensioenenRaw(v); slaOp(v, profiel, vermogen, simulatie); }
  function setProfiel(v)   { setProfielRaw(v);   slaOp(pensioenen, v, vermogen, simulatie); }
  function setVermogen(v)  { setVermogenRaw(v);  slaOp(pensioenen, profiel, v, simulatie); }
  function setSimulatie(v) { setSimulatieRaw(v); slaOp(pensioenen, profiel, vermogen, v); }

  // ─── MPO import ─────────────────────────────────────────────────────────────
  function importeerMPO(e) {
    const file = e.target.files[0];
    console.log("[MPO] Bestand geselecteerd:", file?.name);
    if (!file) return;
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      console.log("[MPO] Bestand geladen, lengte:", ev.target.result?.length);
      try {
        let result;
        if (file.name.toLowerCase().endsWith(".json")) {
          const parsed = JSON.parse(ev.target.result);
          result = parseerMPO(parsed);
        } else if (file.name.toLowerCase().endsWith(".xml")) {
          result = parseerMPOxml(ev.target.result);
        } else {
          setImportStatus({ ok: false, tekst: "Gebruik .json of .xml van mijnpensioenoverzicht.nl" });
          return;
        }

        if (!result.pensioenen || result.pensioenen.length === 0) {
          setImportStatus({ ok: false, tekst: "❌ Geen pensioenregelingen gevonden in dit bestand." });
          return;
        }

        const nieuwePensioenen = result.pensioenen.map((p, i) => ({
          ...p, id: p.id || `import_${Date.now()}_${i}`,
        }));

        setPensioenen(nieuwePensioenen);

        if (result.aow.opgebouwdSamen > 0) {
          setProfiel({ ...profiel, aowOpgebouwdSamen: result.aow.opgebouwdSamen, aowOpgebouwdAlleen: result.aow.opgebouwdAlleen });
        }

        setImportStatus({
          ok: true,
          tekst: `✅ ${nieuwePensioenen.length} pensioenregelingen ingeladen${result.aow.opgebouwdSamen > 0 ? ` · AOW € ${result.aow.opgebouwdSamen.toLocaleString("nl-NL")}/jr opgebouwd` : ""}`,
        });
        setTab("pensioenen");
      } catch (err) {
        console.error("[MPO] Fout:", err);
        setImportStatus({ ok: false, tekst: `❌ Fout bij inlezen: ${err.message}` });
      }
    };
    reader.onerror = () => {
      console.error("[MPO] FileReader fout");
      setImportStatus({ ok: false, tekst: "❌ Kon bestand niet lezen" });
    };
    reader.readAsText(file); // ← één aanroep, geen duplicaat
  }

  // ─── Backup export / import ──────────────────────────────────────────────────
  function exporteer() {
    const blob = new Blob([JSON.stringify({ pensioenen, profiel, vermogen, simulatie }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pensioen-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  function importeerBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.pensioenen) setPensioenen(data.pensioenen);
        if (data.profiel) setProfiel(data.profiel);
        if (data.vermogen) setVermogen(data.vermogen);
        if (data.simulatie) setSimulatie(data.simulatie);
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

      let pensioenBruto = 0;
      pensioenen.forEach((p) => {
        if (leeftijd >= p.startLeeftijd) {
          if (p.type === "bankspaar") {
            const r = (p.rente ?? 2) / 100;
            pensioenBruto += r === 0 ? (p.saldo ?? 0) / 20 : ((p.saldo ?? 0) * r) / (1 - Math.pow(1 + r, -20));
          } else {
            pensioenBruto += p.bruto_jaar ?? 0;
          }
        }
      });

      if (simulatie.aankoopJaar > 0 && leeftijd >= profiel.pensioenLeeftijd + simulatie.aankoopJaar) {
        pensioenBruto += simulatie.aankoopUitkering * 12;
      }

      const aowEigen = profiel.aowOpgebouwdSamen > 0
        ? (profiel.heeftPartner ? profiel.aowOpgebouwdSamen : profiel.aowOpgebouwdAlleen)
        : (profiel.heeftPartner ? AOW_SAMEN * 12 : AOW_ALLEEN * 12);

      let aowBruto = 0;
      if (leeftijd >= 67) aowBruto += aowEigen;
      if (profiel.heeftPartner && partnerLeeftijd >= 67) aowBruto += AOW_SAMEN * 12;

      const spaargeldInkomen = leeftijd >= vermogen.spaargeldGebruikVanaf ? vermogen.spaargeldPerJaar : 0;
      const woningInkomen    = leeftijd >= vermogen.woningGebruikVanaf    ? vermogen.woningPerJaar    : 0;

      const totalBruto = Math.round(pensioenBruto + aowBruto + spaargeldInkomen + woningInkomen);
      const totalNetto = berekenNetto(pensioenBruto + aowBruto) + spaargeldInkomen + woningInkomen;

      return {
        leeftijd, jaar,
        pensioenBruto: Math.round(pensioenBruto), aowBruto: Math.round(aowBruto),
        spaargeldInkomen: Math.round(spaargeldInkomen), woningInkomen: Math.round(woningInkomen),
        totalBruto, totalNetto: Math.round(totalNetto),
        totalNettoMaand: Math.round(totalNetto / 12), totalBrutoMaand: Math.round(totalBruto / 12),
      };
    });
  }, [pensioenen, profiel, vermogen, simulatie]);

  const pensioenStart = chartData[0];

  if (!geladen) return (
    <div style={{ background: "#0f1923", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#c9a84c", fontFamily: "Georgia,serif", fontSize: 18 }}>
      Gegevens laden...
    </div>
  );

  return (
    <div style={{ fontFamily: "'Georgia',serif", background: "#0f1923", minHeight: "100vh", color: "#e8dcc8" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1a2d3d,#0f1923)", borderBottom: "1px solid #2a4a5e", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#c9a84c" }}>
            🏦 Pensioen Planner
            <span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 10 }}>{FIX_NR}</span>
          </h1>
          <p style={{ margin: "2px 0 0", color: "#7a9bb0", fontSize: 11 }}>Data blijft alleen op jouw apparaat</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {opgeslagen && <span style={{ fontSize: 11, color: "#4caf8a" }}>✓ {opgeslagen.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span>}
          <label style={{ ...btn("#5b9bd5"), cursor: "pointer" }} title="JSON of XML van mijnpensioenoverzicht.nl">
            📥 Mijnpensioenoverzicht
            <input type="file" accept=".json,.xml" onChange={importeerMPO} style={{ display: "none" }} />
          </label>
          <button onClick={exporteer} style={btn("#c9a84c")}>⬇ Backup</button>
          <label style={{ ...btn("#7a9bb0"), cursor: "pointer" }}>
            ⬆ Herstel backup
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
        {tab === "profiel" && <Section title="Jouw profiel">
          <Grid>
            <Field label="Geboortejaar" value={profiel.geboortejaar} onChange={v => setProfiel({ ...profiel, geboortejaar: +v })} type="number" />
            <Field label="Pensioenleeftijd" value={profiel.pensioenLeeftijd} onChange={v => setProfiel({ ...profiel, pensioenLeeftijd: +v })} type="number" />
          </Grid>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}><input type="checkbox" checked={profiel.heeftPartner} onChange={e => setProfiel({ ...profiel, heeftPartner: e.target.checked })} style={{ marginRight: 8 }} />Ik heb een partner</label>
          </div>
          {profiel.heeftPartner && <Grid>
            <Field label="Geboortejaar partner" value={profiel.partnerGeboortejaar} onChange={v => setProfiel({ ...profiel, partnerGeboortejaar: +v })} type="number" />
            <Field label="Pensioenleeftijd partner" value={profiel.partnerPensioenLeeftijd} onChange={v => setProfiel({ ...profiel, partnerPensioenLeeftijd: +v })} type="number" />
          </Grid>}
          {profiel.aowOpgebouwdSamen > 0 && (
            <div style={{ marginBottom: 20, padding: 14, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e" }}>
              <p style={{ margin: "0 0 10px", color: "#c9a84c", fontSize: 13, fontWeight: 600 }}>AOW opbouw (uit mijnpensioenoverzicht)</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <KPI label="Samenwonend opgebouwd/jr" value={`€ ${profiel.aowOpgebouwdSamen.toLocaleString("nl-NL")}`} />
                <KPI label="Alleenstaand opgebouwd/jr" value={`€ ${profiel.aowOpgebouwdAlleen.toLocaleString("nl-NL")}`} />
              </div>
            </div>
          )}
          <div style={{ padding: 20, background: "#1a2d3d", borderRadius: 12, border: "1px solid #2a4a5e" }}>
            <h3 style={{ margin: "0 0 14px", color: "#c9a84c", fontSize: 14 }}>📊 Bij pensionering (leeftijd {profiel.pensioenLeeftijd})</h3>
            {pensioenStart && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 12 }}>
              <KPI label="Bruto/maand" value={`€ ${pensioenStart.totalBrutoMaand.toLocaleString("nl-NL")}`} />
              <KPI label="Netto/maand" value={`€ ${pensioenStart.totalNettoMaand.toLocaleString("nl-NL")}`} accent />
              <KPI label="Pensioen bruto/jr" value={`€ ${pensioenStart.pensioenBruto.toLocaleString("nl-NL")}`} />
              <KPI label="AOW bruto/jr" value={`€ ${pensioenStart.aowBruto.toLocaleString("nl-NL")}`} />
            </div>}
          </div>
        </Section>}

        {/* PENSIOENEN */}
        {tab === "pensioenen" && <Section title="Mijn pensioenen & producten">
          <div style={{ padding: 14, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e", marginBottom: 20 }}>
            <p style={{ margin: 0, color: "#7a9bb0", fontSize: 13 }}>
              📥 Gebruik de knop <strong style={{ color: "#5b9bd5" }}>Mijnpensioenoverzicht</strong> bovenin om je JSON of XML in te lezen.
            </p>
          </div>
          {pensioenen.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "#4a6a7e", fontSize: 14 }}>Nog geen pensioenen. Importeer of voeg handmatig toe.</div>
          )}
          {pensioenen.map((p, i) => (
            <div key={p.id} style={{ background: "#1a2d3d", border: "1px solid #2a4a5e", borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
                    <span>{p.type === "bankspaar" ? "🏦" : p.type === "lijfrente" ? "📋" : "🏛️"}</span>
                    <input value={p.naam} onChange={e => { const n=[...pensioenen]; n[i]={...n[i],naam:e.target.value}; setPensioenen(n); }} style={{ ...inp, maxWidth: 300 }} />
                  </div>
                  {p.herkenning && <div style={{ fontSize: 11, color: "#4a6a7e", marginLeft: 24 }}>#{p.herkenning}{p.standPer ? ` · ${p.standPer}` : ""}</div>}
                </div>
                <button onClick={() => setPensioenen(pensioenen.filter((_,j)=>j!==i))} style={{ background: "#c0392b22", border: "1px solid #c0392b44", color: "#e74c3c", padding: "3px 9px", borderRadius: 6, cursor: "pointer", marginLeft: 10 }}>✕</button>
              </div>
              <Grid>
                <div>
                  <label style={lbl}>Type</label>
                  <select value={p.type} onChange={e=>{const n=[...pensioenen];n[i]={...n[i],type:e.target.value};setPensioenen(n);}} style={inp}>
                    <option value="pensioen">Pensioenfonds / verzekeraar</option>
                    <option value="bankspaar">Bankspaarrekening</option>
                    <option value="lijfrente">Lijfrente</option>
                  </select>
                </div>
                <Field label="Startleeftijd uitkering" value={p.startLeeftijd} onChange={v=>{const n=[...pensioenen];n[i]={...n[i],startLeeftijd:+v};setPensioenen(n);}} type="number" />
                {p.type === "bankspaar" ? <>
                  <Field label="Saldo (€)" value={p.saldo??0} onChange={v=>{const n=[...pensioenen];n[i]={...n[i],saldo:+v};setPensioenen(n);}} type="number" />
                  <Field label="Rente (%)" value={p.rente??2} onChange={v=>{const n=[...pensioenen];n[i]={...n[i],rente:+v};setPensioenen(n);}} type="number" />
                </> : (
                  <Field label="Bruto uitkering per jaar (€)" value={p.bruto_jaar??0} onChange={v=>{const n=[...pensioenen];n[i]={...n[i],bruto_jaar:+v};setPensioenen(n);}} type="number" />
                )}
              </Grid>
            </div>
          ))}
          <button onClick={() => setPensioenen([...pensioenen, { id: Date.now(), naam: "Nieuw pensioen", type: "pensioen", bruto_jaar: 0, startLeeftijd: 67 }])}
            style={{ background: "#c9a84c22", border: "1px solid #c9a84c44", color: "#c9a84c", padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
            + Handmatig toevoegen
          </button>
        </Section>}

        {/* VERMOGEN */}
        {tab === "vermogen" && <Section title="Spaargeld & Woning">
          <h3 style={{ color: "#c9a84c", fontSize: 14, marginBottom: 12 }}>💰 Spaargeld als inkomen</h3>
          <Grid>
            <Field label="Totaal spaargeld (€)" value={vermogen.spaargeld} onChange={v=>setVermogen({...vermogen,spaargeld:+v})} type="number" />
            <Field label="Gebruik vanaf leeftijd" value={vermogen.spaargeldGebruikVanaf} onChange={v=>setVermogen({...vermogen,spaargeldGebruikVanaf:+v})} type="number" />
            <Field label="Per jaar opnemen (€)" value={vermogen.spaargeldPerJaar} onChange={v=>setVermogen({...vermogen,spaargeldPerJaar:+v})} type="number" />
          </Grid>
          <h3 style={{ color: "#c9a84c", fontSize: 14, marginBottom: 12, marginTop: 24 }}>🏠 Woning als inkomen</h3>
          <p style={{ color: "#7a9bb0", fontSize: 12, marginBottom: 12 }}>Bijv. verzilverhypotheek, verhuur of verkoop + terughuur.</p>
          <Grid>
            <Field label="Woningwaarde (€)" value={vermogen.woningWaarde} onChange={v=>setVermogen({...vermogen,woningWaarde:+v})} type="number" />
            <Field label="Gebruik vanaf leeftijd" value={vermogen.woningGebruikVanaf} onChange={v=>setVermogen({...vermogen,woningGebruikVanaf:+v})} type="number" />
            <Field label="Inkomen per jaar (€)" value={vermogen.woningPerJaar} onChange={v=>setVermogen({...vermogen,woningPerJaar:+v})} type="number" />
          </Grid>
        </Section>}

        {/* SIMULATIE */}
        {tab === "simulatie" && <Section title="Pensioen aankoop simulatie">
          <p style={{ color: "#7a9bb0", fontSize: 13, marginBottom: 18 }}>Speel met extra pensioen aankopen — bijv. spaargeld omzetten naar een lijfrente.</p>
          <Grid>
            <Field label="Aankoop X jaar na pensionering" value={simulatie.aankoopJaar} onChange={v=>setSimulatie({...simulatie,aankoopJaar:+v})} type="number" />
            <Field label="Aankoopbedrag (€)" value={simulatie.aankoopBedrag} onChange={v=>setSimulatie({...simulatie,aankoopBedrag:+v})} type="number" />
            <Field label="Extra uitkering per maand (€)" value={simulatie.aankoopUitkering} onChange={v=>setSimulatie({...simulatie,aankoopUitkering:+v})} type="number" />
          </Grid>
          {simulatie.aankoopJaar > 0 && (
            <div style={{ marginTop: 18, padding: 14, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e" }}>
              <p style={{ margin: 0, color: "#c9a84c" }}>Vanaf leeftijd <strong>{profiel.pensioenLeeftijd + simulatie.aankoopJaar}</strong> ontvang je extra <strong>€ {(simulatie.aankoopUitkering * 12).toLocaleString("nl-NL")}</strong>/jr bruto.</p>
            </div>
          )}
        </Section>}

        {/* PROGNOSE */}
        {tab === "prognose" && <Section title="Inkomensprognose">
          <p style={{ color: "#7a9bb0", fontSize: 12, marginBottom: 18 }}>25 jaar na pensionering. Netto berekend o.b.v. box 1 schijven 2024 incl. ouderenkorting.</p>
          <div style={{ background: "#1a2d3d", borderRadius: 12, padding: 18, marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 12px", color: "#c9a84c", fontSize: 13 }}>Jaarinkomen bruto vs netto</h3>
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
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#1a2d3d" }}>
                  {["Lft","Jaar","Pensioen/jr","AOW/jr","Spaar/jr","Woning/jr","Bruto/mnd","Netto/mnd"].map(h=>(
                    <th key={h} style={{ padding: "8px 10px", textAlign: "right", color: "#c9a84c", borderBottom: "1px solid #2a4a5e", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chartData.map((r,i)=>(
                  <tr key={i} style={{ background: i%2===0?"#111d26":"#0f1923" }}>
                    <td style={{ ...cel, color: "#e8dcc8", fontWeight:600 }}>{r.leeftijd}</td>
                    <td style={cel}>{r.jaar}</td>
                    <td style={cel}>€ {r.pensioenBruto.toLocaleString("nl-NL")}</td>
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

function Section({ title, children }) {
  return <div><h2 style={{ color: "#c9a84c", fontSize: 18, marginBottom: 20, paddingBottom: 10, borderBottom: "1px solid #2a4a5e" }}>{title}</h2>{children}</div>;
}
function Grid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(185px,1fr))", gap: 12, marginBottom: 12 }}>{children}</div>;
}
function Field({ label, value, onChange, type="text" }) {
  return <div><label style={lbl}>{label}</label><input type={type} value={value} onChange={e=>onChange(e.target.value)} style={inp} /></div>;
}
function KPI({ label, value, accent }) {
  return (
    <div style={{ background: "#111d26", borderRadius: 8, padding: "10px 14px", border: `1px solid ${accent?"#4caf8a44":"#2a4a5e"}` }}>
      <div style={{ fontSize: 11, color: "#7a9bb0", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent?"#4caf8a":"#c9a84c" }}>{value}</div>
    </div>
  );
}

const inp = { width: "100%", padding: "7px 10px", background: "#111d26", border: "1px solid #2a4a5e", borderRadius: 7, color: "#e8dcc8", fontSize: 13, boxSizing: "border-box" };
const lbl = { display: "block", fontSize: 11, color: "#7a9bb0", marginBottom: 4 };
const cel = { padding: "7px 10px", textAlign: "right", color: "#a0b8c8" };
const btn = (color) => ({ background: `${color}22`, border: `1px solid ${color}44`, color, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 });
