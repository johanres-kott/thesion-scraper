// Scraper for Investor AB (investorab.com)
// Data is embedded as JSON in window.__INITIAL_PROPS

const URL = "https://www.investorab.com/our-companies/listed-companies/";

export async function scrapeInvestor() {
  const res = await fetch(URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ThesionBot/1.0)" },
  });
  const html = await res.text();

  // Extract JSON data from __INITIAL_PROPS
  const match = html.match(/window\.__INITIAL_PROPS\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!match) throw new Error("Could not find __INITIAL_PROPS on Investor page");

  const props = JSON.parse(match[1]);

  // Find the listed companies data — it's in one of the data entries
  const holdings = [];
  for (const [, value] of Object.entries(props.data || {})) {
    const items = value?.data?.items || value?.items || [];
    for (const item of items) {
      if (item.title && item.percentage != null) {
        holdings.push({
          name: item.title,
          weight: Math.round(item.percentage * 100 * 10) / 10, // 0.16 → 16
          valueMSEK: null, // Investor doesn't publish exact values on this page
        });
      }
    }
  }

  // Also try tabs structure
  if (holdings.length === 0) {
    for (const [, value] of Object.entries(props.data || {})) {
      const tabs = value?.data?.tabs || value?.tabs || [];
      for (const tab of tabs) {
        const children = tab?.children || [];
        for (const child of children) {
          if (child.title && child.percentage != null) {
            holdings.push({
              name: child.title,
              weight: Math.round(child.percentage * 100 * 10) / 10,
              valueMSEK: null,
            });
          }
        }
      }
    }
  }

  if (holdings.length === 0) {
    throw new Error("Could not extract holdings from Investor page");
  }

  return {
    companyId: "investor",
    companyName: "Investor",
    url: URL,
    scrapedAt: new Date().toISOString(),
    holdings: holdings.filter(h => h.weight > 0).sort((a, b) => b.weight - a.weight),
  };
}
