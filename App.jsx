import { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
const DB_NAME = "pensioenPlanner";
const DB_VERSION = 1;
const STORE = "gegevens";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
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

// ─── Belasting 2024 (vereenvoudigd, box 1) ───────────────────────────────────
function berekenNetto(bruto) {
  if (bruto <= 0) return 0;
  const schijf1 = Math.min(bruto, 75518);
  const schijf2 = Math.max(0, bruto - 75518);
  let belasting = schijf1 * 0.3697 + schijf2 * 0.495;
  const ahk = bruto < 24812 ? 3362 : Math.max(0, 3362 - (bruto - 24812) * 0.06095);
  belasting = Math.max(0, belasting - ahk - 1982); // 1982 = ouderenkorting
  return Math.round(bruto - belasting);
}

const AOW_SAMEN = 1014;   // per persoon per maand bruto 2024
const AOW_ALLEEN = 1450;
const JAAR_NU = new Date().getFullYear();

// ─── Mijnpensioenoverzicht parser ─────────────────────────────────────────────
function parseerMPO(data) {
  // Groepeert per uitvoerder + herkenningsnummer, pakt het hoogste startleeftijdblok
  const uitvoerderMap = {};

  const details = data?.Details?.OuderdomsPensioenDetails?.OuderdomsPensioen ?? [];

  details.forEach((blok) => {
    const startJaren = blok.Van?.Leeftijd?.Jaren ?? 67;
    const pensioenen = blok.IndicatiefPensioen ?? [];

    pensioenen.forEach((p) => {
      const key = p.HerkenningsNummer;
      const bedrag = p.Opgebouwd ?? p.TeBereiken ?? 0;

      // Sla op, en overschrijf alleen als startleeftijd hoger is (meest actuele blok)
      if (!uitvoerderMap[key] || startJaren > uitvoerderMap[key].startLeeftijd) {
        uitvoerderMap[key] = {
          id: key,
          naam: p.PensioenUitvoerder,
          herkenning: p.HerkenningsNummer,
          type: "pensioen",
          bruto_jaar: bedrag,
          startLeeftijd: startJaren,
          standPer: p.StandPer,
        };
      }
    });
  });

  // AOW uit het meest complete blok (vanaf 67j3m)
  let aowOpgebouwdSamen = 0;
  let aowOpgebouwdAlleen = 0;
  details.forEach((blok) => {
    if (blok.AOW?.AOWDetailsOpbouw) {
      const a = blok.AOW.AOWDetailsOpbouw;
      if (a.OpgebouwdSamenwonend > aowOpgebouwdSamen) {
        aowOpgebouwdSamen = a.OpgebouwdSamenwonend;
        aowOpgebouwdAlleen = a.OpgebouwdAlleenstaand;
      }
    }
  });

  return {
    pensioenen: Object.values(uitvoerderMap),
    aow: { opgebouwdSamen: aowOpgebouwdSamen, opgebouwdAlleen: aowOpgebouwdAlleen },
  };
}

function parseerMPOxml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");

  // Converteer XML naar vergelijkbare structuur als JSON via DOM
  const uitvoerderMap = {};
  let aowOpgebouwdSamen = 0;
  let aowOpgebouwdAlleen = 0;

  const blokken = doc.querySelectorAll("OuderdomsPensioen");
  blokken.forEach((blok) => {
    const startJaren = parseInt(blok.querySelector("Van > Leeftijd > Jaren")?.textContent ?? "67");

    // AOW
    const aowSamen = parseInt(blok.querySelector("OpgebouwdSamenwonend")?.textContent ?? "0");
    if (aowSamen > aowOpgebouwdSamen) {
      aowOpgebouwdSamen = aowSamen;
      aowOpgebouwdAlleen = parseInt(blok.querySelector("OpgebouwdAlleenstaand")?.textContent ?? "0");
    }

    blok.querySelectorAll("IndicatiefPensioen").forEach((p) => {
      const key = p.querySelector("HerkenningsNummer")?.textContent;
      const naam = p.querySelector("PensioenUitvoerder")?.textContent ?? "Onbekend";
      const opgebouwd = parseInt(p.querySelector("Opgebouwd")?.textContent ?? "0");
      const teBereiken = parseInt(p.querySelector("TeBereiken")?.textContent ?? "0");
      const bedrag = opgebouwd || teBereiken;
      const standPer = p.querySelector("StandPer")?.textContent;

      if (key && (!uitvoerderMap[key] || startJaren > uitvoerderMap[key].startLeeftijd)) {
        uitvoerderMap[key] = {
          id: key, naam, herkenning: key,
          type: "pensioen", bruto_jaar: bedrag,
          startLeeftijd: startJaren, standPer,
        };
      }
    });
  });

  return {
    pensioenen: Object.values(uitvoerderMap),
    aow: { opgebouwdSamen: aowOpgebouwdSamen, opgebouwdAlleen: aowOpgebouwdAlleen },
  };
}

