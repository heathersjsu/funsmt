// Supabase Edge Function: issue-device-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { create, Header } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization,content-type,x-client-info,apikey",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
      },
    });
  }

  try {
    console.log("[issue-device-jwt] Invoked");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !JWT_SECRET) {
      const missing = [];
      if (!SUPABASE_URL) missing.push("SUPABASE_URL");
      if (!SERVICE_ROLE_KEY) missing.push("SERVICE_ROLE_KEY");
      if (!JWT_SECRET) missing.push("JWT_SECRET");
      console.error("[issue-device-jwt] Missing env vars:", missing.join(", "));
      throw new Error(`Server configuration error: Missing env vars: ${missing.join(", ")}`);
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return new Response(JSON.stringify({ error: "Unauthorized: Missing Bearer token" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    const callerToken = m[1];
    
    // Simple manual decode to check caller
    function decodeJwt(token: string) {
      try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const json = new TextDecoder().decode(Uint8Array.from(atob(payloadB64), c => c.charCodeAt(0)));
        return JSON.parse(json);
      } catch { return null; }
    }

    const callerPayload = decodeJwt(callerToken);
    const callerUserId = callerPayload?.sub;
    if (!callerUserId) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid token payload" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const body = await req.json().catch(() => ({}));
    const device_id = (body?.device_id || "").trim();
    if (!device_id) {
      return new Response(JSON.stringify({ error: "device_id required" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Validate ownership: devices.user_id must equal callerUserId
    const { data, error } = await supabase.from("devices").select("user_id").eq("device_id", device_id).limit(1);
    if (error) {
      console.error("[issue-device-jwt] DB error:", error.message);
      throw new Error(`Database error: ${error.message}`);
    }
    const ownerUserId = data?.[0]?.user_id;
    
    // If device doesn't exist, maybe we should allow claiming it? 
    // But logic says: "Server validates the caller owns the device".
    // If pre-registration happened in app, it should exist.
    if (!ownerUserId) {
       console.error(`[issue-device-jwt] Device ${device_id} not found`);
       return new Response(JSON.stringify({ error: `Device ${device_id} not found` }), { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    if (ownerUserId !== callerUserId) {
      console.error(`[issue-device-jwt] Forbidden: owner=${ownerUserId}, caller=${callerUserId}`);
      return new Response(JSON.stringify({ error: "Forbidden: You do not own this device" }), { status: 403, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    // Build device-scoped JWT
    const header: Header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: `${SUPABASE_URL}/auth/v1`,
      aud: "authenticated",
      sub: crypto.randomUUID(), // Generate a random UUID for sub to prevent auth.uid() casting errors
      role: "authenticated",
      device_id,
      iat: now,
      exp: now + 60 * 60 * 24 * 365 * 10, // 10 years (long lived for hardware)
    };

    // Import key from string (djwt v3 requires CryptoKey)
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );

    const jwt = await create(header, payload, key);
    console.log(`[issue-device-jwt] Success for ${device_id}`);

    return new Response(JSON.stringify({ jwt }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (err: any) {
    console.error("[issue-device-jwt] Unexpected error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal Server Error", stack: err.stack }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});