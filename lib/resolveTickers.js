// Resolve company names to stock tickers via Finnhub
const FINNHUB_KEY = process.env.FINNHUB_KEY;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function resolveTicker(companyName) {
  if (!FINNHUB_KEY) throw new Error("FINNHUB_KEY not set");

  const res = await fetch(
    `https://finnhub.io/api/v1/search?q=${encodeURIComponent(companyName)}&token=${FINNHUB_KEY}`
  );
  const data = await res.json();
  if (data.error) return null;

  const results = (data.result || []).filter(
    (r) => r.type === "Common Stock" || r.type === "EQS"
  );

  // Prefer Stockholm (.ST), then Helsinki (.HE), then first result
  const stMatch = results.find((r) => r.symbol.endsWith(".ST"));
  if (stMatch) return stMatch.symbol.replace(/ /g, "-");

  const heMatch = results.find((r) => r.symbol.endsWith(".HE"));
  if (heMatch) return heMatch.symbol.replace(/ /g, "-");

  if (results.length > 0) return results[0].symbol.replace(/ /g, "-");
  return null;
}

export async function resolveAllTickers(holdings) {
  const resolved = [];
  for (const h of holdings) {
    const ticker = await resolveTicker(h.name);
    resolved.push({ ...h, ticker });
    await delay(150); // Respect Finnhub rate limits
  }
  return resolved;
}
