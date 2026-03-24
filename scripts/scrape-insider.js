// Run locally: node scripts/scrape-insider.js
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { scrapeInsiderTransactions, tickerToFIName } from "../lib/scrapeFI.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function run() {
  console.log("Fetching watchlist tickers...");
  const { data: watchlist } = await supabase.from("watchlist").select("ticker, name").not("ticker", "is", null);

  const seen = new Set();
  const tickers = (watchlist || []).filter(w => {
    if (!w.ticker.toUpperCase().endsWith(".ST")) return false;
    if (seen.has(w.ticker.toUpperCase())) return false;
    seen.add(w.ticker.toUpperCase());
    return true;
  });

  console.log(`Found ${tickers.length} Swedish tickers to scrape`);

  let totalInserted = 0;

  for (const item of tickers) {
    try {
      const fiName = await tickerToFIName(item.ticker);
      console.log(`Scraping ${item.ticker} (FI name: ${fiName})...`);

      const transactions = await scrapeInsiderTransactions(fiName, 12);
      console.log(`  → ${transactions.length} transactions found`);

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

        const { data: inserted, error } = await supabase
          .from("insider_transactions")
          .upsert(rows, { onConflict: "ticker,person_name,transaction_date,transaction_type,volume", ignoreDuplicates: true })
          .select();

        if (error) {
          console.log(`  ⚠ Error: ${error.message}`);
        } else {
          console.log(`  ✓ Inserted ${inserted?.length || 0} rows`);
          totalInserted += inserted?.length || 0;
        }
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.log(`  ✗ Error for ${item.ticker}: ${err.message}`);
    }
  }

  console.log(`\nDone! Total inserted: ${totalInserted}`);
}

run().catch(console.error);
