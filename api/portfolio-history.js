// GET /api/portfolio-history?user_id=xxx — returns portfolio value over time
// Combines actual snapshots with estimated historical values
import { supabase } from "../lib/supabase.js";

async function fetchChartData(ticker, range = "3mo") {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const d = await res.json();
    const result = d.chart?.result?.[0];
    if (!result) return [];
    const times = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const currency = result.meta?.currency || "SEK";
    return times.map((t, i) => ({
      date: new Date(t * 1000).toISOString().split("T")[0],
      close: closes[i],
      currency,
    })).filter(p => p.close != null);
  } catch {
    return [];
  }
}

async function fetchFxRates() {
  try {
    const rates = { SEK: 1 };
    const pairs = [["USDSEK=X", "USD"], ["EURSEK=X", "EUR"], ["GBPSEK=X", "GBP"]];
    for (const [pair, key] of pairs) {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${pair}?interval=1d&range=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const d = await res.json();
      const price = d.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price > 0) rates[key] = price;
    }
    return rates;
  } catch {
    return { SEK: 1, USD: 10.5, EUR: 11.5, GBP: 13.5 };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: "Missing user_id" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  try {
    // Get actual snapshots
    const { data: snapshots } = await supabase
      .from("portfolio_snapshots")
      .select("snapshot_date, total_value_sek, total_cost_sek, holdings_count")
      .eq("user_id", userId)
      .order("snapshot_date", { ascending: true });

    const snapshotMap = {};
    for (const s of (snapshots || [])) {
      snapshotMap[s.snapshot_date] = {
        date: s.snapshot_date,
        totalValue: s.total_value_sek,
        totalCost: s.total_cost_sek,
        holdingsCount: s.holdings_count,
        estimated: false,
      };
    }

    // Get current holdings for estimation
    const { data: holdings } = await supabase
      .from("watchlist")
      .select("ticker, shares, gav")
      .eq("user_id", userId)
      .gt("shares", 0);

    if (!holdings || holdings.length === 0) {
      return res.json({ snapshots: Object.values(snapshotMap).sort((a, b) => a.date.localeCompare(b.date)) });
    }

    // Fetch historical chart data for each holding
    const fxRates = await fetchFxRates();
    const charts = {};
    for (const h of holdings) {
      const data = await fetchChartData(h.ticker, "6mo");
      if (data.length > 0) {
        charts[h.ticker] = { data, currency: data[0].currency, shares: h.shares, gav: h.gav };
      }
      await new Promise(r => setTimeout(r, 200));
    }

    // Build estimated daily values
    const allDates = new Set();
    for (const c of Object.values(charts)) {
      for (const p of c.data) allDates.add(p.date);
    }

    for (const date of allDates) {
      if (snapshotMap[date]) continue; // Actual data takes precedence

      let totalValue = 0;
      let totalCost = 0;
      let count = 0;

      for (const [ticker, c] of Object.entries(charts)) {
        const point = c.data.find(p => p.date === date);
        if (point) {
          const rate = c.currency === "SEK" ? 1 : (fxRates[c.currency] || 1);
          totalValue += point.close * c.shares * rate;
          totalCost += (c.gav || 0) * c.shares * rate;
          count++;
        }
      }

      if (count > 0) {
        snapshotMap[date] = {
          date,
          totalValue: Math.round(totalValue),
          totalCost: Math.round(totalCost),
          holdingsCount: count,
          estimated: true,
        };
      }
    }

    const result = Object.values(snapshotMap).sort((a, b) => a.date.localeCompare(b.date));

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    res.json({ snapshots: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