// ─── Default state ─────────────────────────────────────────────────────────
const DEFAULT_STATE = {
  pensioenen: [],
  profiel: {
    geboortejaar: 1970, pensioenLeeftijd: 67,
    partnerGeboortejaar: 1972, partnerPensioenLeeftijd: 67,
    heeftPartner: true,
    aowOpgebouwdSamen: 0, aowOpgebouwdAlleen: 0,
  },
  vermogen: {
    spaargeld: 0, spaargeldGebruikVanaf: 67, spaargeldPerJaar: 0,
    woningWaarde: 0, woningGebruikVanaf: 75, woningPerJaar: 0,
  },
  simulatie: { aankoopJaar: 0, aankoopBedrag: 10000, aankoopUitkering: 600 },
};

// ─── Hoofdcomponent ───────────────────────────────────────────────────────────
export default function PensioenApp() {
  const [tab, setTab] = useState("profiel");
  const [geladen, setGeladen] = useState(false);
  const [opgeslagen, setOpgeslagen] = useState(null);
  const [importStatus, setImportStatus] = useState(null);

  const [pensioenen, setPensioenenRaw] = useState(DEFAULT_STATE.pensioenen);
  const [profiel, setProfielRaw] = useState(DEFAULT_STATE.profiel);
  const [vermogen, setVermogenRaw] = useState(DEFAULT_STATE.vermogen);
  const [simulatie, setSimulatieRaw] = useState(DEFAULT_STATE.simulatie);

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
  function setProfiel(v) { setProfielRaw(v); slaOp(pensioenen, v, vermogen, simulatie); }
  function setVermogen(v) { setVermogenRaw(v); slaOp(pensioenen, profiel, v, simulatie); }
  function setSimulatie(v) { setSimulatieRaw(v); slaOp(pensioenen, profiel, vermogen, v); }

  // ─── MPO import handler ─────────────────────────────────────────────────
  function importeerMPO(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        let result;
        if (file.name.endsWith(".json")) {
          const data = JSON.parse(ev.target.result);
          result = parseerMPO(data);
        } else if (file.name.endsWith(".xml")) {
          result = parseerMPOxml(ev.target.result);
        } else {
          setImportStatus({ ok: false, tekst: "Onbekend bestandstype. Gebruik .json of .xml van mijnpensioenoverzicht.nl" });
          return;
        }

        // Voeg toe aan bestaande pensioenen (vervangt bij zelfde herkenningsnummer)
        setPensioenen(result.pensioenen.map((p, i) => ({ ...p, id: p.herkenning || Date.now() + i })));

        // Update AOW in profiel als gevonden
        if (result.aow.opgebouwdSamen > 0) {
          setProfiel({ ...profiel, aowOpgebouwdSamen: result.aow.opgebouwdSamen, aowOpgebouwdAlleen: result.aow.opgebouwdAlleen });
        }

        setImportStatus({
          ok: true,
          tekst: `✅ ${result.pensioenen.length} pensioenregelingen ingeladen${result.aow.opgebouwdSamen > 0 ? ` + AOW opbouw (€ ${result.aow.opgebouwdSamen.toLocaleString("nl-NL")}/jr samenwonend)` : ""}`,
        });
        setTab("pensioenen");
      } catch (err) {
        setImportStatus({ ok: false, tekst: `❌ Fout bij inlezen: ${err.message}` });
      }
    };
    reader.readAsText(ev.target.result ? undefined : file);
    reader.readAsText(file);
    e.target.value = "";
  }

  // ─── Backup export/import ───────────────────────────────────────────────
  function exporteer() {
    const data = JSON.stringify({ pensioenen, profiel, vermogen, simulatie }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pensioen-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  function importeerBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
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
    e.target.value = "";
  }

  // ─── Berekeningen ───────────────────────────────────────────────────────
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
            pensioenBruto += r === 0 ? p.saldo / 20 : (p.saldo * r) / (1 - Math.pow(1 + r, -20));
          } else {
            pensioenBruto += p.bruto_jaar ?? 0;
          }
        }
      });

      if (simulatie.aankoopJaar > 0 && leeftijd >= profiel.pensioenLeeftijd + simulatie.aankoopJaar) {
        pensioenBruto += simulatie.aankoopUitkering * 12;
      }

      // AOW: gebruik opgebouwd bedrag als beschikbaar, anders standaard
      const aowEigen = profiel.aowOpgebouwdSamen > 0
        ? (profiel.heeftPartner ? profiel.aowOpgebouwdSamen : profiel.aowOpgebouwdAlleen)
        : (profiel.heeftPartner ? AOW_SAMEN * 12 : AOW_ALLEEN * 12);

      let aowBruto = 0;
      if (leeftijd >= 67) aowBruto += aowEigen;
      if (profiel.heeftPartner && partnerLeeftijd >= 67) aowBruto += AOW_SAMEN * 12; // partner AOW standaard

      const spaargeldInkomen = leeftijd >= vermogen.spaargeldGebruikVanaf ? vermogen.spaargeldPerJaar : 0;
      const woningInkomen = leeftijd >= vermogen.woningGebruikVanaf ? vermogen.woningPerJaar : 0;

      const totalBruto = Math.round(pensioenBruto + aowBruto + spaargeldInkomen + woningInkomen);
      const totalNetto = berekenNetto(pensioenBruto + aowBruto) + spaargeldInkomen + woningInkomen;

      return {
        leeftijd, jaar,
        pensioenBruto: Math.round(pensioenBruto),
        aowBruto: Math.round(aowBruto),
        spaargeldInkomen: Math.round(spaargeldInkomen),
        woningInkomen: Math.round(woningInkomen),
        totalBruto,
        totalNetto: Math.round(totalNetto),
        totalNettoMaand: Math.round(totalNetto / 12),
        totalBrutoMaand: Math.round(totalBruto / 12),
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
    <div style={{ fontFamily: "'Georgia', serif", background: "#0f1923", minHeight: "100vh", color: "#e8dcc8" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1a2d3d,#0f1923)", borderBottom: "1px solid #2a4a5e", padding: "18px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#c9a84c" }}>🏦 Pensioen Planner</h1>
          <p style={{ margin: "3px 0 0", color: "#7a9bb0", fontSize: 12 }}>Data blijft alleen op jouw apparaat (IndexedDB)</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {opgeslagen && <span style={{ fontSize: 11, color: "#4caf8a" }}>✓ {opgeslagen.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span>}

          {/* MPO Import knop */}
          <label style={{ ...btnStyle("#5b9bd5"), cursor: "pointer", display: "inline-block" }} title="Importeer JSON of XML van mijnpensioenoverzicht.nl">
            📥 Mijnpensioenoverzicht
            <input type="file" accept=".json,.xml" onChange={importeerMPO} style={{ display: "none" }} />
          </label>

          <button onClick={exporteer} style={btnStyle("#c9a84c")}>⬇ Backup</button>
          <label style={{ ...btnStyle("#7a9bb0"), cursor: "pointer", display: "inline-block" }}>
            ⬆ Herstel
            <input type="file" accept=".json" onChange={importeerBackup} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {/* Import status melding */}
      {importStatus && (
        <div style={{ background: importStatus.ok ? "#1a3d2d" : "#3d1a1a", borderBottom: `1px solid ${importStatus.ok ? "#4caf8a" : "#e74c3c"}`, padding: "10px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: importStatus.ok ? "#4caf8a" : "#e74c3c", fontSize: 13 }}>{importStatus.tekst}</span>
          <button onClick={() => setImportStatus(null)} style={{ background: "transparent", border: "none", color: "#7a9bb0", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", background: "#111d26", borderBottom: "1px solid #2a4a5e", overflowX: "auto" }}>
        {[["profiel", "👤 Profiel"], ["pensioenen", "📄 Pensioenen"], ["vermogen", "🏠 Vermogen"], ["simulatie", "🎮 Simulatie"], ["prognose", "📈 Prognose"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: "13px 20px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
            background: tab === key ? "#1a2d3d" : "transparent",
            color: tab === key ? "#c9a84c" : "#7a9bb0",
            borderBottom: tab === key ? "2px solid #c9a84c" : "2px solid transparent",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 20px" }}>

        {/* ── PROFIEL ── */}
        {tab === "profiel" && (
          <Section title="Jouw profiel">
            <Grid>
              <Field label="Geboortejaar" value={profiel.geboortejaar} onChange={v => setProfiel({ ...profiel, geboortejaar: +v })} type="number" />
              <Field label="Pensioenleeftijd" value={profiel.pensioenLeeftijd} onChange={v => setProfiel({ ...profiel, pensioenLeeftijd: +v })} type="number" />
            </Grid>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>
                <input type="checkbox" checked={profiel.heeftPartner} onChange={e => setProfiel({ ...profiel, heeftPartner: e.target.checked })} style={{ marginRight: 8 }} />
                Ik heb een partner
              </label>
            </div>
            {profiel.heeftPartner && (
              <Grid>
                <Field label="Geboortejaar partner" value={profiel.partnerGeboortejaar} onChange={v => setProfiel({ ...profiel, partnerGeboortejaar: +v })} type="number" />
                <Field label="Pensioenleeftijd partner" value={profiel.partnerPensioenLeeftijd} onChange={v => setProfiel({ ...profiel, partnerPensioenLeeftijd: +v })} type="number" />
              </Grid>
            )}

            {/* AOW opbouw uit MPO */}
            {profiel.aowOpgebouwdSamen > 0 && (
              <div style={{ marginBottom: 20, padding: 16, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e" }}>
                <p style={{ margin: "0 0 8px", color: "#c9a84c", fontSize: 13, fontWeight: 600 }}>AOW opbouw (uit mijnpensioenoverzicht)</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <KPI label="AOW samenwonend (opgebouwd/jr)" value={`€ ${profiel.aowOpgebouwdSamen.toLocaleString("nl-NL")}`} />
                  <KPI label="AOW alleenstaand (opgebouwd/jr)" value={`€ ${profiel.aowOpgebouwdAlleen.toLocaleString("nl-NL")}`} />
                </div>
              </div>
            )}

            {/* Samenvatting */}
            <div style={{ marginTop: 24, padding: 24, background: "#1a2d3d", borderRadius: 12, border: "1px solid #2a4a5e" }}>
              <h3 style={{ margin: "0 0 16px", color: "#c9a84c", fontSize: 15 }}>📊 Bij pensionering (leeftijd {profiel.pensioenLeeftijd})</h3>
              {pensioenStart && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 14 }}>
                  <KPI label="Bruto per maand" value={`€ ${pensioenStart.totalBrutoMaand.toLocaleString("nl-NL")}`} />
                  <KPI label="Netto per maand" value={`€ ${pensioenStart.totalNettoMaand.toLocaleString("nl-NL")}`} accent />
                  <KPI label="Pensioen bruto/jr" value={`€ ${pensioenStart.pensioenBruto.toLocaleString("nl-NL")}`} />
                  <KPI label="AOW bruto/jr" value={`€ ${pensioenStart.aowBruto.toLocaleString("nl-NL")}`} />
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── PENSIOENEN ── */}
        {tab === "pensioenen" && (
          <Section title="Mijn pensioenen & producten">
            <div style={{ padding: 16, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e", marginBottom: 24 }}>
              <p style={{ margin: 0, color: "#7a9bb0", fontSize: 13 }}>
                📥 Gebruik de knop <strong style={{ color: "#5b9bd5" }}>Mijnpensioenoverzicht</strong> bovenin om je JSON of XML bestand van{" "}
                <strong style={{ color: "#c9a84c" }}>mijnpensioenoverzicht.nl</strong> direct in te lezen. Daarna kun je hier aanvullen of corrigeren.
              </p>
            </div>

            {pensioenen.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "#7a9bb0", fontSize: 14 }}>
                Nog geen pensioenen. Importeer je mijnpensioenoverzicht of voeg handmatig toe.
              </div>
            )}

            {pensioenen.map((p, i) => (
              <div key={p.id} style={{ background: "#1a2d3d", border: "1px solid #2a4a5e", borderRadius: 12, padding: 18, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 18 }}>{p.type === "bankspaar" ? "🏦" : p.type === "lijfrente" ? "📋" : "🏛️"}</span>
                      <input value={p.naam} onChange={e => { const n = [...pensioenen]; n[i] = { ...n[i], naam: e.target.value }; setPensioenen(n); }} style={{ ...inputStyle, maxWidth: 320 }} />
                    </div>
                    {p.herkenning && <span style={{ fontSize: 11, color: "#4a6a7e", marginLeft: 28 }}>#{p.herkenning}{p.standPer ? ` · stand ${p.standPer}` : ""}</span>}
                  </div>
                  <button onClick={() => setPensioenen(pensioenen.filter((_, j) => j !== i))} style={{ background: "#c0392b22", border: "1px solid #c0392b44", color: "#e74c3c", padding: "4px 10px", borderRadius: 6, cursor: "pointer", marginLeft: 12 }}>✕</button>
                </div>
                <Grid>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select value={p.type} onChange={e => { const n = [...pensioenen]; n[i] = { ...n[i], type: e.target.value }; setPensioenen(n); }} style={inputStyle}>
                      <option value="pensioen">Pensioenfonds</option>
                      <option value="bankspaar">Bankspaarrekening</option>
                      <option value="lijfrente">Lijfrente</option>
                    </select>
                  </div>
                  <Field label="Startleeftijd uitkering" value={p.startLeeftijd} onChange={v => { const n = [...pensioenen]; n[i] = { ...n[i], startLeeftijd: +v }; setPensioenen(n); }} type="number" />
                  {p.type === "bankspaar" ? (
                    <>
                      <Field label="Saldo (€)" value={p.saldo ?? 0} onChange={v => { const n = [...pensioenen]; n[i] = { ...n[i], saldo: +v }; setPensioenen(n); }} type="number" />
                      <Field label="Rente (%)" value={p.rente ?? 2} onChange={v => { const n = [...pensioenen]; n[i] = { ...n[i], rente: +v }; setPensioenen(n); }} type="number" />
                    </>
                  ) : (
                    <Field label="Bruto uitkering per jaar (€)" value={p.bruto_jaar ?? 0} onChange={v => { const n = [...pensioenen]; n[i] = { ...n[i], bruto_jaar: +v }; setPensioenen(n); }} type="number" />
                  )}
                </Grid>
              </div>
            ))}

            <button onClick={() => setPensioenen([...pensioenen, { id: Date.now(), naam: "Nieuw pensioen", type: "pensioen", bruto_jaar: 0, startLeeftijd: 67 }])}
              style={{ background: "#c9a84c22", border: "1px solid #c9a84c44", color: "#c9a84c", padding: "10px 20px", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
              + Handmatig toevoegen
            </button>
          </Section>
        )}

        {/* ── VERMOGEN ── */}
        {tab === "vermogen" && (
          <Section title="Spaargeld & Woning">
            <h3 style={{ color: "#c9a84c", fontSize: 15, marginBottom: 14 }}>💰 Spaargeld als inkomen</h3>
            <Grid>
              <Field label="Totaal spaargeld (€)" value={vermogen.spaargeld} onChange={v => setVermogen({ ...vermogen, spaargeld: +v })} type="number" />
              <Field label="Gebruik vanaf leeftijd" value={vermogen.spaargeldGebruikVanaf} onChange={v => setVermogen({ ...vermogen, spaargeldGebruikVanaf: +v })} type="number" />
              <Field label="Per jaar opnemen (€)" value={vermogen.spaargeldPerJaar} onChange={v => setVermogen({ ...vermogen, spaargeldPerJaar: +v })} type="number" />
            </Grid>
            <h3 style={{ color: "#c9a84c", fontSize: 15, marginBottom: 14, marginTop: 28 }}>🏠 Woning als inkomen</h3>
            <p style={{ color: "#7a9bb0", fontSize: 13, marginBottom: 14 }}>Bijv. via verzilverhypotheek, verhuur of verkoop + terughuur.</p>
            <Grid>
              <Field label="Woningwaarde (€)" value={vermogen.woningWaarde} onChange={v => setVermogen({ ...vermogen, woningWaarde: +v })} type="number" />
              <Field label="Gebruik vanaf leeftijd" value={vermogen.woningGebruikVanaf} onChange={v => setVermogen({ ...vermogen, woningGebruikVanaf: +v })} type="number" />
              <Field label="Inkomen per jaar (€)" value={vermogen.woningPerJaar} onChange={v => setVermogen({ ...vermogen, woningPerJaar: +v })} type="number" />
            </Grid>
          </Section>
        )}

        {/* ── SIMULATIE ── */}
        {tab === "simulatie" && (
          <Section title="Pensioen aankoop simulatie">
            <p style={{ color: "#7a9bb0", fontSize: 13, marginBottom: 20 }}>Speel met het aankopen van extra pensioen — bijv. spaargeld omzetten naar een lijfrente op een later moment.</p>
            <Grid>
              <Field label="Aankoop X jaar na pensionering" value={simulatie.aankoopJaar} onChange={v => setSimulatie({ ...simulatie, aankoopJaar: +v })} type="number" />
              <Field label="Aankoopbedrag (€)" value={simulatie.aankoopBedrag} onChange={v => setSimulatie({ ...simulatie, aankoopBedrag: +v })} type="number" />
              <Field label="Extra uitkering per maand (€)" value={simulatie.aankoopUitkering} onChange={v => setSimulatie({ ...simulatie, aankoopUitkering: +v })} type="number" />
            </Grid>
            {simulatie.aankoopJaar > 0 && (
              <div style={{ marginTop: 20, padding: 16, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e" }}>
                <p style={{ margin: 0, color: "#c9a84c" }}>
                  Vanaf leeftijd <strong>{profiel.pensioenLeeftijd + simulatie.aankoopJaar}</strong> ontvang je extra{" "}
                  <strong>€ {(simulatie.aankoopUitkering * 12).toLocaleString("nl-NL")}</strong>/jr bruto.
                </p>
              </div>
            )}
          </Section>
        )}

        {/* ── PROGNOSE ── */}
        {tab === "prognose" && (
          <Section title="Inkomensprognose">
            <p style={{ color: "#7a9bb0", fontSize: 13, marginBottom: 20 }}>25 jaar na pensionering. Netto is berekend o.b.v. box 1 schijven 2024 incl. ouderenkorting.</p>
            <div style={{ background: "#1a2d3d", borderRadius: 12, padding: 20, marginBottom: 24 }}>
              <h3 style={{ margin: "0 0 14px", color: "#c9a84c", fontSize: 14 }}>Jaarinkomen bruto vs netto</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a4a5e" />
                  <XAxis dataKey="leeftijd" stroke="#7a9bb0" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#7a9bb0" tick={{ fontSize: 11 }} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => [`€ ${v.toLocaleString("nl-NL")}`]} labelFormatter={l => `Leeftijd ${l}`} contentStyle={{ background: "#0f1923", border: "1px solid #2a4a5e", borderRadius: 8, fontSize: 12 }} />
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
                    {["Lft", "Jaar", "Pensioen/jr", "AOW/jr", "Spaar/jr", "Woning/jr", "Bruto/mnd", "Netto/mnd"].map(h => (
                      <th key={h} style={{ padding: "9px 10px", textAlign: "right", color: "#c9a84c", borderBottom: "1px solid #2a4a5e", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#111d26" : "#0f1923" }}>
                      <td style={{ ...cellStyle, color: "#e8dcc8", fontWeight: 600 }}>{r.leeftijd}</td>
                      <td style={cellStyle}>{r.jaar}</td>
                      <td style={cellStyle}>€ {r.pensioenBruto.toLocaleString("nl-NL")}</td>
                      <td style={cellStyle}>€ {r.aowBruto.toLocaleString("nl-NL")}</td>
                      <td style={cellStyle}>€ {r.spaargeldInkomen.toLocaleString("nl-NL")}</td>
                      <td style={cellStyle}>€ {r.woningInkomen.toLocaleString("nl-NL")}</td>
                      <td style={{ ...cellStyle, color: "#c9a84c" }}>€ {r.totalBrutoMaand.toLocaleString("nl-NL")}</td>
                      <td style={{ ...cellStyle, color: "#4caf8a", fontWeight: 600 }}>€ {r.totalNettoMaand.toLocaleString("nl-NL")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div>
      <h2 style={{ color: "#c9a84c", fontSize: 19, marginBottom: 22, paddingBottom: 10, borderBottom: "1px solid #2a4a5e" }}>{title}</h2>
      {children}
    </div>
  );
}
function Grid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 14, marginBottom: 14 }}>{children}</div>;
}
function Field({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
}
function KPI({ label, value, accent }) {
  return (
    <div style={{ background: "#111d26", borderRadius: 8, padding: "10px 14px", border: `1px solid ${accent ? "#4caf8a44" : "#2a4a5e"}` }}>
      <div style={{ fontSize: 11, color: "#7a9bb0", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ? "#4caf8a" : "#c9a84c" }}>{value}</div>
    </div>
  );
}

const inputStyle = { width: "100%", padding: "7px 11px", background: "#111d26", border: "1px solid #2a4a5e", borderRadius: 7, color: "#e8dcc8", fontSize: 13, boxSizing: "border-box" };
const labelStyle = { display: "block", fontSize: 11, color: "#7a9bb0", marginBottom: 5 };
const cellStyle = { padding: "7px 10px", textAlign: "right", color: "#a0b8c8" };
const btnStyle = (color) => ({ background: `${color}22`, border: `1px solid ${color}44`, color, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 });
