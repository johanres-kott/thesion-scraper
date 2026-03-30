// POST /api/generate-notifications — daily cron to generate user notifications
// Checks price moves, insider transactions for each user's watchlist
import { supabase } from "../lib/supabase.js";

async function fetchPriceChange(ticker) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2d`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const d = await res.json();
    const meta = d.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const prevClose = meta?.chartPreviousClose || meta?.previousClose;
    if (!price || !prevClose || prevClose === 0) return null;
    const changePct = ((price - prevClose) / prevClose) * 100;
    return { price, prevClose, changePct };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const cronSecret = req.headers["authorization"];
  const expectedSecret = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && cronSecret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  try {
    // Get distinct user_ids from watchlist
    const { data: users, error: uErr } = await supabase
      .from("watchlist")
      .select("user_id");

    if (uErr) throw uErr;

    const uniqueUserIds = [...new Set((users || []).map((u) => u.user_id))];
    if (uniqueUserIds.length === 0) {
      return res.json({ message: "No users found", notifications: 0 });
    }

    const today = new Date().toISOString().split("T")[0];
    let totalCreated = 0;
    const results = [];

    for (const userId of uniqueUserIds) {
      // Get user's watchlist items with shares > 0
      const { data: holdings, error: hErr } = await supabase
        .from("watchlist")
        .select("ticker, name, shares")
        .eq("user_id", userId)
        .gt("shares", 0);

      if (hErr || !holdings || holdings.length === 0) continue;

      const tickers = holdings.map((h) => h.ticker);
      const tickerNameMap = {};
      for (const h of holdings) {
        tickerNameMap[h.ticker] = h.name;
      }

      // --- 1. Large price moves ---
      for (const h of holdings) {
        const priceData = await fetchPriceChange(h.ticker);
        if (!priceData) continue;

        const { changePct, price, prevClose } = priceData;
        if (Math.abs(changePct) >= 5) {
          const direction = changePct > 0 ? "up" : "down";
          const sign = changePct > 0 ? "+" : "";
          const title = `${h.name} ${direction} ${sign}${changePct.toFixed(1)}%`;
          const body = `${h.name} (${h.ticker}) moved from ${prevClose.toFixed(2)} to ${price.toFixed(2)} today (${sign}${changePct.toFixed(1)}%).`;

          // Skip if notification already exists for same user+ticker+type+date
          const { data: existing } = await supabase
            .from("notifications")
            .select("id")
            .eq("user_id", userId)
            .eq("ticker", h.ticker)
            .eq("type", "price_move")
            .gte("created_at", `${today}T00:00:00`)
            .lt("created_at", `${today}T23:59:59`)
            .limit(1);

          if (existing && existing.length > 0) continue;

          const { error: iErr } = await supabase.from("notifications").insert({
            user_id: userId,
            type: "price_move",
            title,
            body,
            ticker: h.ticker,
          });

          if (!iErr) totalCreated++;
        }

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 200));
      }

      // --- 2. Insider transactions in last 24h ---
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: insiderTxns, error: itErr } = await supabase
        .from("insider_transactions")
        .select("*")
        .in("ticker", tickers)
        .gte("created_at", yesterday);

      if (!itErr && insiderTxns && insiderTxns.length > 0) {
        for (const txn of insiderTxns) {
          const stockName = tickerNameMap[txn.ticker] || txn.ticker;
          const action = txn.transaction_type || "transaction";
          const title = `Insider ${action} in ${stockName}`;
          const person = txn.insider_name || "An insider";
          const body = `${person} reported a ${action} of ${stockName} (${txn.ticker}).`;

          // Skip if notification already exists for same user+ticker+type+date
          const { data: existing } = await supabase
            .from("notifications")
            .select("id")
            .eq("user_id", userId)
            .eq("ticker", txn.ticker)
            .eq("type", "insider")
            .gte("created_at", `${today}T00:00:00`)
            .lt("created_at", `${today}T23:59:59`)
            .limit(1);

          if (existing && existing.length > 0) continue;

          const { error: iErr } = await supabase.from("notifications").insert({
            user_id: userId,
            type: "insider",
            title,
            body,
            ticker: txn.ticker,
          });

          if (!iErr) totalCreated++;
        }
      }

      results.push({ userId: userId.slice(0, 8) + "...", tickers: tickers.length });
    }

    res.json({
      message: "Notifications generated",
      date: today,
      users: uniqueUserIds.length,
      notifications_created: totalCreated,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
