// POST /api/snapshot — daily cron to save portfolio snapshots for all users
import { supabase } from "../lib/supabase.js";

async function fetchPrice(ticker) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const d = await res.json();
    const meta = d.chart?.result?.[0]?.meta;
    return { price: meta?.regularMarketPrice || 0, currency: meta?.currency || "SEK" };
  } catch {
    return { price: 0, currency: "SEK" };
  }
}

async function fetchFxRates() {
  try {
    const pairs = ["USDSEK=X", "EURSEK=X", "GBPSEK=X", "DKKSEK=X", "HKDSEK=X"];
    const rates = { SEK: 1 };
    for (const pair of pairs) {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${pair}?interval=1d&range=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const d = await res.json();
      const price = d.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price > 0) {
        const base = pair.replace("SEK=X", "");
        rates[base] = price;
      }
    }
    return rates;
  } catch {
    return { SEK: 1, USD: 10.5, EUR: 11.5, GBP: 13.5 };
  }
}

function toSek(price, currency, fxRates) {
  if (currency === "SEK") return price;
  const rate = fxRates[currency];
  if (rate) return price * rate;
  // Fallback — try common suffixes
  if (currency === "HKD") return price * (fxRates.HKD || 1.35);
  return price; // Unknown currency, return as-is
}

export default async function handler(req, res) {
  const cronSecret = req.headers["authorization"];
  const expectedSecret = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && cronSecret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  try {
    // Get all users with watchlist items that have shares
    const { data: holdings, error: hErr } = await supabase
      .from("watchlist")
      .select("user_id, ticker, name, shares, gav")
      .gt("shares", 0);

    if (hErr) throw hErr;
    if (!holdings || holdings.length === 0) {
      return res.json({ message: "No holdings to snapshot", count: 0 });
    }

    // Group by user
    const byUser = {};
    for (const h of holdings) {
      if (!byUser[h.user_id]) byUser[h.user_id] = [];
      byUser[h.user_id].push(h);
    }

    const fxRates = await fetchFxRates();
    const today = new Date().toISOString().split("T")[0];
    const results = [];

    for (const [userId, userHoldings] of Object.entries(byUser)) {
      let totalValue = 0;
      let totalCost = 0;
      const holdingsData = [];

      for (const h of userHoldings) {
        const { price, currency } = await fetchPrice(h.ticker);
        const valueSek = toSek(price * h.shares, currency, fxRates);
        const costSek = h.gav ? toSek(h.gav * h.shares, currency, fxRates) : 0;

        totalValue += valueSek;
        totalCost += costSek;
        holdingsData.push({
          ticker: h.ticker,
          name: h.name,
          shares: h.shares,
          price,
          currency,
          value_sek: Math.round(valueSek),
        });

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 200));
      }

      const { error: uErr } = await supabase.from("portfolio_snapshots").upsert({
        user_id: userId,
        snapshot_date: today,
        total_value_sek: Math.round(totalValue),
        total_cost_sek: Math.round(totalCost),
        holdings_count: userHoldings.length,
        holdings: holdingsData,
      }, { onConflict: "user_id,snapshot_date" });

      if (!uErr) {
        results.push({ userId: userId.slice(0, 8) + "...", holdings: userHoldings.length, value: Math.round(totalValue) });
      }
    }

    res.json({ message: "Snapshots saved", date: today, users: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
