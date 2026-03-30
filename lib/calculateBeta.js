// Calculate beta for a stock against a benchmark index
// Uses 5 years of weekly returns (260 data points)
// Beta = Cov(stock, market) / Var(market)

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

async function fetchWeeklyCloses(symbol, years = 5) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1wk&range=${years}y`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${symbol}`);
  const d = await res.json();
  const result = d.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);

  const closes = result.indicators?.quote?.[0]?.close || [];
  const timestamps = result.timestamp || [];

  // Filter out nulls, pair with dates
  const points = [];
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] != null) {
      points.push({ date: timestamps[i], close: closes[i] });
    }
  }
  return points;
}

function calculateReturns(points) {
  const returns = [];
  for (let i = 1; i < points.length; i++) {
    returns.push({
      date: points[i].date,
      ret: (points[i].close - points[i - 1].close) / points[i - 1].close,
    });
  }
  return returns;
}

function computeBeta(stockReturns, marketReturns) {
  // Align by date (both are weekly, should be close)
  const marketMap = new Map(marketReturns.map(r => [r.date, r.ret]));

  const paired = [];
  for (const sr of stockReturns) {
    // Find closest market date (within 3 days tolerance)
    let bestMatch = null;
    let bestDiff = Infinity;
    for (const [mDate, mRet] of marketMap) {
      const diff = Math.abs(sr.date - mDate);
      if (diff < bestDiff && diff < 3 * 86400) { // 3 days in seconds
        bestDiff = diff;
        bestMatch = mRet;
      }
    }
    if (bestMatch !== null) {
      paired.push({ stock: sr.ret, market: bestMatch });
    }
  }

  if (paired.length < 52) return null; // Need at least 1 year of data

  const n = paired.length;
  const meanS = paired.reduce((s, p) => s + p.stock, 0) / n;
  const meanM = paired.reduce((s, p) => s + p.market, 0) / n;

  let cov = 0;
  let varM = 0;
  for (const p of paired) {
    cov += (p.stock - meanS) * (p.market - meanM);
    varM += (p.market - meanM) ** 2;
  }
  cov /= n;
  varM /= n;

  if (varM === 0) return null;

  return {
    beta: Math.round((cov / varM) * 100) / 100, // Round to 2 decimals
    dataPoints: n,
  };
}

// Determine which benchmark to use based on ticker
function getBenchmark(ticker) {
  if (ticker.endsWith(".ST")) return { symbol: "^OMX", name: "OMXS30" };
  if (ticker.endsWith(".HE")) return { symbol: "^OMXH25", name: "OMXH25" };
  if (ticker.endsWith(".CO")) return { symbol: "^OMXC25", name: "OMXC25" };
  if (ticker.endsWith(".OL")) return { symbol: "^OSEAX", name: "OSEAX" };
  if (ticker.endsWith(".L")) return { symbol: "^FTSE", name: "FTSE100" };
  if (ticker.endsWith(".DE") || ticker.endsWith(".PA")) return { symbol: "^STOXX50E", name: "STOXX50" };
  if (ticker.endsWith(".T")) return { symbol: "^N225", name: "Nikkei225" };
  if (ticker.endsWith(".HK")) return { symbol: "^HSI", name: "HangSeng" };
  // Default: US stocks vs S&P 500
  return { symbol: "^GSPC", name: "SP500" };
}

// Cache benchmark data to avoid refetching for each stock
const benchmarkCache = new Map();

async function getBenchmarkReturns(benchmark) {
  if (benchmarkCache.has(benchmark.symbol)) {
    return benchmarkCache.get(benchmark.symbol);
  }
  const points = await fetchWeeklyCloses(benchmark.symbol);
  const returns = calculateReturns(points);
  benchmarkCache.set(benchmark.symbol, returns);
  return returns;
}

/**
 * Calculate beta for a single stock
 * @param {string} ticker - Stock ticker (e.g. "SEB-A.ST", "AAPL")
 * @returns {{ beta: number, index: string, dataPoints: number } | null}
 */
export async function calculateBetaForStock(ticker) {
  try {
    const benchmark = getBenchmark(ticker);
    const [stockPoints, marketReturns] = await Promise.all([
      fetchWeeklyCloses(ticker),
      getBenchmarkReturns(benchmark),
    ]);

    const stockReturns = calculateReturns(stockPoints);
    const result = computeBeta(stockReturns, marketReturns);

    if (!result) return null;

    return {
      beta: result.beta,
      index: benchmark.name,
      dataPoints: result.dataPoints,
    };
  } catch (err) {
    console.error(`Beta calculation failed for ${ticker}: ${err.message}`);
    return null;
  }
}

/**
 * Calculate beta for multiple stocks (with rate limiting)
 * @param {string[]} tickers
 * @param {function} onProgress - callback(current, total)
 */
export async function calculateBetaBatch(tickers, onProgress) {
  const results = {};

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    if (onProgress) onProgress(i + 1, tickers.length);

    results[ticker] = await calculateBetaForStock(ticker);

    // Rate limit: 500ms between requests to avoid Yahoo throttling
    if (i < tickers.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Clear benchmark cache after batch
  benchmarkCache.clear();

  return results;
}
