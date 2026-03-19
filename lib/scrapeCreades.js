// Scraper for Creades (creades.se)
// Data is in a simple HTML table on the substansvärde page
import * as cheerio from "cheerio";

const URL = "https://www.creades.se/innehav/substansvarde/";

export async function scrapeCreades() {
  const res = await fetch(URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ThesionBot/1.0)" },
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  const holdings = [];

  // Creades has a table with: Innehav | Antal aktier | Marknadsvärde (SEK mn) | Kr/Aktie | Andel %
  $("table").each((_, table) => {
    $(table).find("tbody tr, tr").each((idx, row) => {
      const cells = [];
      $(row).find("td").each((_, td) => {
        cells.push($(td).text().trim());
      });

      // Skip header rows and empty rows
      if (cells.length < 3) return;
      const name = cells[0];
      if (!name || name.includes("Innehav") || name.includes("Summa") || name.includes("Totalt")) return;
      // Skip non-listed aggregates
      if (name.includes("Onoterad") || name.includes("Aktiv förvaltning") || name.includes("Likvida")) return;

      const valueMSEK = parseSwedishNumber(cells[2]);
      const weight = parseSwedishNumber(cells[cells.length - 1]);

      if (name && (valueMSEK != null || weight != null)) {
        holdings.push({ name, weight, valueMSEK });
      }
    });
  });

  if (holdings.length === 0) {
    throw new Error("Could not extract holdings from Creades page");
  }

  return {
    companyId: "creades",
    companyName: "Creades",
    url: URL,
    scrapedAt: new Date().toISOString(),
    holdings: holdings.sort((a, b) => (b.valueMSEK || 0) - (a.valueMSEK || 0)),
  };
}

function parseSwedishNumber(str) {
  if (!str) return null;
  const cleaned = str.replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}
