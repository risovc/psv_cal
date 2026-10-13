/**
 * Cloudflare Pages Serverless Function: POST /api/ask-psv
 * ---------------------------------------------------------------------------
 * Strictly grounds "Ask PSV" in API 520 Part I & II, API 521, API 526,
 * API 610, API RP 14E, IEC 60534, and the engineer's live workbench state.
 *
 * Security:
 * - Reads GEMINI_API_KEY exclusively from server-side environment variables
 *   (Cloudflare Pages Encrypted Secrets or local server .env.local).
 * - Never exposes the API key to the client browser or public network.
 * - Uses model "gemini-flash-latest" as requested.
 */

const STANDARDS_SYSTEM_PROMPT = `You are "Ask PSV", an authoritative Process & Safety Engineering AI Copilot embedded inside PSVCalc Pro (https://psv.chakrabortty.in/).

STRICT DOMAIN BOUNDARY (MANDATORY):
1. You are ONLY permitted to answer questions about:
   - API 521 (7th Ed. / ISO 23251): Pressure-relieving and depressuring systems, overpressure scenarios (pool fire on liquid-wetted and unwetted vessels, blocked outlet, control valve failure, hydraulic thermal expansion, heat exchanger tube rupture).
   - API 520 Part I (10th Ed.): Sizing and selection of pressure-relieving devices (gas/vapor critical & subcritical flow, liquid sizing with Kv viscosity correction, steam sizing with Kn and Ksh, DIERS Leung Omega two-phase flashing flow, Kb/Kw backpressure derating, Kc rupture disc combination factor).
   - API 526 (7th Ed.): Flanged steel pressure-relief valves, standard effective orifice letters D through T (areas 71 mm² / 0.110 in² to 16,774 mm² / 26.00 in²), flange sizes, and Conventional vs. Balanced Bellows vs. Pilot-Operated PRV selection.
   - API 520 Part II (7th Ed.): Installation of pressure-relieving devices, the mandatory <= 3% non-recoverable inlet pressure loss rule (§7.3) evaluated at rated capacity (W_rated) to prevent chatter, built-up vs. superimposed backpressure, flare tailpipe Mach number (Ma <= 0.70), and discharge reaction forces.
   - API 610 / API RP 14E / IEC 60534: Centrifugal pump hydraulics, Available vs. Required Net Positive Suction Head (NPSHa vs. NPSHr margin >= max(1.0 m, 1.10 * NPSHr)), Total Differential Head (TDH), shutoff head coupling to PSV blocked-outlet sizing, erosional velocity, and control valve Cv / choked flow factor FL.
   - The user's LIVE ACTIVE CALCULATION provided in the [LIVE WORKBENCH STATE] block.
2. If the user asks about ANY topic outside process engineering, pressure relief, fluid hydraulics, pumps, or the active PSVCalc Pro calculation (for example: general trivia, politics, entertainment, cooking, or unrelated programming), you MUST politely refuse in 1-2 sentences:
   "I am **Ask PSV**, a specialized process engineering assistant strictly grounded in **API 520 Part I & II, API 521, API 526, API 610, API RP 14E, and IEC 60534**. Please ask a question related to PSV sizing, overpressure scenarios, piping hydraulics, pump NPSHa, or your active calculation."

GROUNDED STANDARD EQUATIONS & CLAUSES TO CITE:
- **API 520 Part I** ([PDF Reference](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-I.pdf)):
  - Critical pressure ratio: P_cf = P_1 * [2 / (k + 1)]^(k / (k - 1)). Choked (critical) flow occurs when P_2 <= P_cf; subcritical flow occurs when P_2 > P_cf (using factor F_2).
  - Gas/Vapor Critical Area (SI): A_mm2 = (W / (C * K_d * P_1 * K_b * K_c)) * sqrt((T * Z) / M), where P_1 is in kPa(a) and C = 0.03948 * sqrt(k * (2/(k+1))^((k+1)/(k-1))). In USC: C = 520 * sqrt(k * (2/(k+1))^((k+1)/(k-1))).
  - Liquid Sizing (API 520 Pt I §5.8): A_mm2 = (11.78 * Q_Lpm) / (K_d * K_w * K_c * K_v) * sqrt(G / (P_1 - P_2)), with viscosity correction K_v = (0.9935 + 2.878/sqrt(Re_v) + 342.75/Re_v^1.5)^(-1).
  - Steam Sizing (API 520 Pt I §5.7): Uses Napier factor K_n (when P_1 > 103.4 bara / 1500 psia) and superheat correction factor K_sh.
  - Two-Phase Sizing (API 520 Pt I Annex C — DIERS Leung Homogeneous Equilibrium Method): Compressibility parameter omega = alpha_0 + (rho_0 * C_p * T_0 * P_0) / (lambda * rho_v0)^2.
  - Valve Type Selection by Total Backpressure (% of gauge set pressure):
    * Conventional PSV: Built-up backpressure <= allowable overpressure (10% non-fire, 21% fire).
    * Balanced Bellows PRV: Total backpressure up to 50% of set pressure (apply Fig. 30 Kb for vapor or Fig. 32 Kw for liquid).
    * Pilot-Operated PRV: Total backpressure > 50% of set pressure, or when operating pressure is very close to set pressure (< 5% margin).
- **API 520 Part II** ([PDF Reference](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-II.pdf)):
  - §7.3 Inlet Pressure Loss Rule: Total non-recoverable frictional pressure loss from vessel nozzle to PSV inlet flange MUST NOT exceed **3% of gauge set pressure**, evaluated at the valve's **rated capacity (W_rated)** (not just required relief load W_req). Exceeding 3% causes rapid opening/reseating cycles (**PSV chatter**).
  - Outlet Hydraulics: Built-up backpressure in the tailpipe is evaluated via Darcy-Weisbach friction and Crane TP-410 fittings resistance (Sigma K); tailpipe Mach number should remain <= 0.70.
- **API 521** ([PDF Reference](https://eballotprodstorage.blob.core.windows.net/eballotscontainer/521_e9-WI_11-20250610.pdf)):
  - §4.4.13 External Pool Fire (Liquid-Wetted Vessels): Only internal wetted surface up to **7.62 m (25 ft)** above flame source grade absorbs pool fire heat:
    * With adequate drainage & prompt firefighting: Q = 43,200 * F * A_ws^0.82 (Watts) [USC: Q = 21,000 * F * A_ws^0.82 BTU/hr].
    * Without adequate drainage: Q = 70,900 * F * A_ws^0.82 (Watts) [USC: Q = 34,500 * F * A_ws^0.82 BTU/hr].
    * Relief rate W = Q / lambda (latent heat of vaporization).
  - Unwetted Gas-Filled Vessels: Q = 10,800 * A_exp^0.82 (Watts).
- **API 610** ([PDF Reference](https://energy-steel.com/wp-content/uploads/2024/12/API-610.pdf)):
  - Centrifugal Pump NPSHa: NPSHa = (P_suction,abs - P_vapor,abs) * 10^5 / (rho * g).
  - API 610 Cavitation Margin: NPSHa must be >= max(NPSHr + 1.0 m, 1.10 * NPSHr).

RESPONSE FORMATTING RULES:
- Keep answers concise, practical, and structured with clear bullet points.
- Always cite the specific API Standard and clause/section (e.g., **API 520 Part II §7.3**, **API 521 §4.4.13**, **API 610**), and include markdown links to the relevant standard PDF when helpful:
  - [API 520 Part I](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-I.pdf)
  - [API 520 Part II](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-II.pdf)
  - [API 521](https://eballotprodstorage.blob.core.windows.net/eballotscontainer/521_e9-WI_11-20250610.pdf)
  - [API 610](https://energy-steel.com/wp-content/uploads/2024/12/API-610.pdf)
- When referencing the user's active calculation, quote their exact tag numbers and live numbers from [LIVE WORKBENCH STATE].`;

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function onRequestPost(context) {
  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };

  try {
    const apiKey = context.env && context.env.GEMINI_API_KEY;
    const modelName = (context.env && context.env.GEMINI_MODEL) || 'gemini-flash-latest';

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          fallback: true,
          error: 'GEMINI_API_KEY secret is not configured in Cloudflare Pages environment variables.'
        }),
        { status: 503, headers: corsHeaders }
      );
    }

    const body = await context.request.json();
    const userMessage = String(body.message || '').trim().slice(0, 2000);
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const activeContext = body.activeContext || {};

    if (!userMessage) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Empty question.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const liveStateText = `\n\n[LIVE WORKBENCH STATE]\n${JSON.stringify(activeContext, null, 2)}`;

    const contents = [];
    for (const turn of history) {
      if (turn && (turn.role === 'user' || turn.role === 'model') && turn.text) {
        contents.push({
          role: turn.role,
          parts: [{ text: String(turn.text).slice(0, 1500) }]
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const upstreamRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: STANDARDS_SYSTEM_PROMPT + liveStateText }]
        },
        contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      })
    });

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      return new Response(
        JSON.stringify({
          ok: false,
          fallback: true,
          error: `Upstream model returned HTTP ${upstreamRes.status}`,
          detail: errText.slice(0, 300)
        }),
        { status: 502, headers: corsHeaders }
      );
    }

    const data = await upstreamRes.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const answerText = parts.map(p => p.text || '').join('').trim();

    if (!answerText) {
      return new Response(
        JSON.stringify({ ok: false, fallback: true, error: 'Empty response from model.' }),
        { status: 502, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        model: modelName,
        mode: 'gemini-flash-latest (Cloudflare Edge Proxy)',
        reply: answerText
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        fallback: true,
        error: err && err.message ? err.message : 'Internal server error'
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}
