// Scrapes Finansinspektionen's insider register (insynsregistret)
// Uses the export endpoint to get transactions for a given company name

const BASE = "https://marknadssok.fi.se/Publiceringsklient/sv-SE";
const AUTOCOMPLETE_URL = `${BASE}/AutoComplete/H%C3%A4mtaAutoCompleteListaFull`;
const SEARCH_URL = `${BASE}/Search/Search`;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
};

// Resolve company name via FI autocomplete
export async function resolveCompanyName(searchTerm) {
  const url = `${AUTOCOMPLETE_URL}?sokfunktion=Insyn&falt=Utgivare&sokterm=${encodeURIComponent(searchTerm)}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[0]; // Best match
    }
    return null;
  } catch {
    return null;
  }
}

// Parse the HTML search results from FI
// Columns: Publiceringsdatum, Emittent, Person, Befattning, Närstående,
// Karaktär, Instrumentnamn, Instrumenttyp, ISIN, Transaktionsdatum,
// Volym, Volymsenhet, Pris, Valuta, Status, Detaljer
function parseSearchResults(html) {
  const transactions = [];

  // Extract tbody content
  const tbodyStart = html.indexOf("<tbody>");
  const tbodyEnd = html.indexOf("</tbody>");
  if (tbodyStart === -1 || tbodyEnd === -1) return transactions;

  const tbody = html.substring(tbodyStart, tbodyEnd);

  // Match all rows in tbody
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tbody)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      // Clean HTML entities and tags
      cells.push(cellMatch[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&#\d+;/g, m => String.fromCharCode(parseInt(m.slice(2, -1))))
        .trim());
    }

    // FI has 16 columns: pubDate, emittent, person, befattning, närstående,
    // karaktär, instrumentnamn, instrumenttyp, isin, transDate, volym,
    // volymsenhet, pris, valuta, status, detaljer
    if (cells.length >= 13) {
      const vol = parseFloat((cells[10] || "0").replace(/\s/g, "").replace(",", ".")) || 0;
      const price = parseFloat((cells[12] || "0").replace(/\s/g, "").replace(",", ".")) || 0;

      transactions.push({
        publicationDate: cells[0] || null,
        companyName: cells[1] || null,
        personName: cells[2] || null,
        position: cells[3]?.replace(/\s+/g, " ") || null,
        transactionType: cells[5] || null, // Karaktär: Förvärv/Avyttring
        instrumentName: cells[6] || null,
        instrumentType: cells[7] || null,
        isin: cells[8] || null,
        transactionDate: cells[9] || null,
        volume: vol,
        price: price,
        currency: cells[13] || "SEK",
      });
    }
  }

  return transactions;
}

// Fetch insider transactions for a company from FI
export async function scrapeInsiderTransactions(companyName, monthsBack = 12) {
  const now = new Date();
  const from = new Date(now);
  from.setMonth(from.getMonth() - monthsBack);

  const fromStr = from.toISOString().split("T")[0];
  const toStr = now.toISOString().split("T")[0];

  // First resolve the exact company name via autocomplete
  const resolvedName = await resolveCompanyName(companyName);
  const searchName = resolvedName || companyName;

  const allTransactions = [];

  // Fetch up to 5 pages (50 results)
  for (let page = 1; page <= 5; page++) {
    const params = new URLSearchParams({
      SearchFunctionType: "Insyn",
      Utgivare: searchName,
      "Transaktionsdatum.From": fromStr,
      "Transaktionsdatum.To": toStr,
      button: "search",
      page: String(page),
    });

    try {
      const res = await fetch(`${SEARCH_URL}?${params}`, { headers: HEADERS });
      if (!res.ok) break;

      const html = await res.text();
      const transactions = parseSearchResults(html);

      if (transactions.length === 0) break;
      allTransactions.push(...transactions);

      // If less than 10 results, we're on the last page
      if (transactions.length < 10) break;

      // Rate limit - wait 500ms between pages
      await new Promise(r => setTimeout(r, 500));
    } catch {
      break;
    }
  }

  return allTransactions;
}

// Map tickers to FI-registered company names (must match exactly)
export const TICKER_TO_FI_NAME = {
  "ABB.ST": "ABB Ltd",
  "ATCO-A.ST": "Atlas Copco AB",
  "AZN.ST": "AstraZeneca PLC",
  "SAAB-B.ST": "SAAB AB",
  "SEB-A.ST": "Skandinaviska Enskilda Banken AB",
  "EPI-A.ST": "Epiroc AB",
  "SOBI.ST": "Swedish Orphan Biovitrum AB (publ)",
  "ERIC-B.ST": "Telefonaktiebolaget LM Ericsson",
  "EQT.ST": "EQT AB",
  "ELUX-B.ST": "AB Electrolux",
  "HUSQ-B.ST": "Husqvarna AB",
  "VOLV-B.ST": "AB Volvo",
  "SAND.ST": "Sandvik AB",
  "SHB-A.ST": "Svenska Handelsbanken AB",
  "SWED-A.ST": "Swedbank AB",
  "AZA.ST": "Avanza Bank Holding AB",
  "HM-B.ST": "H & M Hennes & Mauritz AB",
  "INVE-B.ST": "Investor AB",
  "INDU-C.ST": "AB Industrivärden",
  "ORES.ST": "Investment AB Öresund",
  "LATO-B.ST": "Investment AB Latour",
  "LUND-B.ST": "L E Lundbergföretagen AB",
  "SVOL-B.ST": "Svolder AB",
  "CREAS.ST": "Creades AB",
  "SECU-B.ST": "Securitas AB",
  "SHOT.ST": "Scandic Hotels Group AB",
  "BILI-A.ST": "Bilia AB",
  "BAHN-B.ST": "Bahnhof AB",
  "HEX-B.ST": "Hexagon AB",
  "SINCH.ST": "Sinch AB",
  "EMBRAC-B.ST": "Embracer Group AB",
  "NIBE-B.ST": "NIBE Industrier AB",
  "ALFA.ST": "Alfa Laval AB",
  "SKF-B.ST": "AB SKF",
  "SAGA-B.ST": "AB Sagax",
  "CAST.ST": "Castellum AB",
  "BOLI.ST": "Boliden AB",
};

// Get FI name from ticker - try map first, then autocomplete
export async function tickerToFIName(ticker) {
  // Strip exchange suffix for the name
  const clean = ticker.replace(/\.ST$|\.HE$/i, "").replace(/-[A-D]$/i, "");

  // Check static map first
  if (TICKER_TO_FI_NAME[ticker.toUpperCase()]) {
    return TICKER_TO_FI_NAME[ticker.toUpperCase()];
  }

  // Try autocomplete with cleaned ticker
  const resolved = await resolveCompanyName(clean);
  return resolved || clean;
}
