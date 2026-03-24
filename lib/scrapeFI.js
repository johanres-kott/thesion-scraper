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
function parseSearchResults(html) {
  const transactions = [];

  // Match table rows - FI returns HTML tables with transaction data
  // Each row contains: Publiceringsdatum, Utgivare, Person, Befattning,
  // Transaktionstyp, Instrumentnamn, ISIN, Transaktionsdatum, Volym, Pris, etc.
  const rowRegex = /<tr class="search-result-item">([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;

  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells = [];
    let cellMatch;
    const rowHtml = rowMatch[1];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
    }

    if (cells.length >= 10) {
      transactions.push({
        publicationDate: cells[0] || null,
        companyName: cells[1] || null,
        personName: cells[2] || null,
        position: cells[3] || null,
        transactionType: cells[5] || null,
        instrumentName: cells[6] || null,
        isin: cells[7] || null,
        transactionDate: cells[8] || null,
        volume: parseFloat((cells[9] || "0").replace(/\s/g, "").replace(",", ".")) || 0,
        price: parseFloat((cells[10] || "0").replace(/\s/g, "").replace(",", ".")) || 0,
        currency: cells[11] || "SEK",
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

// Map common Swedish stock tickers to company names as known by FI
export const TICKER_TO_FI_NAME = {
  "ABB.ST": "ABB",
  "ATCO-A.ST": "Atlas Copco",
  "AZN.ST": "AstraZeneca",
  "SAAB-B.ST": "Saab",
  "SEB-A.ST": "SEB",
  "EPI-A.ST": "Epiroc",
  "SOBI.ST": "Swedish Orphan Biovitrum",
  "ERIC-B.ST": "Ericsson",
  "EQT.ST": "EQT",
  "ELUX-B.ST": "Electrolux",
  "HUSQ-B.ST": "Husqvarna",
  "VOLV-B.ST": "Volvo",
  "SAND.ST": "Sandvik",
  "SHB-A.ST": "Handelsbanken",
  "SWED-A.ST": "Swedbank",
  "AZA.ST": "Avanza",
  "HM-B.ST": "H & M",
  "INVE-B.ST": "Investor",
  "INDU-C.ST": "Industrivärden",
  "ORES.ST": "Öresund",
  "LATO-B.ST": "Latour",
  "LUND-B.ST": "Lundbergföretagen",
  "SVOL-B.ST": "Svolder",
  "CREAS.ST": "Creades",
  "SECU-B.ST": "Securitas",
  "SHOT.ST": "Scandic Hotels",
  "BILI-A.ST": "Bilia",
  "BAHN-B.ST": "Bahnhof",
  "HEX-B.ST": "Hexagon",
  "SINCH.ST": "Sinch",
  "EMBRAC-B.ST": "Embracer",
  "NIBE-B.ST": "NIBE",
  "ALFA.ST": "Alfa Laval",
  "SKF-B.ST": "SKF",
  "SAGA-B.ST": "Sagax",
  "CAST.ST": "Castellum",
  "BOLI.ST": "Boliden",
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
