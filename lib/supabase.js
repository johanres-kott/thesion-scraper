import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing env vars:", {
    SUPABASE_URL: SUPABASE_URL ? "set" : "MISSING",
    SUPABASE_SERVICE_KEY: SUPABASE_SERVICE_KEY ? "set" : "MISSING",
  });
}

export const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;
