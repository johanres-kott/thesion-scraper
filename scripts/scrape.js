#!/usr/bin/env node
// Local scrape script — run with: npm run scrape
// Scrapes all investment company websites, resolves tickers, stores in Supabase.
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, FINNHUB_KEY

import { scrapeInvestor } from "../lib/scrapeInvestor.js";
import { scrapeOresund } from "../lib/scrapeOresund.js";
import { scrapeCreades } from "../lib/scrapeCreades.js";
import { resolveAllTickers } from "../lib/resolveTickers.js";
import { supabase } from "../lib/supabase.js";

if (!supabase) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Set them as env vars.");
  process.exit(1);
}
if (!process.env.FINNHUB_KEY) {
  console.error("Missing FINNHUB_KEY. Set it as an env var.");
  process.exit(1);
}

const scrapers = [
  { fn: scrapeInvestor, name: "Investor" },
  { fn: scrapeOresund, name: "Öresund" },
  { fn: scrapeCreades, name: "Creades" },
];

for (const { fn, name } of scrapers) {
  try {
    console.log(`Scraping ${name}...`);
    const data = await fn();
    console.log(`  Found ${data.holdings.length} holdings, resolving tickers...`);

    const withTickers = await resolveAllTickers(data.holdings);
    const rows = withTickers
      .filter(h => h.ticker)
      .map(h => ({
        company_id: data.companyId,
        company_name: data.companyName,
        holding_name: h.name,
        ticker: h.ticker,
        weight: h.weight,
        value_msek: h.valueMSEK,
        scraped_at: data.scrapedAt,
      }));

    if (rows.length > 0) {
      await supabase.from("investment_holdings").delete().eq("company_id", data.companyId);
      const { error } = await supabase.from("investment_holdings").insert(rows);
      if (error) throw error;
    }

    console.log(`  ✓ ${name}: ${rows.length} holdings saved`);
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

console.log("\nDone! Check https://thesion-scraper.vercel.app/api/holdings");
