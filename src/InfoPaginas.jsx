// PENSIOEN PLANNER - src/InfoPaginas.jsx
// fix-4: nieuwe pagina's Help, Privacy en Disclaimer

const BIJGEWERKT = "september 2026";
const REPO_URL = "https://github.com/bruindav/pensioenberekenen";

const s = {
  pagina:   { maxWidth: 760, margin: "0 auto", lineHeight: 1.7, fontSize: 15, color: "#d8ccb8" },
  h1:       { color: "#c9a84c", fontSize: 24, margin: "0 0 4px" },
  meta:     { color: "#7a9bb0", fontSize: 13, marginBottom: 28 },
  h2:       { color: "#c9a84c", fontSize: 17, marginTop: 32, paddingBottom: 6, borderBottom: "1px solid #2a4a5e" },
  highlight:{ background: "#1a2d3d", borderLeft: "3px solid #4caf8a", padding: "10px 16px", borderRadius: 4, margin: "16px 0" },
  waarschuw:{ background: "#2d1a0e", borderLeft: "3px solid #e07b54", padding: "10px 16px", borderRadius: 4, margin: "16px 0" },
  a:        { color: "#5b9bd5" },
  ul:       { paddingLeft: 20 },
};

function Kop({ icoon, titel, versie }) {
  return (
    <>
      <h1 style={s.h1}>{icoon} {titel}</h1>
      <div style={s.meta}>{versie} — Laatst bijgewerkt: {BIJGEWERKT}</div>
    </>
  );
}

