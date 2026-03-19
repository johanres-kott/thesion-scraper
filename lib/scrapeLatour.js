// Scraper for Latour (latour.se)
// Portfolio page has a table with: Company, Shares, Est. Value (Mkr), Stock Price, Market Cap
import * as cheerio from "cheerio";

const URL = "https://www.latour.se/sv/innehav/borsportfolj";

export async function scrapeLatour() {
  const res = await fetch(URL, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
  const html = await res.text();

  const holdings = tryTableExtract(html) || tryTextExtract(html);

  if (!holdings || holdings.length === 0) {
    throw new Error("Could not extract holdings from Latour page");
  }

  // Calculate weights from values if we have them
  const totalValue = holdings.reduce((sum, h) => sum + (h.valueMSEK || 0), 0);
  if (totalValue > 0) {
    for (const h of holdings) {
      if (h.valueMSEK && !h.weight) {
        h.weight = Math.round((h.valueMSEK / totalValue) * 1000) / 10;
      }
    }
  }

  return {
    companyId: "latour",
    companyName: "Latour",
    url: URL,
    scrapedAt: new Date().toISOString(),
    holdings: holdings.sort((a, b) => (b.valueMSEK || 0) - (a.valueMSEK || 0)),
  };
}

function tryTableExtract(html) {
  try {
    const $ = cheerio.load(html);
    const holdings = [];

    $("table").each((_, table) => {
      $(table).find("tbody tr, tr").each((idx, row) => {
        const cells = [];
        $(row).find("td").each((_, td) => {
          // Extract text, but for img-only cells use alt text
          const img = $(td).find("img");
          const text = img.length > 0 ? img.attr("alt")?.trim() : $(td).text().trim();
          cells.push(text || "");
        });

        if (cells.length < 2) return;
        const name = cells[0].replace(/<[^>]+>/g, "").trim();
        if (!name || name.includes("Summa") || name.includes("Totalt") || name.includes("Total")) return;
        // Skip header-like rows
        if (name.includes("Bolag") || name.includes("Företag") || name.includes("Company")) return;

        // Try to find a value column (Mkr = MSEK)
        let valueMSEK = null;
        for (let i = 1; i < cells.length; i++) {
          const val = parseSwedishNumber(cells[i]);
          // Value in Mkr is typically in the hundreds or thousands
          if (val && val > 50) {
            valueMSEK = val;
            break;
          }
        }

        // Try to find a weight/percentage column
        let weight = null;
        for (const cell of cells) {
          const pct = cell.match(/([\d,]+)\s*%/);
          if (pct) {
            weight = parseSwedishNumber(pct[1]);
          }
        }

        if (name && (valueMSEK != null || weight != null)) {
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
      "Alimak Group", "ASSA ABLOY", "CTEK", "Fagerhult", "HMS Networks",
      "Nederman", "Securitas", "Sweco", "TOMRA", "Troax",
    ];

    for (const name of companies) {
      // Look for value near the company name
      const valMatch = text.match(new RegExp(name + "[\\s\\S]{0,200}?([\\d\\s]+(?:,\\d+)?)", "i"));
      if (valMatch) {
        const valueMSEK = parseSwedishNumber(valMatch[1]);
        holdings.push({ name, weight: null, valueMSEK });
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
