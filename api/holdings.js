// GET /api/holdings — returns investment company holdings
// Query params:
//   ?company=investor  — filter by company
//   (no params)        — return all companies

import { supabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { company } = req.query;

  let query = supabase
    .from("investment_holdings")
    .select("*")
    .order("weight", { ascending: false });

  if (company) {
    query = query.eq("company_id", company);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Group by company
  const grouped = {};
  for (const row of data) {
    if (!grouped[row.company_id]) {
      grouped[row.company_id] = {
        id: row.company_id,
        name: row.company_name,
        lastUpdated: row.scraped_at?.split("T")[0],
        holdings: [],
      };
    }
    grouped[row.company_id].holdings.push({
      name: row.holding_name,
      ticker: row.ticker,
      weight: row.weight,
      valueMSEK: row.value_msek,
    });
  }

  return res.json(Object.values(grouped));
}