// ─── HELP ─────────────────────────────────────────────────────────────────────
export function HelpPagina({ naar }) {
  return (
    <div style={s.pagina}>
      <Kop icoon="❓" titel="Hoe werkt Pensioen Planner?" versie="Handleiding" />
      <p>
        Pensioen Planner laat zien hoeveel inkomen je per maand overhoudt als je met pensioen gaat — bruto én netto —
        en wanneer dat inkomen verandert. Je kunt spelen met je pensioenleeftijd, spaargeld en woning, en zien wat dat
        doet met je netto maandinkomen.
      </p>
      <div style={s.highlight}>
        Alles wat je invult blijft <strong>op je eigen apparaat</strong>. Er wordt niets naar een server gestuurd.
        Zie de <a href="#privacy" onClick={e => { e.preventDefault(); naar("privacy"); }} style={s.a}>privacyverklaring</a>.
      </div>

      <h2 style={s.h2}>1. Download je pensioenoverzicht</h2>
      <ol style={s.ul}>
        <li>Ga naar <a href="https://www.mijnpensioenoverzicht.nl" target="_blank" rel="noreferrer" style={s.a}>mijnpensioenoverzicht.nl</a> en log in met DigiD.</li>
        <li>Kies de optie om je overzicht te downloaden en sla het op als <strong>XML</strong>-bestand (JSON werkt ook).</li>
        <li>Heb je een partner? Laat die hetzelfde doen, dan kun je beide overzichten inladen.</li>
      </ol>

      <h2 style={s.h2}>2. Importeer het bestand</h2>
      <p>
        Klik rechtsboven op <strong>📥 Pensioen importeren</strong> en kies het bestand. De app leest je naam,
        geboortedatum, leefsituatie, je AOW-opbouw en al je pensioenregelingen met start- en eindleeftijd.
        Importeer je later een nieuwer overzicht van dezelfde persoon, dan worden diens regelingen vervangen.
      </p>

      <h2 style={s.h2}>3. Controleer "Mijn situatie"</h2>
      <ul style={s.ul}>
        <li><strong>Geboortejaar en -maand</strong> — de app rekent per maand, dus de maand bepaalt wanneer een uitkering start.</li>
        <li><strong>Leefsituatie</strong> — gehuwd/samenwonend of alleenstaand. Dit bepaalt de hoogte van je AOW en of je de alleenstaande-ouderenkorting krijgt.</li>
        <li><strong>Pensioenleeftijd</strong> — wanneer je stopt met werken. Stop je vóór je AOW-leeftijd, dan toont de app hoeveel AOW-opbouw je misloopt.</li>
        <li><strong>AOW vanaf leeftijd</strong> — wordt uit het overzicht gehaald (bijv. 67,25 = 67 jaar en 3 maanden).</li>
      </ul>
      <p>
        Onderaan staan de <strong>inkomensmomenten</strong>: elke maand waarin je inkomen verandert. Per moment zie je
        waaruit het bedrag bestaat (AOW, elk pensioen, vermogen), de ingehouden loonheffing en Zvw-bijdrage, en wat er
        netto overblijft.
      </p>

      <h2 style={s.h2}>4. Pensioenen</h2>
      <p>
        Hier staan alle ingelezen regelingen. Je kunt bedragen, start- en stopleeftijd aanpassen, regelingen
        verwijderen of er handmatig een toevoegen — bijvoorbeeld een <strong>bankspaarrekening</strong>: vul saldo en
        rente in, de app rekent dan een uitkering over 20 jaar uit.
      </p>

      <h2 style={s.h2}>5. Vermogen</h2>
      <p>
        Wil je spaargeld of de overwaarde van je woning inzetten als aanvulling? Vul in vanaf welke leeftijd en hoeveel
        per jaar. Deze bedragen tellen als <strong>netto</strong>: er wordt geen belasting over berekend (box 3 zit niet
        in de berekening).
      </p>

      <h2 style={s.h2}>6. Simulatie</h2>
      <p>
        Speel met een extra aankoop van pensioen: een bedrag dat je een aantal jaar na je eerste pensioendatum inlegt,
        en de extra maanduitkering die dat oplevert.
      </p>

      <h2 style={s.h2}>7. Prognose</h2>
      <ul style={s.ul}>
        <li><strong>📋 Tijdlijn</strong> — alle inkomensmomenten onder elkaar; klap een moment open voor de details per persoon.</li>
        <li><strong>📈 Grafiek &amp; tabel</strong> — bruto, netto en AOW per jaar over 30 jaar.</li>
      </ul>

      <h2 style={s.h2}>Hoe wordt netto berekend?</h2>
      <ol style={s.ul}>
        <li>Per persoon en per maand worden alle uitkeringen die op dat moment lopen opgeteld (als jaarbedrag).</li>
        <li>Daarover wordt inkomstenbelasting box 1 berekend met de tarieven van 2026. Vanaf je AOW-leeftijd geldt een lager tarief in de eerste schijf, een lagere algemene heffingskorting en de ouderenkorting.</li>
        <li>De inkomensafhankelijke bijdrage Zorgverzekeringswet (4,85%) wordt afgetrokken — die houden de SVB en je pensioenuitvoerder in.</li>
        <li>Wat overblijft, gedeeld door 12, is je netto maandinkomen. Spaargeld en woning worden daar netto bij opgeteld.</li>
      </ol>
      <p>Lees ook de <a href="#disclaimer" onClick={e => { e.preventDefault(); naar("disclaimer"); }} style={s.a}>disclaimer</a> voor wat de berekening níet meeneemt.</p>

      <h2 style={s.h2}>Gegevens bewaren en overzetten</h2>
      <ul style={s.ul}>
        <li>Alles wordt automatisch opgeslagen in je browser (✓ met tijdstip rechtsboven).</li>
        <li><strong>⬇ Backup</strong> slaat al je gegevens op als bestand; met <strong>⬆ Herstel</strong> zet je dat terug — handig voor een ander apparaat of browser.</li>
        <li>Wis je de browsergegevens van deze site, dan ben je je invoer kwijt. Maak dus af en toe een backup.</li>
      </ul>

      <h2 style={s.h2}>Veelgestelde vragen</h2>
      <p><strong>Waarom wijkt mijn netto bedrag af van wat mijn pensioenfonds zegt?</strong><br />
        De app rekent met vereenvoudigde regels en de tarieven van 2026. Je pensioenuitvoerder past de loonheffingskorting
        vaak maar bij één uitkering toe, waardoor je maandelijks meer of minder ingehouden krijgt; dat wordt via de
        aangifte verrekend.</p>
      <p><strong>Waarom telt de AOW als "alleenstaand"?</strong><br />
        Controleer de leefsituatie bij Mijn situatie. Zonder gegevens gaat de app uit van samenwonend zodra er twee personen zijn.</p>
      <p><strong>Mijn gegevens zijn weg.</strong><br />
        Waarschijnlijk zijn de browsergegevens gewist of gebruik je een andere browser/privévenster. Zet een backup terug met ⬆ Herstel.</p>
    </div>
  );
}

