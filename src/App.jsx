import { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
const DB_NAME = "pensioenPlanner";
const DB_VERSION = 1;
const STORE = "gegevens";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE);
    };
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

// ─── Belasting helpers (2024, vereenvoudigd) ──────────────────────────────────
function berekenNetto(bruto) {
  if (bruto <= 0) return 0;
  const schijf1 = Math.min(bruto, 75518);
  const schijf2 = Math.max(0, bruto - 75518);
  let belasting = schijf1 * 0.3697 + schijf2 * 0.495;
  const ahk = bruto < 24812 ? 3362 : Math.max(0, 3362 - (bruto - 24812) * 0.06095);
  const ouderenkorting = 1982;
  belasting = Math.max(0, belasting - ahk - ouderenkorting);
  return Math.round(bruto - belasting);
}

const AOW_SAMEN = 1014;
const AOW_ALLEEN = 1450;
const JAAR_NU = new Date().getFullYear();

const DEFAULT_STATE = {
  pensioenen: [
    { id: 1, naam: "Werkgever Pensioenfonds", type: "pensioen", bruto_jaar: 8000, startLeeftijd: 67 },
    { id: 2, naam: "Bankspaarrekening", type: "bankspaar", saldo: 45000, rente: 2.5, startLeeftijd: 67 },
    { id: 3, naam: "Lijfrente polis", type: "lijfrente", bruto_jaar: 3600, startLeeftijd: 67 },
  ],
  profiel: {
    geboortejaar: 1970,
    pensioenLeeftijd: 67,
    partnerGeboortejaar: 1972,
    partnerPensioenLeeftijd: 67,
    heeftPartner: true,
  },
  vermogen: {
    spaargeld: 80000,
    spaargeldGebruikVanaf: 67,
    spaargeldPerJaar: 5000,
    woningWaarde: 350000,
    woningGebruikVanaf: 75,
    woningPerJaar: 15000,
  },
  simulatie: {
    aankoopJaar: 0,
    aankoopBedrag: 10000,
    aankoopUitkering: 600,
  },
};

