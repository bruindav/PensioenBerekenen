// PENSIOEN PLANNER - src/App.jsx
// v4: één universele import knop, auto-detectie eigenaar via naam/geboortedatum,
//     fix "E is not a function" (PensioenRij buiten App component geplaatst),
//     beide XML formaten (IndicatiefPensioen + Pensioen) en JSON ondersteund

import { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const FIX_NR = "v4";

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

// ─── Universele MPO parser ────────────────────────────────────────────────────
// Herkent automatisch naam + geboortedatum uit het bestand
// Ondersteunt JSON (IndicatiefPensioen) en XML (IndicatiefPensioen of Pensioen)
function parseerBestand(inhoud, bestandsnaam) {
  const isJSON = bestandsnaam.toLowerCase().endsWith(".json");
  const isXML  = bestandsnaam.toLowerCase().endsWith(".xml");
  if (!isJSON && !isXML) throw new Error("Gebruik .json of .xml van mijnpensioenoverzicht.nl");
  return isJSON ? parseerJSON(inhoud) : parseerXML(inhoud);
}

function parseerJSON(tekst) {
  const data = JSON.parse(tekst);

  // Naam en geboortedatum zitten niet standaard in de JSON export — gebruik leeg
  const naam = null;
  const geboortejaar = null;

  const resultMap = {};
  const details = data?.Details?.OuderdomsPensioenDetails?.OuderdomsPensioen ?? [];

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

  let aowSamen = 0, aowAlleen = 0;
  details.forEach((blok) => {
    const a = blok.AOW?.AOWDetailsOpbouw;
    if (a && a.OpgebouwdSamenwonend > aowSamen) {
      aowSamen = a.OpgebouwdSamenwonend;
      aowAlleen = a.OpgebouwdAlleenstaand;
    }
  });

  return { pensioenen: dedup(resultMap), aow: { samen: aowSamen, alleen: aowAlleen }, naam, geboortejaar };
}

function parseerXML(tekst) {
  const doc = new DOMParser().parseFromString(tekst, "application/xml");

  // getElementsByTagName werkt ook als er een xmlns namespace is
  const g = (el, tag) => el.getElementsByTagName(tag);
  const t = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";

  // Naam en geboortedatum
  const naam = t(doc, "Naam") || null;
  const gbStr = t(doc, "Geboortedatum");
  const geboortejaar = gbStr ? parseInt(gbStr.split("-")[0]) : null;

  const resultMap = {};
  let aowSamen = 0, aowAlleen = 0;

  const blokken = g(doc, "OuderdomsPensioen");
  for (let b = 0; b < blokken.length; b++) {
    const blok = blokken[b];
    const vanEl = g(blok, "Van")[0];
    const startJaren = parseInt(vanEl ? t(vanEl, "Jaren") || "67" : "67");

    // AOW
    const aowEl = g(blok, "AOWDetailsOpbouw")[0];
    if (aowEl) {
      const s = parseInt(t(aowEl, "OpgebouwdSamenwonend") || "0");
      if (s > aowSamen) {
        aowSamen = s;
        aowAlleen = parseInt(t(aowEl, "OpgebouwdAlleenstaand") || "0");
      }
    }

    // Polissen: probeer IndicatiefPensioen, anders Pensioen
    let polissen = g(blok, "IndicatiefPensioen");
    if (polissen.length === 0) polissen = g(blok, "Pensioen");

    for (let p = 0; p < polissen.length; p++) {
      const pEl = polissen[p];
      const herkenning = t(pEl, "HerkenningsNummer");
      if (!herkenning) continue;
      const opgebouwd  = parseInt(t(pEl, "Opgebouwd")  || "0");
      const teBereiken = parseInt(t(pEl, "TeBereiken") || "0");
      const key = `${herkenning}@${startJaren}`;
      if (!resultMap[key]) {
        resultMap[key] = {
          id: key, naam: t(pEl, "PensioenUitvoerder") || "Onbekend", herkenning,
          type: "pensioen", bruto_jaar: opgebouwd || teBereiken,
          startLeeftijd: startJaren, standPer: t(pEl, "StandPer"),
        };
      }
    }
  }

  return { pensioenen: dedup(resultMap), aow: { samen: aowSamen, alleen: aowAlleen }, naam, geboortejaar };
}

// Dedupliceer: zelfde herkenning + zelfde bedrag → bewaar laagste startleeftijd
function dedup(resultMap) {
  const seen = {};
  const out  = {};
  Object.values(resultMap)
    .sort((a, b) => a.startLeeftijd - b.startLeeftijd)
    .forEach((p) => {
      if (!seen[p.herkenning]) {
        seen[p.herkenning] = p.bruto_jaar;
        out[p.id] = p;
      } else if (p.bruto_jaar !== seen[p.herkenning]) {
        out[p.id] = p;
        seen[p.herkenning] = p.bruto_jaar;
      }
    });
  return Object.values(out);
}

// ─── Default state ────────────────────────────────────────────────────────────
const DEFAULT = {
  personen: [],   // [{ id, naam, geboortejaar, pensioenLeeftijd, isHoofd, aowSamen, aowAlleen }]
  pensioenen: [], // [..., eigenaarId verwijst naar persoon.id]
  vermogen: { spaargeld: 0, spaargeldGebruikVanaf: 67, spaargeldPerJaar: 0, woningWaarde: 0, woningGebruikVanaf: 75, woningPerJaar: 0 },
  simulatie: { aankoopJaar: 0, aankoopBedrag: 10000, aankoopUitkering: 600 },
};

// ─── App ──────────────────────────────────────────────────────────────────────
export default function PensioenApp() {
  const [tab, setTab]           = useState("profiel");
  const [geladen, setGeladen]   = useState(false);
  const [opgeslagen, setOpgeslagen] = useState(null);
  const [importStatus, setImportStatus] = useState(null);

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
      } catch (e) { console.warn("Laden mislukt:", e); }
      setGeladen(true);
    })();
  }, []);

  async function slaOp(pe, ps, v, s) {
    try {
      await dbSet("state", { personen: pe, pensioenen: ps, vermogen: v, simulatie: s });
      setOpgeslagen(new Date());
    } catch (e) { console.warn("Opslaan mislukt:", e); }
  }
  function setPersonen(v)   { setPersonenRaw(v);   slaOp(v, pensioenen, vermogen, simulatie); }
  function setPensioenen(v) { setPensioenenRaw(v); slaOp(personen, v, vermogen, simulatie); }
  function setVermogen(v)   { setVermogenRaw(v);   slaOp(personen, pensioenen, v, simulatie); }
  function setSimulatie(v)  { setSimulatieRaw(v);  slaOp(personen, pensioenen, vermogen, v); }

  // ─── Import ─────────────────────────────────────────────────────────────────
  function importeerBestand(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const result = parseerBestand(ev.target.result, file.name);

        if (!result.pensioenen?.length) {
          setImportStatus({ ok: false, tekst: "❌ Geen pensioenregelingen gevonden in dit bestand." });
          return;
        }

        // Bepaal eigenaar: zoek bestaande persoon op naam of voeg nieuwe toe
        let eigenaarId;
        let nieuwePersonen = [...personen];

        if (result.naam) {
          // XML bestand met naam erin — zoek of maak persoon
          const bestaand = personen.find(p => p.naam === result.naam);
          if (bestaand) {
            eigenaarId = bestaand.id;
            // Update geboortejaar als we dat nu weten
            if (result.geboortejaar && !bestaand.geboortejaar) {
              nieuwePersonen = nieuwePersonen.map(p => p.id === eigenaarId ? { ...p, geboortejaar: result.geboortejaar } : p);
            }
          } else {
            eigenaarId = `persoon_${Date.now()}`;
            const isHoofd = personen.length === 0;
            nieuwePersonen = [...personen, {
              id: eigenaarId,
              naam: result.naam,
              geboortejaar: result.geboortejaar ?? 1970,
              pensioenLeeftijd: 67,
              isHoofd,
              aowSamen: result.aow.samen,
              aowAlleen: result.aow.alleen,
            }];
          }
        } else {
          // JSON bestand zonder naam — gebruik eerste persoon of maak aan
          if (personen.length === 0) {
            eigenaarId = `persoon_${Date.now()}`;
            nieuwePersonen = [{ id: eigenaarId, naam: "Ik", geboortejaar: 1970, pensioenLeeftijd: 67, isHoofd: true, aowSamen: result.aow.samen, aowAlleen: result.aow.alleen }];
          } else {
            // Koppel aan eerste persoon zonder pensioenen, of de hoofdpersoon
            const zonderPensioen = personen.find(p => !pensioenen.some(x => x.eigenaarId === p.id));
            eigenaarId = zonderPensioen?.id ?? personen[0].id;
            nieuwePersonen = nieuwePersonen.map(p => p.id === eigenaarId
              ? { ...p, aowSamen: result.aow.samen || p.aowSamen, aowAlleen: result.aow.alleen || p.aowAlleen }
              : p);
          }
        }

        // Merge pensioenen: verwijder oude van deze eigenaar, voeg nieuwe toe
        const bestaandePensioenen = pensioenen.filter(p => p.eigenaarId !== eigenaarId);
        const nieuwePensioenen = result.pensioenen.map((p, i) => ({
          ...p, id: `${eigenaarId}_${p.herkenning ?? i}_${p.startLeeftijd}`, eigenaarId,
        }));

        setPersonen(nieuwePersonen);
        setPensioenen([...bestaandePensioenen, ...nieuwePensioenen]);

        const persoonNaam = nieuwePersonen.find(p => p.id === eigenaarId)?.naam ?? "onbekend";
        setImportStatus({
          ok: true,
          tekst: `✅ ${nieuwePensioenen.length} regelingen ingeladen voor ${persoonNaam}${result.aow.samen > 0 ? ` · AOW € ${result.aow.samen.toLocaleString("nl-NL")}/jr` : ""}`,
        });
        setTab("pensioenen");
      } catch (err) {
        console.error("[Import] Fout:", err);
        setImportStatus({ ok: false, tekst: `❌ ${err.message}` });
      }
    };
    reader.onerror = () => setImportStatus({ ok: false, tekst: "❌ Kon bestand niet lezen" });
    reader.readAsText(file);
  }

  // ─── Backup ──────────────────────────────────────────────────────────────────
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
        const data = JSON.parse(ev.target.result);
        if (data.personen)   setPersonen(data.personen);
        if (data.pensioenen) setPensioenen(data.pensioenen);
        if (data.vermogen)   setVermogen(data.vermogen);
        if (data.simulatie)  setSimulatie(data.simulatie);
        setImportStatus({ ok: true, tekst: "✅ Backup hersteld" });
      } catch { setImportStatus({ ok: false, tekst: "❌ Ongeldig backup bestand" }); }
    };
    reader.readAsText(file);
  }

  // ─── Berekeningen ─────────────────────────────────────────────────────────────
  const hoofdpersoon = personen.find(p => p.isHoofd) ?? personen[0];
  const startLeeftijd = hoofdpersoon?.pensioenLeeftijd ?? 67;
  const startGeboortejaar = hoofdpersoon?.geboortejaar ?? 1970;

  const chartData = useMemo(() => {
    if (!hoofdpersoon) return [];
    return Array.from({ length: 26 }, (_, i) => {
      const leeftijd = startLeeftijd + i;
      const jaar = JAAR_NU + (leeftijd - (JAAR_NU - startGeboortejaar));

      // Inkomen per persoon
      let totaalPensioenBruto = 0;
      const perPersoon = {};

      personen.forEach((persoon) => {
        const leeftijdPersoon = leeftijd + (startGeboortejaar - persoon.geboortejaar);
        let pensioenBruto = 0;

        pensioenen.filter(p => p.eigenaarId === persoon.id).forEach((p) => {
          if (leeftijdPersoon >= p.startLeeftijd) {
            if (p.type === "bankspaar") {
              const r = (p.rente ?? 2) / 100;
              pensioenBruto += r === 0 ? (p.saldo ?? 0) / 20 : ((p.saldo ?? 0) * r) / (1 - Math.pow(1 + r, -20));
            } else {
              pensioenBruto += p.bruto_jaar ?? 0;
            }
          }
        });

        // Simulatie alleen voor hoofdpersoon
        if (persoon.isHoofd && simulatie.aankoopJaar > 0 && leeftijd >= startLeeftijd + simulatie.aankoopJaar) {
          pensioenBruto += simulatie.aankoopUitkering * 12;
        }

        let aowBruto = 0;
        if (leeftijdPersoon >= 67) {
          aowBruto = personen.length > 1 ? (persoon.aowSamen || AOW_SAMEN * 12) : (persoon.aowAlleen || AOW_ALLEEN * 12);
        }

        perPersoon[persoon.id] = { pensioenBruto: Math.round(pensioenBruto), aowBruto: Math.round(aowBruto) };
        totaalPensioenBruto += pensioenBruto;
      });

      const totaalAow = Object.values(perPersoon).reduce((s, p) => s + p.aowBruto, 0);
      const spaargeldInkomen = leeftijd >= vermogen.spaargeldGebruikVanaf ? vermogen.spaargeldPerJaar : 0;
      const woningInkomen    = leeftijd >= vermogen.woningGebruikVanaf    ? vermogen.woningPerJaar    : 0;

      // Netto per persoon berekenen en optellen
      const totaalNetto = personen.reduce((s, persoon) => {
        const pp = perPersoon[persoon.id];
        return s + berekenNetto(pp.pensioenBruto + pp.aowBruto);
      }, 0) + spaargeldInkomen + woningInkomen;

      const totalBruto = Math.round(totaalPensioenBruto + totaalAow + spaargeldInkomen + woningInkomen);

      const rij = {
        leeftijd, jaar,
        pensioenBruto: Math.round(totaalPensioenBruto),
        aowBruto: Math.round(totaalAow),
        spaargeldInkomen: Math.round(spaargeldInkomen),
        woningInkomen: Math.round(woningInkomen),
        totalBruto,
        totalNetto: Math.round(totaalNetto),
        totalNettoMaand: Math.round(totaalNetto / 12),
        totalBrutoMaand: Math.round(totalBruto / 12),
      };
      // Voeg per-persoon kolommen toe voor grafiek
      personen.forEach(p => { rij[`pensioen_${p.id}`] = perPersoon[p.id].pensioenBruto; });
      return rij;
    });
  }, [personen, pensioenen, vermogen, simulatie, hoofdpersoon]);

  const ps = chartData[0];

  // Kleuren per persoon
  const KLEUREN = ["#c9a84c", "#a084c9", "#4caf8a", "#5b9bd5", "#e07b54"];

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
            🏦 Pensioen Planner <span style={{ fontSize: 11, color: "#555", fontWeight: 400 }}>{FIX_NR}</span>
          </h1>
          <p style={{ margin: "2px 0 0", color: "#7a9bb0", fontSize: 11 }}>Data blijft alleen op jouw apparaat</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {opgeslagen && <span style={{ fontSize: 11, color: "#4caf8a" }}>✓ {opgeslagen.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span>}
          <label style={{ ...btn("#5b9bd5"), cursor: "pointer" }} title="JSON of XML van mijnpensioenoverzicht.nl — voor jezelf of je partner">
            📥 Pensioen importeren
            <input type="file" accept=".json,.xml" onChange={importeerBestand} style={{ display: "none" }} />
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
          {personen.length === 0 && (
            <div style={{ padding: 24, background: "#1a2d3d", borderRadius: 12, border: "1px solid #2a4a5e", textAlign: "center", marginBottom: 24 }}>
              <p style={{ color: "#7a9bb0", margin: "0 0 12px" }}>Nog geen gegevens. Importeer je pensioenoverzicht om te beginnen.</p>
              <label style={{ ...btn("#5b9bd5"), cursor: "pointer" }}>
                📥 Pensioen importeren
                <input type="file" accept=".json,.xml" onChange={importeerBestand} style={{ display: "none" }} />
              </label>
            </div>
          )}

          {personen.map((persoon, pi) => (
            <div key={persoon.id} style={{ background: "#1a2d3d", border: `1px solid ${KLEUREN[pi % KLEUREN.length]}44`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h3 style={{ margin: 0, color: KLEUREN[pi % KLEUREN.length], fontSize: 15 }}>
                  {persoon.isHoofd ? "👤" : "👥"} {persoon.naam}
                  {persoon.isHoofd && <span style={{ fontSize: 11, color: "#555", marginLeft: 8 }}>hoofdpersoon</span>}
                </h3>
                {!persoon.isHoofd && (
                  <button onClick={() => { setPersonen(personen.filter(p => p.id !== persoon.id)); setPensioenen(pensioenen.filter(p => p.eigenaarId !== persoon.id)); }}
                    style={{ background: "#c0392b22", border: "1px solid #c0392b44", color: "#e74c3c", padding: "3px 9px", borderRadius: 6, cursor: "pointer" }}>✕</button>
                )}
              </div>
              <Grid>
                <Field label="Naam" value={persoon.naam} onChange={v => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, naam: v } : p))} />
                <Field label="Geboortejaar" value={persoon.geboortejaar} onChange={v => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, geboortejaar: +v } : p))} type="number" />
                <Field label="Pensioenleeftijd" value={persoon.pensioenLeeftijd} onChange={v => setPersonen(personen.map(p => p.id === persoon.id ? { ...p, pensioenLeeftijd: +v } : p))} type="number" />
              </Grid>
              {persoon.aowSamen > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  <KPI label="AOW samenwonend/jr" value={`€ ${persoon.aowSamen.toLocaleString("nl-NL")}`} kleur={KLEUREN[pi % KLEUREN.length]} />
                  <KPI label="AOW alleenstaand/jr" value={`€ ${persoon.aowAlleen.toLocaleString("nl-NL")}`} kleur={KLEUREN[pi % KLEUREN.length]} />
                </div>
              )}
            </div>
          ))}

          {/* Samenvatting */}
          {ps && hoofdpersoon && (
            <div style={{ padding: 20, background: "#1a2d3d", borderRadius: 12, border: "1px solid #2a4a5e", marginTop: 8 }}>
              <h3 style={{ margin: "0 0 14px", color: "#c9a84c", fontSize: 14 }}>📊 Bij pensionering (leeftijd {hoofdpersoon.pensioenLeeftijd})</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(155px,1fr))", gap: 12 }}>
                <KPI label="Bruto/maand" value={`€ ${ps.totalBrutoMaand.toLocaleString("nl-NL")}`} kleur="#c9a84c" />
                <KPI label="Netto/maand" value={`€ ${ps.totalNettoMaand.toLocaleString("nl-NL")}`} kleur="#4caf8a" />
                <KPI label="Pensioen bruto/jr" value={`€ ${ps.pensioenBruto.toLocaleString("nl-NL")}`} kleur="#c9a84c" />
                <KPI label="AOW bruto/jr" value={`€ ${ps.aowBruto.toLocaleString("nl-NL")}`} kleur="#5b9bd5" />
              </div>
            </div>
          )}
        </Section>}

        {/* PENSIOENEN */}
        {tab === "pensioenen" && <Section title="Pensioenen & producten">
          <div style={{ padding: 12, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e", marginBottom: 20 }}>
            <p style={{ margin: 0, color: "#7a9bb0", fontSize: 13 }}>📥 Importeer elk pensioenoverzicht afzonderlijk. De app herkent automatisch van wie het bestand is.</p>
          </div>

          {personen.length === 0
            ? <div style={{ textAlign: "center", padding: 40, color: "#4a6a7e" }}>Nog geen pensioenen. Importeer een bestand.</div>
            : personen.map((persoon, pi) => {
                const eigenPensioenen = pensioenen.filter(p => p.eigenaarId === persoon.id);
                return (
                  <div key={persoon.id} style={{ marginBottom: 28 }}>
                    <h3 style={{ color: KLEUREN[pi % KLEUREN.length], fontSize: 14, marginBottom: 12 }}>
                      {persoon.isHoofd ? "👤" : "👥"} {persoon.naam}
                    </h3>
                    {eigenPensioenen.length === 0
                      ? <div style={{ padding: 16, color: "#4a6a7e", fontSize: 13, textAlign: "center" }}>Geen pensioenen — importeer het overzicht van {persoon.naam}</div>
                      : eigenPensioenen.map((p) => (
                          <PensioenRij key={p.id} p={p} alle={pensioenen} setPensioenen={setPensioenen} kleur={KLEUREN[pi % KLEUREN.length]} />
                        ))
                    }
                  </div>
                );
              })
          }
          <button onClick={() => {
            const eigenaarId = hoofdpersoon?.id ?? "onbekend";
            setPensioenen([...pensioenen, { id: `handmatig_${Date.now()}`, naam: "Nieuw pensioen", type: "pensioen", eigenaarId, bruto_jaar: 0, startLeeftijd: 67 }]);
          }} style={{ background: "#c9a84c22", border: "1px solid #c9a84c44", color: "#c9a84c", padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
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
          {simulatie.aankoopJaar > 0 && hoofdpersoon && (
            <div style={{ padding: 14, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e" }}>
              <p style={{ margin: 0, color: "#c9a84c" }}>Vanaf leeftijd <strong>{hoofdpersoon.pensioenLeeftijd + simulatie.aankoopJaar}</strong> extra <strong>€ {(simulatie.aankoopUitkering * 12).toLocaleString("nl-NL")}</strong>/jr bruto.</p>
            </div>
          )}
        </Section>}

        {/* PROGNOSE */}
        {tab === "prognose" && <Section title="Inkomensprognose">
          <p style={{ color: "#7a9bb0", fontSize: 12, marginBottom: 18 }}>Gecombineerd huishoudinkomen. Netto o.b.v. box 1 schijven 2024.</p>
          <div style={{ background: "#1a2d3d", borderRadius: 12, padding: 18, marginBottom: 20 }}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a4a5e" />
                <XAxis dataKey="leeftijd" stroke="#7a9bb0" tick={{ fontSize: 11 }} />
                <YAxis stroke="#7a9bb0" tick={{ fontSize: 11 }} tickFormatter={v=>`€${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v=>[`€ ${Number(v).toLocaleString("nl-NL")}`]} labelFormatter={l=>`Leeftijd ${l}`} contentStyle={{ background: "#0f1923", border: "1px solid #2a4a5e", borderRadius: 8, fontSize: 12 }} />
                <Legend />
                <Line type="monotone" dataKey="totalBruto" name="Bruto totaal" stroke="#c9a84c" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="totalNetto" name="Netto totaal" stroke="#4caf8a" strokeWidth={2} dot={false} />
                {personen.map((p, pi) => (
                  <Line key={p.id} type="monotone" dataKey={`pensioen_${p.id}`} name={`Pensioen ${p.naam}`} stroke={KLEUREN[pi % KLEUREN.length]} strokeWidth={1} dot={false} strokeDasharray="4 2" />
                ))}
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

// ─── PensioenRij — buiten App zodat React hem niet opnieuw definieert ─────────
function PensioenRij({ p, alle, setPensioenen, kleur }) {
  function update(veld, waarde) {
    setPensioenen(alle.map(x => x.id === p.id ? { ...x, [veld]: waarde } : x));
  }
  return (
    <div style={{ background: "#111d26", border: `1px solid ${kleur}33`, borderRadius: 10, padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
            <span>{p.type === "bankspaar" ? "🏦" : p.type === "lijfrente" ? "📋" : "🏛️"}</span>
            <input value={p.naam} onChange={e => update("naam", e.target.value)} style={{ ...inp, maxWidth: 280 }} />
          </div>
          {p.herkenning && <div style={{ fontSize: 11, color: "#4a6a7e", marginLeft: 24 }}>#{p.herkenning}{p.standPer ? ` · ${p.standPer}` : ""}</div>}
        </div>
        <button onClick={() => setPensioenen(alle.filter(x => x.id !== p.id))} style={{ background: "#c0392b22", border: "1px solid #c0392b44", color: "#e74c3c", padding: "3px 9px", borderRadius: 6, cursor: "pointer", marginLeft: 10 }}>✕</button>
      </div>
      <Grid>
        <div>
          <label style={lbl}>Type</label>
          <select value={p.type} onChange={e => update("type", e.target.value)} style={inp}>
            <option value="pensioen">Pensioenfonds</option>
            <option value="bankspaar">Bankspaarrekening</option>
            <option value="lijfrente">Lijfrente</option>
          </select>
        </div>
        <Field label="Startleeftijd" value={p.startLeeftijd} onChange={v => update("startLeeftijd", +v)} type="number" />
        {p.type === "bankspaar"
          ? <><Field label="Saldo (€)" value={p.saldo??0} onChange={v => update("saldo", +v)} type="number" /><Field label="Rente (%)" value={p.rente??2} onChange={v => update("rente", +v)} type="number" /></>
          : <Field label="Bruto/jr (€)" value={p.bruto_jaar??0} onChange={v => update("bruto_jaar", +v)} type="number" />
        }
      </Grid>
    </div>
  );
}

// ─── Herbruikbare componenten ─────────────────────────────────────────────────
function Section({ title, children }) {
  return <div><h2 style={{ color: "#c9a84c", fontSize: 18, marginBottom: 20, paddingBottom: 10, borderBottom: "1px solid #2a4a5e" }}>{title}</h2>{children}</div>;
}
function Grid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(185px,1fr))", gap: 12, marginBottom: 12 }}>{children}</div>;
}
function Field({ label, value, onChange, type = "text" }) {
  return <div><label style={lbl}>{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} style={inp} /></div>;
}
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
const btn = (color) => ({ background: `${color}22`, border: `1px solid ${color}44`, color, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 });