// ─── PRIVACY ──────────────────────────────────────────────────────────────────
export function PrivacyPagina() {
  return (
    <div style={s.pagina}>
      <Kop icoon="🔒" titel="Privacyverklaring Pensioen Planner" versie="Versie 1.0" />
      <div style={s.highlight}>
        <strong>Kort gezegd:</strong> je gegevens blijven op je eigen apparaat. Pensioen Planner heeft geen server,
        geen accounts, geen cookies en geen tracking.
      </div>

      <h2 style={s.h2}>1. Wie is verantwoordelijk?</h2>
      <p>
        Pensioen Planner is een persoonlijk, niet-commercieel hulpmiddel, gehost via GitHub Pages. Omdat de app geen
        gegevens verzamelt of ontvangt, verwerkt de maker van de app geen persoonsgegevens van jou.
      </p>

      <h2 style={s.h2}>2. Welke gegevens gebruikt de app?</h2>
      <ul style={s.ul}>
        <li><strong>Uit je pensioenoverzicht</strong> — naam, geboortedatum, leefsituatie, AOW-opbouw, pensioenuitvoerders, polisnummers en bedragen.</li>
        <li><strong>Wat je zelf invult</strong> — pensioenleeftijd, spaargeld, woningwaarde, simulaties en handmatig toegevoegde regelingen.</li>
      </ul>
      <p>Deze gegevens zijn gevoelig: ze zeggen iets over je inkomen en je financiële situatie. Daarom verlaten ze je apparaat niet.</p>

      <h2 style={s.h2}>3. Waar worden gegevens opgeslagen?</h2>
      <ul style={s.ul}>
        <li>Het XML- of JSON-bestand wordt <strong>in je browser</strong> ingelezen en niet geüpload.</li>
        <li>Alles wordt bewaard in de lokale opslag van je browser (IndexedDB) op dit apparaat.</li>
        <li>Een <strong>backup</strong> is een bestand dat jij zelf downloadt en beheert. Bewaar het op een veilige plek.</li>
      </ul>

      <h2 style={s.h2}>4. Wie heeft toegang?</h2>
      <p>
        Alleen jij — en iedereen die toegang heeft tot jouw apparaat en browser. Gebruik de app daarom niet op een
        gedeelde of openbare computer, of wis daarna de browsergegevens.
      </p>

      <h2 style={s.h2}>5. Hosting, cookies en tracking</h2>
      <ul style={s.ul}>
        <li>De app plaatst <strong>geen cookies</strong> en gebruikt geen analytics, advertenties of trackers.</li>
        <li>De app laadt geen externe scripts of lettertypen van derden.</li>
        <li>
          De webpagina wordt aangeboden door GitHub Pages (GitHub Inc.). Zoals elke webserver kan GitHub technische
          gegevens zoals je IP-adres vastleggen om de dienst te leveren en te beveiligen. Zie de{" "}
          <a href="https://docs.github.com/nl/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noreferrer" style={s.a}>privacyverklaring van GitHub</a>.
        </li>
      </ul>

      <h2 style={s.h2}>6. Hoe lang worden gegevens bewaard?</h2>
      <p>
        Zolang jij ze in je browser laat staan. Verwijder een persoon met ✕ bij Mijn situatie, of wis alle gegevens via
        de browserinstellingen (site-gegevens van deze website verwijderen).
      </p>

      <h2 style={s.h2}>7. Jouw rechten (AVG)</h2>
      <p>
        Omdat er geen gegevens bij de maker terechtkomen, is er niets op te vragen, te corrigeren of te verwijderen bij
        de maker: je hebt zelf volledige controle. Je kunt je gegevens op elk moment inzien, aanpassen, exporteren
        (⬇ Backup) en wissen.
      </p>

      <h2 style={s.h2}>8. Wijzigingen</h2>
      <p>Deze verklaring kan worden aangepast als de app verandert. De datum bovenaan geeft de laatste wijziging aan.</p>

      <h2 style={s.h2}>9. Contact</h2>
      <p>Vragen over deze verklaring? Neem contact op via de <a href={REPO_URL} target="_blank" rel="noreferrer" style={s.a}>GitHub-pagina van het project</a>.</p>
    </div>
  );
}