export default function PensioenApp() {
  const [tab, setTab] = useState("profiel");
  const [geladen, setGeladen] = useState(false);
  const [opgeslagen, setOpgeslagen] = useState(null);

  const [pensioenen, setPensioenenRaw] = useState(DEFAULT_STATE.pensioenen);
  const [profiel, setProfielRaw] = useState(DEFAULT_STATE.profiel);
  const [vermogen, setVermogenRaw] = useState(DEFAULT_STATE.vermogen);
  const [simulatie, setSimulatieRaw] = useState(DEFAULT_STATE.simulatie);

  // ─── Laad uit IndexedDB bij start ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const opgeslagen = await dbGet("state");
        if (opgeslagen) {
          setPensioenenRaw(opgeslagen.pensioenen ?? DEFAULT_STATE.pensioenen);
          setProfielRaw(opgeslagen.profiel ?? DEFAULT_STATE.profiel);
          setVermogenRaw(opgeslagen.vermogen ?? DEFAULT_STATE.vermogen);
          setSimulatieRaw(opgeslagen.simulatie ?? DEFAULT_STATE.simulatie);
        }
      } catch (e) {
        console.warn("Kon gegevens niet laden:", e);
      }
      setGeladen(true);
    })();
  }, []);

  // ─── Sla automatisch op bij elke wijziging ────────────────────────────────
  async function slaOp(nieuw) {
    try {
      await dbSet("state", nieuw);
      setOpgeslagen(new Date());
    } catch (e) {
      console.warn("Opslaan mislukt:", e);
    }
  }

  function setPensioenen(v) { setPensioenenRaw(v); slaOp({ pensioenen: v, profiel, vermogen, simulatie }); }
  function setProfiel(v) { setProfielRaw(v); slaOp({ pensioenen, profiel: v, vermogen, simulatie }); }
  function setVermogen(v) { setVermogenRaw(v); slaOp({ pensioenen, profiel, vermogen: v, simulatie }); }
  function setSimulatie(v) { setSimulatieRaw(v); slaOp({ pensioenen, profiel, vermogen, simulatie: v }); }

  // ─── Export / Import ──────────────────────────────────────────────────────
  function exporteer() {
    const data = JSON.stringify({ pensioenen, profiel, vermogen, simulatie }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pensioen-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  function importeer(e) {
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
        alert("✅ Gegevens succesvol ingeladen!");
      } catch {
        alert("❌ Ongeldig bestand");
      }
    };
    reader.readAsText(file);
  }

  // ─── Berekeningen ─────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    const startLeeftijd = profiel.pensioenLeeftijd;
    return Array.from({ length: 26 }, (_, i) => {
      const leeftijd = startLeeftijd + i;
      const jaar = JAAR_NU + (leeftijd - (JAAR_NU - profiel.geboortejaar));
      const partnerLeeftijd = leeftijd + (profiel.geboortejaar - profiel.partnerGeboortejaar);

      let pensioenBruto = 0;
      pensioenen.forEach((p) => {
        if (leeftijd >= p.startLeeftijd) {
          if (p.type === "bankspaar") {
            const r = p.rente / 100;
            const n = 20;
            pensioenBruto += r === 0 ? p.saldo / n : (p.saldo * r) / (1 - Math.pow(1 + r, -n));
          } else {
            pensioenBruto += p.bruto_jaar;
          }
        }
      });

      if (simulatie.aankoopJaar > 0 && leeftijd >= profiel.pensioenLeeftijd + simulatie.aankoopJaar) {
        pensioenBruto += simulatie.aankoopUitkering * 12;
      }

      let aowBruto = 0;
      if (leeftijd >= 67) aowBruto += profiel.heeftPartner ? AOW_SAMEN * 12 : AOW_ALLEEN * 12;
      if (profiel.heeftPartner && partnerLeeftijd >= 67) aowBruto += AOW_SAMEN * 12;

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

  if (!geladen) {
    return (
      <div style={{ background: "#0f1923", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#c9a84c", fontFamily: "Georgia, serif", fontSize: 18 }}>
        Gegevens laden...
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Georgia', serif", background: "#0f1923", minHeight: "100vh", color: "#e8dcc8" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1a2d3d 0%, #0f1923 100%)", borderBottom: "1px solid #2a4a5e", padding: "20px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#c9a84c", letterSpacing: 1 }}>🏦 Pensioen Planner</h1>
          <p style={{ margin: "4px 0 0", color: "#7a9bb0", fontSize: 13 }}>Jouw financiële toekomst — data blijft alleen op jouw apparaat</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {opgeslagen && <span style={{ fontSize: 11, color: "#4caf8a" }}>✓ opgeslagen {opgeslagen.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span>}
          <button onClick={exporteer} style={btnStyle("#c9a84c")}>⬇ Export backup</button>
          <label style={{ ...btnStyle("#5b9bd5"), cursor: "pointer" }}>
            ⬆ Import
            <input type="file" accept=".json" onChange={importeer} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: "#111d26", borderBottom: "1px solid #2a4a5e", overflowX: "auto" }}>
        {[["profiel", "👤 Profiel"], ["pensioenen", "📄 Pensioenen"], ["vermogen", "🏠 Vermogen"], ["simulatie", "🎮 Simulatie"], ["prognose", "📈 Prognose"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: "14px 22px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
            background: tab === key ? "#1a2d3d" : "transparent",
            color: tab === key ? "#c9a84c" : "#7a9bb0",
            borderBottom: tab === key ? "2px solid #c9a84c" : "2px solid transparent",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>

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
            <div style={{ marginTop: 32, padding: 24, background: "#1a2d3d", borderRadius: 12, border: "1px solid #2a4a5e" }}>
              <h3 style={{ margin: "0 0 16px", color: "#c9a84c", fontSize: 16 }}>📊 Bij pensionering (leeftijd {profiel.pensioenLeeftijd})</h3>
              {pensioenStart && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
                  <KPI label="Bruto per maand" value={`€ ${pensioenStart.totalBrutoMaand.toLocaleString("nl-NL")}`} />
                  <KPI label="Netto per maand" value={`€ ${pensioenStart.totalNettoMaand.toLocaleString("nl-NL")}`} accent />
                  <KPI label="Pensioen (bruto/jr)" value={`€ ${pensioenStart.pensioenBruto.toLocaleString("nl-NL")}`} />
                  <KPI label="AOW (bruto/jr)" value={`€ ${pensioenStart.aowBruto.toLocaleString("nl-NL")}`} />
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── PENSIOENEN ── */}
        {tab === "pensioenen" && (
          <Section title="Mijn pensioenen & producten">
            <p style={{ color: "#7a9bb0", fontSize: 13, marginBottom: 24 }}>
              Haal je gegevens op via <strong style={{ color: "#c9a84c" }}>mijnpensioenoverzicht.nl</strong>. Voer bedragen bruto per jaar in.
            </p>
            {pensioenen.map((p, i) => (
              <div key={p.id} style={{ background: "#1a2d3d", border: "1px solid #2a4a5e", borderRadius: 12, padding: 20, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span style={{ fontSize: 20 }}>{p.type === "pensioen" ? "🏛️" : p.type === "bankspaar" ? "🏦" : "📋"}</span>
                    <input value={p.naam} onChange={e => { const n = [...pensioenen]; n[i] = { ...n[i], naam: e.target.value }; setPensioenen(n); }} style={{ ...inputStyle, width: 240 }} />
                  </div>
                  <button onClick={() => setPensioenen(pensioenen.filter((_, j) => j !== i))} style={{ background: "#c0392b22", border: "1px solid #c0392b44", color: "#e74c3c", padding: "4px 10px", borderRadius: 6, cursor: "pointer" }}>✕</button>
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
                      <Field label="Saldo (€)" value={p.saldo} onChange={v => { const n = [...pensioenen]; n[i] = { ...n[i], saldo: +v }; setPensioenen(n); }} type="number" />
                      <Field label="Rente (%)" value={p.rente} onChange={v => { const n = [...pensioenen]; n[i] = { ...n[i], rente: +v }; setPensioenen(n); }} type="number" />
                    </>
                  ) : (
                    <Field label="Bruto uitkering per jaar (€)" value={p.bruto_jaar} onChange={v => { const n = [...pensioenen]; n[i] = { ...n[i], bruto_jaar: +v }; setPensioenen(n); }} type="number" />
                  )}
                </Grid>
              </div>
            ))}
            <button onClick={() => setPensioenen([...pensioenen, { id: Date.now(), naam: "Nieuw pensioen", type: "pensioen", bruto_jaar: 0, startLeeftijd: 67 }])}
              style={{ background: "#c9a84c22", border: "1px solid #c9a84c44", color: "#c9a84c", padding: "10px 20px", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
              + Pensioen toevoegen
            </button>
          </Section>
        )}

        {/* ── VERMOGEN ── */}
        {tab === "vermogen" && (
          <Section title="Spaargeld & Woning">
            <h3 style={{ color: "#c9a84c", fontSize: 16, marginBottom: 16 }}>💰 Spaargeld als inkomen</h3>
            <Grid>
              <Field label="Totaal spaargeld (€)" value={vermogen.spaargeld} onChange={v => setVermogen({ ...vermogen, spaargeld: +v })} type="number" />
              <Field label="Gebruik vanaf leeftijd" value={vermogen.spaargeldGebruikVanaf} onChange={v => setVermogen({ ...vermogen, spaargeldGebruikVanaf: +v })} type="number" />
              <Field label="Per jaar opnemen (€)" value={vermogen.spaargeldPerJaar} onChange={v => setVermogen({ ...vermogen, spaargeldPerJaar: +v })} type="number" />
            </Grid>
            <h3 style={{ color: "#c9a84c", fontSize: 16, marginBottom: 16, marginTop: 32 }}>🏠 Woning als inkomen</h3>
            <p style={{ color: "#7a9bb0", fontSize: 13, marginBottom: 16 }}>Bijv. via verzilverhypotheek, verhuur of verkoop + terughuur.</p>
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
            <p style={{ color: "#7a9bb0", fontSize: 14, marginBottom: 24 }}>
              Speel met het aankopen van extra pensioen — bijv. spaargeld omzetten naar een lijfrente op een later moment.
            </p>
            <Grid>
              <Field label="Aankoop X jaar na pensionering" value={simulatie.aankoopJaar} onChange={v => setSimulatie({ ...simulatie, aankoopJaar: +v })} type="number" />
              <Field label="Aankoopbedrag (€)" value={simulatie.aankoopBedrag} onChange={v => setSimulatie({ ...simulatie, aankoopBedrag: +v })} type="number" />
              <Field label="Extra uitkering per maand (€)" value={simulatie.aankoopUitkering} onChange={v => setSimulatie({ ...simulatie, aankoopUitkering: +v })} type="number" />
            </Grid>
            {simulatie.aankoopJaar > 0 && (
              <div style={{ marginTop: 24, padding: 16, background: "#1a2d3d", borderRadius: 10, border: "1px solid #2a4a5e" }}>
                <p style={{ margin: 0, color: "#c9a84c" }}>
                  Vanaf leeftijd <strong>{profiel.pensioenLeeftijd + simulatie.aankoopJaar}</strong> ontvang je extra{" "}
                  <strong>€ {(simulatie.aankoopUitkering * 12).toLocaleString("nl-NL")}</strong> per jaar bruto.
                </p>
              </div>
            )}
          </Section>
        )}

        {/* ── PROGNOSE ── */}
        {tab === "prognose" && (
          <Section title="Inkomensprognose">
            <p style={{ color: "#7a9bb0", fontSize: 13, marginBottom: 24 }}>
              Inkomen over 25 jaar na pensionering. Netto is een benadering o.b.v. box 1 schijven 2024.
            </p>
            <div style={{ background: "#1a2d3d", borderRadius: 12, padding: 24, marginBottom: 24 }}>
              <h3 style={{ margin: "0 0 16px", color: "#c9a84c", fontSize: 15 }}>Jaarinkomen bruto vs netto (€)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a4a5e" />
                  <XAxis dataKey="leeftijd" stroke="#7a9bb0" tick={{ fontSize: 12 }} label={{ value: "Leeftijd", position: "insideBottom", offset: -5, fill: "#7a9bb0" }} />
                  <YAxis stroke="#7a9bb0" tick={{ fontSize: 12 }} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => [`€ ${v.toLocaleString("nl-NL")}`]} labelFormatter={l => `Leeftijd ${l}`} contentStyle={{ background: "#0f1923", border: "1px solid #2a4a5e", borderRadius: 8 }} />
                  <Legend />
                  <Line type="monotone" dataKey="totalBruto" name="Bruto" stroke="#c9a84c" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="totalNetto" name="Netto" stroke="#4caf8a" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="aowBruto" name="AOW" stroke="#5b9bd5" strokeWidth={1} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#1a2d3d" }}>
                    {["Leeftijd", "Jaar", "Pensioen bruto/jr", "AOW bruto/jr", "Spaargeld/jr", "Woning/jr", "Bruto/mnd", "Netto/mnd"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "right", color: "#c9a84c", borderBottom: "1px solid #2a4a5e", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#111d26" : "#0f1923", borderBottom: "1px solid #1a2d3d" }}>
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
      <h2 style={{ color: "#c9a84c", fontSize: 20, marginBottom: 24, paddingBottom: 12, borderBottom: "1px solid #2a4a5e" }}>{title}</h2>
      {children}
    </div>
  );
}

function Grid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 16 }}>{children}</div>;
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
    <div style={{ background: "#111d26", borderRadius: 8, padding: "12px 16px", border: `1px solid ${accent ? "#4caf8a44" : "#2a4a5e"}` }}>
      <div style={{ fontSize: 11, color: "#7a9bb0", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ? "#4caf8a" : "#c9a84c" }}>{value}</div>
    </div>
  );
}

const inputStyle = { width: "100%", padding: "8px 12px", background: "#111d26", border: "1px solid #2a4a5e", borderRadius: 8, color: "#e8dcc8", fontSize: 14, boxSizing: "border-box" };
const labelStyle = { display: "block", fontSize: 12, color: "#7a9bb0", marginBottom: 6 };
const cellStyle = { padding: "8px 12px", textAlign: "right", color: "#a0b8c8" };
const btnStyle = (color) => ({ background: `${color}22`, border: `1px solid ${color}44`, color, padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600 });
