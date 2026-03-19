// Scraper for Öresund (oresund.se)
// Data is in an HTML table on the substansvärde page
import * as cheerio from "cheerio";

const URL = "https://www.oresund.se/innehav-substansvarden/senaste-substansvardet/";

export async function scrapeOresund() {
  const res = await fetch(URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ThesionBot/1.0)" },
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  const holdings = [];

  // Find the holdings table — look for table with columns matching expected headers
  $("table").each((_, table) => {
    const headers = [];
    $(table).find("thead th, thead td, tr:first-child th, tr:first-child td").each((_, th) => {
      headers.push($(th).text().trim().toLowerCase());
    });

    // Check if this looks like the holdings table
    const hasCompanyCol = headers.some(h => h.includes("innehav") || h.includes("bolag"));
    const hasValueCol = headers.some(h => h.includes("marknadsvärde") || h.includes("värde"));

    if (!hasCompanyCol && !hasValueCol && headers.length < 3) return;

    // Parse rows
    $(table).find("tbody tr, tr").each((idx, row) => {
      if (idx === 0 && headers.length > 0) return; // skip header row
      const cells = [];
      $(row).find("td").each((_, td) => {
        cells.push($(td).text().trim());
      });

      if (cells.length < 4) return;

      const name = cells[0];
      // Skip summary rows
      if (!name || name.includes("Summa") || name.includes("Övriga") || name.includes("Övrigt")) return;

      const valueMSEK = parseSwedishNumber(cells[2]);
      const weight = parseSwedishNumber(cells[4]) || parseSwedishNumber(cells[3]);

      if (name && (valueMSEK || weight)) {
        holdings.push({ name, weight, valueMSEK });
      }
    });
  });

  if (holdings.length === 0) {
    throw new Error("Could not extract holdings from Öresund page");
  }

  return {
    companyId: "oresund",
    companyName: "Öresund",
    url: URL,
    scrapedAt: new Date().toISOString(),
    holdings: holdings.sort((a, b) => (b.weight || 0) - (a.weight || 0)),
  };
}

function parseSwedishNumber(str) {
  if (!str) return null;
  // Remove spaces, replace comma with dot: "1 325" → 1325, "25,1" → 25.1
  const cleaned = str.replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}