// ─── DISCLAIMER ───────────────────────────────────────────────────────────────
export function DisclaimerPagina() {
  return (
    <div style={s.pagina}>
      <Kop icoon="⚖️" titel="Disclaimer Pensioen Planner" versie="Versie 1.0" />
      <div style={s.waarschuw}>
        <strong>Aan de uitkomsten kunnen geen rechten worden ontleend.</strong> Pensioen Planner geeft een indicatie en
        is geen financieel, fiscaal of juridisch advies.
      </div>

      <h2 style={s.h2}>1. Indicatieve berekening</h2>
      <p>
        De bedragen zijn schattingen op basis van de gegevens die jij importeert of invult en van vereenvoudigde
        rekenregels. Je werkelijke inkomen kan afwijken. Controleer belangrijke beslissingen altijd bij de
        officiële bronnen.
      </p>

      <h2 style={s.h2}>2. Wat de berekening níet meeneemt</h2>
      <ul style={s.ul}>
        <li>Toekomstige wijzigingen in belastingtarieven, heffingskortingen, AOW-bedragen en AOW-leeftijd — er wordt gerekend met de regels van 2026.</li>
        <li>Indexatie van pensioenen en inflatie.</li>
        <li>Toeslagen (zoals zorg- en huurtoeslag) en de nominale zorgpremie.</li>
        <li>Box 3-belasting over spaargeld en vermogen; spaargeld en woning worden als netto bedrag opgeteld.</li>
        <li>Fiscale partnerregelingen, aftrekposten, en overdracht van heffingskorting tussen partners.</li>
        <li>Het verschil tussen maandelijkse inhouding (loonheffing) en de definitieve aanslag inkomstenbelasting.</li>
        <li>Nabestaandenpensioen, de invloed van de Wet toekomst pensioenen en wijzigingen in je opbouw ná de datum van je overzicht.</li>
        <li>De AOW-berekening bij eerder stoppen is een benadering (opbouw per jaar tot je pensioenleeftijd).</li>
      </ul>

      <h2 style={s.h2}>3. Juistheid van gegevens</h2>
      <p>
        De app gaat uit van de gegevens in je pensioenoverzicht en van wat je zelf invult. Fouten in die gegevens, of in
        het inlezen ervan, werken door in de uitkomst. Controleer daarom de ingelezen regelingen bij Pensioenen.
      </p>

      <h2 style={s.h2}>4. Officiële bronnen</h2>
      <ul style={s.ul}>
        <li><a href="https://www.mijnpensioenoverzicht.nl" target="_blank" rel="noreferrer" style={s.a}>mijnpensioenoverzicht.nl</a> — je opgebouwde pensioen en AOW</li>
        <li><a href="https://www.svb.nl" target="_blank" rel="noreferrer" style={s.a}>SVB</a> — AOW-leeftijd en AOW-bedragen</li>
        <li>Je pensioenuitvoerder(s) — de exacte hoogte en voorwaarden van je pensioen</li>
        <li><a href="https://www.belastingdienst.nl" target="_blank" rel="noreferrer" style={s.a}>Belastingdienst</a> — tarieven en heffingskortingen</li>
      </ul>
      <p>Voor persoonlijk advies kun je terecht bij een erkend financieel adviseur.</p>

      <h2 style={s.h2}>5. Aansprakelijkheid</h2>
      <p>
        De maker van Pensioen Planner is niet aansprakelijk voor schade die voortvloeit uit het gebruik van de app of
        uit beslissingen die op basis van de uitkomsten zijn genomen. Het gebruik is voor eigen risico.
      </p>

      <h2 style={s.h2}>6. Beschikbaarheid</h2>
      <p>
        De app wordt aangeboden zoals hij is, zonder garantie op beschikbaarheid of foutloosheid. Omdat je gegevens
        alleen in je browser staan, ben je zelf verantwoordelijk voor het maken van een backup.
      </p>
    </div>
  );
}
