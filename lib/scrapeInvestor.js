// Scraper for Investor AB (investorab.com)
// Data is embedded as JSON in window.__INITIAL_PROPS.data[uuid]
import * as cheerio from "cheerio";

const PAGE_URL = "https://www.investorab.com/our-companies/listed-companies/";

export async function scrapeInvestor() {
  const res = await fetch(PAGE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
  const html = await res.text();

  const holdings = tryJsonExtract(html) || tryHtmlExtract(html);

  if (!holdings || holdings.length === 0) {
    throw new Error("Could not extract holdings from Investor page");
  }

  return {
    companyId: "investor",
    companyName: "Investor",
    url: PAGE_URL,
    scrapedAt: new Date().toISOString(),
    holdings: holdings.filter(h => h.weight > 0).sort((a, b) => b.weight - a.weight),
  };
}

function tryJsonExtract(html) {
  try {
    const holdings = [];
    // Match individual data block assignments
    const regex = /window\.__INITIAL_PROPS\.data\[['"][^'"]+['"]\]\s*=\s*(\{[\s\S]*?\});\s*$/gm;
    let match;
    while ((match = regex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        extractFromData(data, holdings);
      } catch { /* skip unparseable blocks */ }
    }
    // Fallback: single assignment
    if (holdings.length === 0) {
      const single = html.match(/window\.__INITIAL_PROPS\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
      if (single) {
        const props = JSON.parse(single[1]);
        for (const value of Object.values(props.data || {})) {
          extractFromData(value, holdings);
        }
      }
    }
    return holdings.length > 0 ? holdings : null;
  } catch {
    return null;
  }
}

function extractFromData(data, holdings) {
  const tabs = data?.response?.tabs || data?.data?.tabs || data?.tabs || [];
  for (const tab of tabs) {
    for (const child of (tab?.children || tab?.items || [])) {
      if (child.title && typeof child.percentage === "number") {
        holdings.push({ name: child.title, weight: Math.round(child.percentage * 100 * 10) / 10, valueMSEK: null });
      }
    }
  }
  for (const item of (data?.response?.items || data?.data?.items || data?.items || [])) {
    if (item.title && typeof item.percentage === "number") {
      holdings.push({ name: item.title, weight: Math.round(item.percentage * 100 * 10) / 10, valueMSEK: null });
    }
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
