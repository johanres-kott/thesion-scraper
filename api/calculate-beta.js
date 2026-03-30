// POST /api/calculate-beta — calculates beta for all scored stocks
// Triggered by cron (weekly) or manually
// Fetches 5y weekly data from Yahoo, calculates beta vs appropriate index,
// stores in stock_scores table

import { supabase } from "../lib/supabase.js";
import { calculateBetaForStock } from "../lib/calculateBeta.js";

export default async function handler(req, res) {
  // Auth check
  const cronSecret = req.headers["authorization"];
  const expectedSecret = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && cronSecret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!supabase) {
    return res.status(500).json({ error: "Missing Supabase config" });
  }

  // Get all tickers from stock_scores
  const { data: stocks, error: fetchErr } = await supabase
    .from("stock_scores")
    .select("ticker")
    .order("ticker");

  if (fetchErr) {
    return res.status(500).json({ error: fetchErr.message });
  }

  const tickers = stocks.map(s => s.ticker);
  const results = { success: 0, failed: 0, skipped: 0, errors: [] };

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];

    try {
      const betaResult = await calculateBetaForStock(ticker);

      if (!betaResult) {
        results.skipped++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from("stock_scores")
        .update({
          beta_calculated: betaResult.beta,
          beta_index: betaResult.index,
          beta_calculated_at: new Date().toISOString(),
        })
        .eq("ticker", ticker);

      if (updateErr) {
        results.errors.push({ ticker, error: updateErr.message });
        results.failed++;
      } else {
        results.success++;
      }
    } catch (err) {
      results.errors.push({ ticker, error: err.message });
      results.failed++;
    }

    // Rate limit between Yahoo requests
    if (i < tickers.length - 1) {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  res.json({
    total: tickers.length,
    ...results,
    timestamp: new Date().toISOString(),
  });
}
