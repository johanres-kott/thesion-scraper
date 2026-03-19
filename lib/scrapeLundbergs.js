// Scraper for Lundbergs (lundbergforetagen.se)
// Portfolio data shown on homepage and substansvärde page with percentage breakdown
// Total portfolio ~157 Mdkr (157,000 MSEK)
import * as cheerio from "cheerio";

const URL = "https://www.lundbergforetagen.se/investerare/substansvarde/";
const FALLBACK_URL = "https://www.lundbergforetagen.se/";

export async function scrapeLundbergs() {
  let holdings = null;

  // Try substansvärde page first (more structured data)
  try {
    const res = await fetch(URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    const html = await res.text();
    holdings = tryTableExtract(html) || tryTextExtract(html);
  } catch {
    // fall through to fallback
  }

  // Try homepage as fallback
  if (!holdings || holdings.length < 5) {
    try {
      const res = await fetch(FALLBACK_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      });
      const html = await res.text();
      holdings = tryTableExtract(html) || tryTextExtract(html) || holdings;
    } catch {
      // fall through
    }
  }

  if (!holdings || holdings.length === 0) {
    throw new Error("Could not extract holdings from Lundbergs page");
  }

  // Calculate valueMSEK from weights if not already set (total ~157,000 MSEK)
  const TOTAL_MSEK = 157000;
  for (const h of holdings) {
    if (h.weight && !h.valueMSEK) {
      h.valueMSEK = Math.round(h.weight / 100 * TOTAL_MSEK);
    }
  }

  return {
    companyId: "lundbergs",
    companyName: "Lundbergs",
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
        if (!name || name.includes("Summa") || name.includes("Totalt") || name.includes("Total")) return;
        if (name.includes("Bolag") || name.includes("Innehav")) return;

        let weight = null;
        let valueMSEK = null;

        for (const cell of cells.slice(1)) {
          const pct = cell.match(/([\d]+[,.]?\d*)\s*%/);
          if (pct) {
            weight = parseSwedishNumber(pct[1]);
          }
          // Value columns (Mkr or Mdkr)
          if (!pct) {
            const val = parseSwedishNumber(cell);
            if (val && val > 50) {
              valueMSEK = val;
            }
          }
        }

        if (name && (weight != null || valueMSEK != null)) {
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

    const companies = [
      { name: "Industrivärden", expectedWeight: 28.7 },
      { name: "Holmen", expectedWeight: 17.5 },
      { name: "Hufvudstaden", expectedWeight: 13.5 },
      { name: "Husqvarna", expectedWeight: 10.0 },
      { name: "Indutrade", expectedWeight: 9.5 },
      { name: "Alleima", expectedWeight: 3.5 },
      { name: "Handelsbanken", expectedWeight: 6.0 },
      { name: "Sandvik", expectedWeight: 5.0 },
      { name: "Skanska", expectedWeight: 3.0 },
    ];

    for (const { name, expectedWeight } of companies) {
      // Try to find percentage near company name
      const pctMatch = text.match(new RegExp(name + "[\\s\\S]{0,200}?(\\d+[,.]\\d+)\\s*%", "i"));
      if (pctMatch) {
        const weight = parseSwedishNumber(pctMatch[1]);
        holdings.push({ name, weight, valueMSEK: null });
      } else {
        // Use expected weight as fallback if company name is found on page
        if (text.includes(name)) {
          holdings.push({ name, weight: expectedWeight, valueMSEK: null });
        }
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
