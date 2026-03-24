// GET /api/insider?ticker=ABB.ST — returns insider transactions from cache (Supabase)
// POST /api/insider/scrape — triggered by cron to scrape FI for all watchlist tickers

import { supabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const ticker = req.query.ticker;
  if (!ticker) {
    return res.status(400).json({ error: "ticker parameter required" });
  }

  try {
    // Fetch from Supabase cache
    const { data, error } = await supabase
      .from("insider_transactions")
      .select("*")
      .eq("ticker", ticker.toUpperCase())
      .order("transaction_date", { ascending: false })
      .limit(20);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Format response
    const transactions = (data || []).map(t => ({
      person: t.person_name,
      position: t.position,
      type: t.transaction_type,
      date: t.transaction_date,
      volume: t.volume,
      price: t.price,
      currency: t.currency,
      value: t.volume && t.price ? Math.round(t.volume * t.price) : null,
      isin: t.isin,
      instrumentName: t.instrument_name,
    }));

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=1800");
    return res.status(200).json({
      ticker: ticker.toUpperCase(),
      transactions,
      lastScraped: data?.[0]?.scraped_at || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
