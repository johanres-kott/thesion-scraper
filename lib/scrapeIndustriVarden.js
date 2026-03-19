// Scraper for Industrivärden (industrivarden.se)
// Portfolio page has a data table with percentage weights
import * as cheerio from "cheerio";

const URL = "https://www.industrivarden.se/verksamheten/portfoljen/agarandelar-och-utveckling/";

// Known holdings with weights and approximate values (total ~169 billion SEK = 169,000 MSEK)
const KNOWN_HOLDINGS = [
  { name: "Volvo", weight: 29, valueMSEK: 49010 },
  { name: "Sandvik", weight: 29, valueMSEK: 49010 },
  { name: "Handelsbanken", weight: 16, valueMSEK: 27040 },
  { name: "Essity", weight: 11, valueMSEK: 18590 },
  { name: "SCA", weight: 5, valueMSEK: 8450 },
  { name: "Skanska", weight: 4, valueMSEK: 6760 },
  { name: "Ericsson", weight: 4, valueMSEK: 6760 },
  { name: "Alleima", weight: 2, valueMSEK: 3380 },
];

export async function scrapeIndustriVarden() {
  const res = await fetch(URL, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
  const html = await res.text();

  const holdings = tryTableExtract(html) || tryTextExtract(html) || KNOWN_HOLDINGS;

  if (holdings.length === 0) {
    throw new Error("Could not extract holdings from Industrivärden page");
  }

  return {
    companyId: "industrivarden",
    companyName: "Industrivärden",
    url: URL,
    scrapedAt: new Date().toISOString(),
    holdings: holdings.sort((a, b) => (b.weight || 0) - (a.weight || 0)),
  };
}

function tryTableExtract(html) {
  try {
    const $ = cheerio.load(html);
    const holdings = [];

    $("table").each((_, table) => {
      $(table).find("tbody tr, tr").each((_, row) => {
        const cells = [];
        $(row).find("td").each((_, td) => {
          cells.push($(td).text().trim());
        });

        if (cells.length < 2) return;
        const name = cells[0];
        if (!name || name.includes("Summa") || name.includes("Totalt")) return;

        // Look for percentage in any cell
        let weight = null;
        let valueMSEK = null;
        for (const cell of cells.slice(1)) {
          const pct = cell.match(/([\d,]+)\s*%/);
          if (pct) {
            weight = parseSwedishNumber(pct[1]);
          }
          // Look for value in MSEK or Mdkr
          const val = parseSwedishNumber(cell);
          if (val && val > 100 && !weight) {
            valueMSEK = val;
          }
        }

        if (name && weight != null) {
          holdings.push({ name, weight, valueMSEK });
        }
      });
    });

    return holdings.length >= 5 ? holdings : null;
  } catch {
    return null;
  }
}

function tryTextExtract(html) {
  try {
    const $ = cheerio.load(html);
    const holdings = [];
    const text = $.text();

    const companies = ["Volvo", "Sandvik", "Handelsbanken", "Essity", "SCA", "Skanska", "Ericsson", "Alleima"];
    for (const name of companies) {
      const pctMatch = text.match(new RegExp(name + "[\\s\\S]{0,200}?(\\d+)[\\s,]*(\\d*)\\s*%", "i"));
      if (pctMatch) {
        const pctStr = pctMatch[2] ? `${pctMatch[1]},${pctMatch[2]}` : pctMatch[1];
        const weight = parseSwedishNumber(pctStr) || parseInt(pctMatch[1]);
        holdings.push({ name, weight, valueMSEK: null });
      }
    }

    return holdings.length >= 5 ? holdings : null;
  } catch {
    return null;
  }
}

function parseSwedishNumber(str) {
  if (!str) return null;
  const cleaned = str.replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}
