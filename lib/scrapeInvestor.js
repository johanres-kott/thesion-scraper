// Scraper for Investor AB (investorab.com)
// Data is embedded as JSON in window.__INITIAL_PROPS.data[uuid]
import * as cheerio from "cheerio";

const PAGE_URL = "https://www.investorab.com/our-companies/listed-companies/";

export async function scrapeInvestor() {
  const res = await fetch(PAGE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
  const html = await res.text();

  const holdings = tryRegexExtract(html) || tryHtmlExtract(html);

  if (!holdings || holdings.length === 0) {
    throw new Error("Could not extract holdings from Investor page");
  }

  // Filter out category names and unlisted companies
  const excludeNames = new Set([
    "Listed Companies", "Patricia Industries", "Investments in EQT",
    "Mölnlycke", "Laborie", "Nova Biomedical", "Sarnova", "BraunAbility",
    "Permobil", "Piab", "3 Scandinavia", "Financial Investments",
  ]);
  const filtered = holdings.filter(h => h.weight > 0 && !excludeNames.has(h.name));

  return {
    companyId: "investor",
    companyName: "Investor",
    url: PAGE_URL,
    scrapedAt: new Date().toISOString(),
    holdings: filtered.sort((a, b) => b.weight - a.weight),
  };
}

function tryRegexExtract(html) {
  // The page has JS objects with embedded JSON arrays.
  // Extract title+percentage pairs directly from the raw text.
  try {
    const holdings = [];
    const seen = new Set();
    // Match: "title":"CompanyName", ... "percentage":0.16
    const regex = /"title":"([^"]+)"[^}]*?"percentage":([\d.]+)/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const name = match[1];
      const pct = parseFloat(match[2]);
      if (name && pct > 0 && !seen.has(name)) {
        seen.add(name);
        holdings.push({ name, weight: Math.round(pct * 100 * 10) / 10, valueMSEK: null });
      }
    }
    return holdings.length > 0 ? holdings : null;
  } catch {
    return null;
  }
}

function tryHtmlExtract(html) {
  try {
    const $ = cheerio.load(html);
    const holdings = [];
    const text = $.text();
    const companies = ["ABB", "Atlas Copco", "AstraZeneca", "Saab", "SEB", "Nasdaq",
      "Epiroc", "Sobi", "Ericsson", "Wärtsilä", "EQT", "Electrolux Professional", "Electrolux", "Husqvarna"];
    for (const name of companies) {
      const pctMatch = text.match(new RegExp(name + "[\\s\\S]{0,200}?(\\d+)\\s*%", "i"));
      if (pctMatch) {
        holdings.push({ name, weight: parseInt(pctMatch[1]), valueMSEK: null });
      }
    }
    return holdings.length > 0 ? holdings : null;
  } catch {
    return null;
  }
}
