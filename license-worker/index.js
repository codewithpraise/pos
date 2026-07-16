// license-worker/index.js
// Cloudflare Worker script for Valenixia POS license check

async function generateJWT(payload, secretKey) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=+$/, "");
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=+$/, "");

  // Minimal standard crypto signature
  const rawSignature = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    rawSignature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const encodedSignature = btoa(String.fromCharCode.apply(null, signatureArray))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

async function verifyJWT(token, secretKey) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [header, payload, signature] = parts;

    const rawSignature = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secretKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const expectedBuffer = await crypto.subtle.sign(
      "HMAC",
      rawSignature,
      new TextEncoder().encode(`${header}.${payload}`)
    );
    const expectedArray = Array.from(new Uint8Array(expectedBuffer));
    const encodedExpected = btoa(String.fromCharCode.apply(null, expectedArray))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    if (signature !== encodedExpected) return false;

    // Decode payload
    const decodedPayload = JSON.parse(atob(payload));
    if (decodedPayload.expiresAt && decodedPayload.expiresAt < Date.now()) {
      return false; // Expired
    }
    return decodedPayload;
  } catch (e) {
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === "/api/license/activate" && request.method === "POST") {
        const body = await request.json();
        const { licenseKey, nodeId } = body;

        if (!licenseKey || !nodeId) {
          return new Response(JSON.stringify({ error: "licenseKey and nodeId are required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Simulating validation of license keys.
        // Key format: VALENIXIA-XXXX-XXXX-XXXX
        const keyPattern = /^VALENIXIA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
        if (!keyPattern.test(licenseKey)) {
          return new Response(JSON.stringify({ error: "Invalid license key format." }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Hardcoded simulation for allowed/valid keys list:
        // e.g. VALENIXIA-TRAL-1234-5678, VALENIXIA-PROD-ABCD-EFGH, VALENIXIA-ENTP-9999-8888
        let tier = "TRIAL";
        let duration = 7 * 24 * 60 * 60 * 1000; // 7 days trial

        if (licenseKey.includes("PRO")) {
          tier = "PRO";
          duration = 365 * 24 * 60 * 60 * 1000; // 1 year PRO
        } else if (licenseKey.includes("ENT")) {
          tier = "ENTERPRISE";
          duration = 10 * 365 * 24 * 60 * 60 * 1000; // 10 years Enterprise
        }

        const now = Date.now();
        const expiresAt = now + duration;

        const jwtPayload = {
          licenseKey,
          nodeId,
          tier,
          expiresAt,
          activatedAt: now
        };

        const token = await generateJWT(jwtPayload, env.JWT_SECRET || "valenixia_jwt_secret_signature_key");

        return new Response(JSON.stringify({ success: true, token, expiresAt, tier }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (path === "/api/license/verify" && request.method === "POST") {
        const body = await request.json();
        const { token, nodeId } = body;

        if (!token || !nodeId) {
          return new Response(JSON.stringify({ error: "token and nodeId are required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const payload = await verifyJWT(token, env.JWT_SECRET || "valenixia_jwt_secret_signature_key");
        if (!payload) {
          return new Response(JSON.stringify({ error: "Invalid or expired license token." }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (payload.nodeId !== nodeId) {
          return new Response(JSON.stringify({ error: "License is locked to a different device fingerprint." }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ success: true, payload }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response("Not Found", { status: 404 });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
}
