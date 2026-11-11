// PENSIOEN PLANNER - src/DemoData.js
// fix-11: voorbeeldgegevens voor de demo-modus. Volledig fictief (namen, fondsen en bedragen)
//         maar realistisch van opzet: twee partners met vijf jaar leeftijdsverschil, pensioen
//         bij meerdere uitvoerders (levenslang én tijdelijk), banksparen, koopsom, spaargeld
//         en overwaarde van de woning, plus één bewaard scenario ("Marie stopt eerder").

export function maakDemoData() {
  const jan = "demo_jan", marie = "demo_marie";
  const stand = "2026-01-01";

  const personen = [
    { id: jan, naam: "Jan Voorbeeld", geboortejaar: 1964, geboortemaand: 3, samenwonend: true,
      pensioenLeeftijd: 67.25, aowStartLeeftijd: 67.25, ingangModus: "standaard", hoogLaag: false,
      aowSamen: 12900, aowAlleen: 18800, aowTeBereikenSamen: 13800, aowTeBereikenAlleen: 20100,
      partnerVerzekerd: 14200, partnerOpgebouwd: 9800 },
    { id: marie, naam: "Marie Voorbeeld", geboortejaar: 1969, geboortemaand: 9, samenwonend: true,
      pensioenLeeftijd: 67.5, aowStartLeeftijd: 67.5, ingangModus: "standaard", hoogLaag: false,
      aowSamen: 11500, aowAlleen: 16700, aowTeBereikenSamen: 13700, aowTeBereikenAlleen: 19900,
      partnerVerzekerd: 18300, partnerOpgebouwd: 15100 },
  ];

  const pensioenen = [
    // Jan
    { id: `${jan}_demo1`, eigenaarId: jan, naam: "Pensioenfonds Delta (voorbeeld)", herkenning: "DEMO-001", type: "pensioen",
      bruto_jaar: 9200, opgebouwd: 8400, teBereiken: 9200, startLeeftijd: 65, totLeeftijd: null, standPer: stand },
    { id: `${jan}_demo2`, eigenaarId: jan, naam: "Verzekeraar Noord (voorbeeld)", herkenning: "DEMO-002", type: "pensioen",
      bruto_jaar: 6100, opgebouwd: 6100, teBereiken: 6100, startLeeftijd: 67.25, totLeeftijd: null, standPer: stand },
    { id: `${jan}_demo3`, eigenaarId: jan, naam: "Overbruggingspensioen Noord (voorbeeld)", herkenning: "DEMO-003", type: "pensioen",
      bruto_jaar: 7800, opgebouwd: 7800, teBereiken: 7800, startLeeftijd: 65, totLeeftijd: 67.25, standPer: stand },
    { id: `${jan}_demo4`, eigenaarId: jan, naam: "Banksparen Spaarplan (voorbeeld)", type: "bankspaar",
      saldo: 85000, inlegPerJaar: 4000, rendement: 3, verwachteWaarde: 0, verwachtJaar: 0,
      startLeeftijd: 67.25, looptijd: 20, rente: 2 },
    // Marie
    { id: `${marie}_demo1`, eigenaarId: marie, naam: "Pensioenfonds Zorg (voorbeeld)", herkenning: "DEMO-101", type: "pensioen",
      bruto_jaar: 21800, opgebouwd: 17900, teBereiken: 21800, startLeeftijd: 67.5, totLeeftijd: null, standPer: stand },
    { id: `${marie}_demo2`, eigenaarId: marie, naam: "Verzekeraar Oost (voorbeeld)", herkenning: "DEMO-102", type: "pensioen",
      bruto_jaar: 1900, opgebouwd: 1900, teBereiken: 1900, startLeeftijd: 65, totLeeftijd: null, standPer: stand },
    { id: `${marie}_demo3`, eigenaarId: marie, type: "koopsom", naam: "Lijfrente koopsom (voorbeeld)",
      koopsom: 40000, uitkeringMnd: 0, startLeeftijd: 68, looptijd: 0, rente: 2 },
  ];

  const vermogen = {
    spaargeld: 60000, spaargeldGebruikVanaf: 67, spaargeldPerJaar: 5000,
    woningWaarde: 620000, woningGebruikVanaf: 75, woningPerJaar: 10000,
  };

  const simulatie = {
    scenarios: [
      { id: "demo_sc1", naam: "Marie stopt op 62",
        instellingen: {
          [jan]:   { pensioenLeeftijd: 67.25, ingangModus: "standaard", ingangLeeftijd: undefined, hoogLaag: false },
          [marie]: { pensioenLeeftijd: 62,    ingangModus: "standaard", ingangLeeftijd: undefined, hoogLaag: false },
        } },
    ],
  };

  return { personen, pensioenen, vermogen, simulatie };
}
