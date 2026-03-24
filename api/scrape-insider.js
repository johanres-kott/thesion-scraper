// POST /api/scrape-insider — triggered by cron daily
// Scrapes FI insider register for all tickers in watchlist

import { supabase } from "../lib/supabase.js";
import { scrapeInsiderTransactions, tickerToFIName } from "../lib/scrapeFI.js";

export default async function handler(req, res) {
  // Verify cron secret
  const cronSecret = req.headers["authorization"];
  const expectedSecret = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && cronSecret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Get unique tickers from watchlist
    const { data: watchlist, error: wlError } = await supabase
      .from("watchlist")
      .select("ticker, name")
      .not("ticker", "is", null);

    if (wlError) {
      return res.status(500).json({ error: wlError.message });
    }

    // Deduplicate tickers
    const seen = new Set();
    const tickers = (watchlist || []).filter(w => {
      if (seen.has(w.ticker.toUpperCase())) return false;
      seen.add(w.ticker.toUpperCase());
      return true;
    });

    // Also add investment company tickers
    const { data: holdings } = await supabase
      .from("investment_holdings")
      .select("ticker")
      .not("ticker", "is", null);

    (holdings || []).forEach(h => {
      if (!seen.has(h.ticker.toUpperCase())) {
        seen.add(h.ticker.toUpperCase());
        tickers.push({ ticker: h.ticker, name: h.ticker });
      }
    });

    const results = [];
    let totalInserted = 0;

    for (const item of tickers) {
      // Only scrape Swedish stocks (.ST suffix)
      if (!item.ticker.toUpperCase().endsWith(".ST")) continue;

      try {
        const fiName = await tickerToFIName(item.ticker);
        const transactions = await scrapeInsiderTransactions(fiName, 6);

        if (transactions.length > 0) {
          const rows = transactions.map(t => ({
            company_name: t.companyName || item.name || fiName,
            ticker: item.ticker.toUpperCase(),
            person_name: t.personName,
            position: t.position,
            transaction_type: t.transactionType,
            transaction_date: t.transactionDate,
            volume: t.volume,
            price: t.price,
            currency: t.currency || "SEK",
            isin: t.isin,
            instrument_name: t.instrumentName,
            publication_date: t.publicationDate,
          }));

          // Upsert (ignore duplicates via unique constraint)
          const { data: inserted, error: insertError } = await supabase
            .from("insider_transactions")
            .upsert(rows, { onConflict: "ticker,person_name,transaction_date,transaction_type,volume", ignoreDuplicates: true })
            .select();

          totalInserted += inserted?.length || 0;
          results.push({ ticker: item.ticker, transactions: transactions.length, inserted: inserted?.length || 0 });
        } else {
          results.push({ ticker: item.ticker, transactions: 0, inserted: 0 });
        }

        // Rate limit - wait 1s between companies to avoid FI throttling
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        results.push({ ticker: item.ticker, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      companiesProcessed: results.length,
      totalInserted,
      results,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
