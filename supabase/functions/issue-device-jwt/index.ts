// Supabase Edge Function: issue-device-jwt
// Purpose: Issue a device-scoped JWT (HS256) signed with project JWT secret.
// Requirements:
//   supabase secrets set SERVICE_ROLE_KEY="<service-role key>" JWT_SECRET="<project jwt secret>" SUPABASE_URL="https://<ref>.supabase.co"
// Behavior:
//   - Authenticated caller invokes with { device_id }
//   - Server validates the caller owns the device (devices.user_id == caller.sub)
//   - Returns { jwt } containing claim device_id and role="authenticated"

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { create, Header } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !JWT_SECRET) {
  console.error("[issue-device-jwt] Missing env: SUPABASE_URL / SERVICE_ROLE_KEY / JWT_SECRET");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function decodeJwtWithoutVerify(token: string): any | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(payloadB64), c => c.charCodeAt(0)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization,content-type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
      },
    });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    const callerToken = m[1];
    const callerPayload = decodeJwtWithoutVerify(callerToken);
    const callerUserId = callerPayload?.sub as string | undefined;
    if (!callerUserId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const body = await req.json().catch(() => ({}));
    const device_id = (body?.device_id || "").trim();
    if (!device_id) {
      return new Response(JSON.stringify({ error: "device_id required" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    // Validate ownership: devices.user_id must equal callerUserId
    const { data, error } = await supabase.from("devices").select("user_id").eq("device_id", device_id).limit(1);
    if (error) {
      console.error("[issue-device-jwt] DB error:", error.message);
      return new Response(JSON.stringify({ error: "Database error" }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    const ownerUserId = data?.[0]?.user_id as string | undefined;
    if (!ownerUserId || ownerUserId !== callerUserId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    // Build device-scoped JWT
    const header: Header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: `${SUPABASE_URL}/auth/v1`,
      aud: "authenticated",
      sub: device_id,
      role: "authenticated",
      device_id,
      iat: now,
      exp: now + 60 * 60 * 24 * 90, // 90 days
    } as Record<string, unknown>;

    const jwt = await create(header, payload, JWT_SECRET);
    return new Response(JSON.stringify({ jwt }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
});