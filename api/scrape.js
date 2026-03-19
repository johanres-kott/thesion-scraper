// POST /api/scrape — triggered by Vercel cron (weekly) or manually
// Scrapes all investment company websites, resolves tickers, stores in Supabase

import { scrapeInvestor } from "../lib/scrapeInvestor.js";
import { scrapeOresund } from "../lib/scrapeOresund.js";
import { scrapeCreades } from "../lib/scrapeCreades.js";
import { scrapeIndustriVarden } from "../lib/scrapeIndustriVarden.js";
import { scrapeLatour } from "../lib/scrapeLatour.js";
import { scrapeLundbergs } from "../lib/scrapeLundbergs.js";
import { scrapeSvolder } from "../lib/scrapeSvolder.js";
import { resolveAllTickers } from "../lib/resolveTickers.js";
import { supabase } from "../lib/supabase.js";

const scrapers = [scrapeInvestor, scrapeOresund, scrapeCreades, scrapeIndustriVarden, scrapeLatour, scrapeLundbergs, scrapeSvolder];

export default async function handler(req, res) {
  // Verify cron secret or allow manual trigger
  const cronSecret = req.headers["authorization"];
  const expectedSecret = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && cronSecret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results = [];

  for (const scraper of scrapers) {
    try {
      const data = await scraper();
      const withTickers = await resolveAllTickers(data.holdings);

      // Upsert into Supabase
      const rows = withTickers
        .filter((h) => h.ticker) // skip unresolved
        .map((h) => ({
          company_id: data.companyId,
          company_name: data.companyName,
          holding_name: h.name,
          ticker: h.ticker,
          weight: h.weight,
          value_msek: h.valueMSEK,
          scraped_at: data.scrapedAt,
        }));

      if (rows.length > 0) {
        // Delete old data for this company, then insert fresh
        await supabase
          .from("investment_holdings")
          .delete()
          .eq("company_id", data.companyId);

        const { error } = await supabase
          .from("investment_holdings")
          .insert(rows);

        if (error) throw error;
      }

      results.push({
        company: data.companyName,
        holdings: rows.length,
        status: "ok",
      });
    } catch (err) {
      results.push({
        company: scraper.name,
        status: "error",
        error: err.message,
      });
    }
  }

  return res.json({ results, timestamp: new Date().toISOString() });
}
