// Resolve company names to stock tickers via Finnhub, with manual fallback
const FINNHUB_KEY = process.env.FINNHUB_KEY;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Manual mappings for companies Finnhub can't find
const MANUAL_TICKERS = {
  "New Wave Group": "NEWA-B.ST",
  "Ependion": "EPEN.ST",
  "Beijer Alma": "BEIA-B.ST",
  "Scandic Hotels Group": "SHOT.ST",
  "Scandic Hotels": "SHOT.ST",
  "FM Mattsson Group": "FMMS.ST",
  "FM Mattsson": "FMMS.ST",
  "Systemair": "SYSR.ST",
  "Arjo": "ARJO-B.ST",
  "Troax Group": "TROAX.ST",
  "Troax": "TROAX.ST",
  "Platzer Fastigheter": "PLAZ-B.ST",
  "XANO Industri": "XANO-B.ST",
  "Elanders": "ELAN-B.ST",
  "ITAB Shop Concept": "ITAB.ST",
  "MilDef Group": "MILDEF.ST",
  "Arla Plast": "ARLA.ST",
  "GARO": "GARO.ST",
  "Boule Diagnostics": "BOUL.ST",
  "Wästbygg Gruppen": "WBGR-B.ST",
  // Lundbergs holdings
  "Holmen": "HOLM-B.ST",
  "Hufvudstaden": "HUFV-A.ST",
  "Indutrade": "INDT.ST",
  "Lundbergs Fastigheter": "LUND-B.ST",
  // Latour holdings
  "Alimak Group": "ALIG.ST",
  "ASSA ABLOY": "ASSA-B.ST",
  "Assa Abloy": "ASSA-B.ST",
  "CTEK": "CTEK.ST",
  "Fagerhult": "FAG.ST",
  "HMS Networks": "HMS.ST",
  "HMS": "HMS.ST",
  "Nederman": "NMAN.ST",
  "Sweco": "SWEC-B.ST",
  "TOMRA": "TOMRA.OL",
  "Tomra": "TOMRA.OL",
  // Creades
  "Klarna": "KLR",
};

export async function resolveTicker(companyName) {
  // Check manual mapping first
  if (MANUAL_TICKERS[companyName]) {
    return MANUAL_TICKERS[companyName];
  }

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
