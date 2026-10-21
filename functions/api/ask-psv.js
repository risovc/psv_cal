/**
 * Cloudflare Pages Serverless Function: POST /api/ask-psv
 * ---------------------------------------------------------------------------
 * Strictly grounds "Ask PSV" and the "P&ID Scenario Identifier" in API 520 Part I & II,
 * API 521, API 526, API 610, API RP 14E, IEC 60534, GPSA Ch. 7, ASME VIII Div. 1,
 * and the engineer's live workbench state or uploaded P&ID PDF / JSON / Image reference.
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
   - API 521 (7th Ed. / ISO 23251): Pressure-relieving and depressuring systems, P&ID overpressure scenario identification (pool fire on liquid-wetted and unwetted vessels, blocked outlet, control valve failure, abnormal heat input from reboilers/fired heaters, hydraulic thermal expansion, heat exchanger tube rupture).
   - API 520 Part I (10th Ed.): Sizing and selection of pressure-relieving devices (gas/vapor critical & subcritical flow, liquid sizing with Kv viscosity correction, steam sizing with Kn and Ksh, DIERS Leung Omega two-phase flashing flow, Kb/Kw backpressure derating, Kc rupture disc combination factor).
   - API 526 (7th Ed.): Flanged steel pressure-relief valves, standard effective orifice letters D through T (areas 71 mm² / 0.110 in² to 16,774 mm² / 26.00 in²), flange sizes, and Conventional vs. Balanced Bellows vs. Pilot-Operated PRV selection.
   - API 520 Part II (7th Ed.): Installation of pressure-relieving devices, the mandatory <= 3% non-recoverable inlet pressure loss rule (§7.3) evaluated at rated capacity (W_rated) to prevent chatter, built-up vs. superimposed backpressure, flare tailpipe Mach number (Ma <= 0.70), and discharge reaction forces.
   - API 610 / API RP 14E / IEC 60534: Centrifugal pump hydraulics, Available vs. Required Net Positive Suction Head (NPSHa vs. NPSHr margin >= max(1.0 m, 1.10 * NPSHr)), Total Differential Head (TDH), shutoff head coupling to PSV blocked-outlet sizing, erosional velocity, and control valve Cv / choked flow factor FL.
   - GPSA Engineering Data Book Ch. 7 / API 12J / API 521 §5.7.2 / ASME Section VIII Div. 1 (UG-27 & UG-32): Process & mechanical pressure vessel sizing from scratch (vertical/horizontal 2-phase KO/surge drums, flare KO drums, 3-phase gas/oil/water separators via Souders-Brown vapor disengagement and Stokes' Law settling, liquid holdup/surge level tables LLL/NLL/HLL/HHLL, nozzle sizing via rho*v^2 momentum criteria, and ASME VIII Div. 1 shell/head wall thickness, corroded MAWP, and empty/operating/hydrotest weights).
   - The user's LIVE ACTIVE CALCULATION provided in the [LIVE WORKBENCH STATE] block.
2. If the user asks about ANY topic outside process engineering, pressure relief, fluid hydraulics, pumps, vessels, or the active PSVCalc Pro calculation (for example: general trivia, politics, entertainment, cooking, or unrelated programming), you MUST politely refuse in 1-2 sentences:
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
  - §4.4.2 Blocked Outlet: Credible when an outlet block/control valve can close while upstream source pressure (P_source or pump shutoff) exceeds protected MAWP.
  - §4.4.5 / §4.4.6 Abnormal Heat Input (Reboiler / Fired Heater): Steam or hot-oil control valve fail-open or bypass opening generates boil-off vapor W = 3600 * Q_abnormal / lambda.
  - §4.4.8 Control Valve Failure (Fail-Open): Credible when upstream pressure P_up > MAWP; evaluate full fail-open Cv capacity (plus open bypass if not car-sealed) minus normal downstream flow credit.
  - §4.4.12 Hydraulic / Thermal Expansion: Trapped liquid heated by exchanger or solar radiation: W = (3600 * alpha_v * Q) / Cp.
  - §4.4.13 External Pool Fire (Liquid-Wetted Vessels): Only internal wetted surface up to **7.62 m (25 ft)** above flame source grade absorbs pool fire heat:
    * With adequate drainage & prompt firefighting: Q = 43,200 * F * A_ws^0.82 (Watts) [USC: Q = 21,000 * F * A_ws^0.82 BTU/hr].
    * Without adequate drainage: Q = 70,900 * F * A_ws^0.82 (Watts) [USC: Q = 34,500 * F * A_ws^0.82 BTU/hr].
    * Relief rate W = Q / lambda (latent heat of vaporization).
  - §4.4.14 Heat Exchanger Tube Rupture: Credible when HP side design pressure exceeds LP side corrected hydrotest pressure (1.3 * MAWP); evaluate double-ended guillotine tube break (2 * A_tube).
- **API 610** ([PDF Reference](https://energy-steel.com/wp-content/uploads/2024/12/API-610.pdf)):
  - Centrifugal Pump NPSHa: NPSHa = (P_suction,abs - P_vapor,abs) * 10^5 / (rho * g).
  - API 610 Cavitation Margin: NPSHa must be >= max(NPSHr + 1.0 m, 1.10 * NPSHr).

RESPONSE FORMATTING RULES:
- Keep answers concise, practical, and structured with clear bullet points.
- Do NOT use raw LaTeX dollar-sign syntax ($...$ or $$...$$ or \\text{...}). Write equations in clean plain text / Unicode (e.g., ΔP_inlet = 0.35 bar, P₁ = 24.75 bara, A_req = 1204 mm², √, ≤, ≥, ×).
- Always cite the specific API Standard and clause/section (e.g., **API 520 Part II §7.3**, **API 521 §4.4.13**, **API 610**), and include markdown links to the relevant standard PDF when helpful:
  - [API 520 Part I](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-I.pdf)
  - [API 520 Part II](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-II.pdf)
  - [API 521](https://eballotprodstorage.blob.core.windows.net/eballotscontainer/521_e9-WI_11-20250610.pdf)
  - [API 610](https://energy-steel.com/wp-content/uploads/2024/12/API-610.pdf)
- When referencing the user's active calculation, quote their exact tag numbers and live numbers from [LIVE WORKBENCH STATE].`;

const PID_SCENARIO_ID_PROMPT = `You are an expert Lead Process Safety Engineer performing an **API 521 §4 (Table 1) Overpressure Scenario Identification & P&ID System Analysis** for a Pressure Safety Valve (PSV).

Analyze the provided P&ID / Reference Document (PDF, image, JSON, or system topology description) and the current [P&ID SYSTEM TOPOLOGY STATE].
Identify:
1. Where pressure and energy are coming from (upstream headers, pumps/compressors shutoff head, letdown control valves, reboilers/steam coils/fired heaters, high-pressure exchanger tubes, and external pool fire envelope).
2. How each pressure/energy source compares against the protected equipment's MAWP / PSV Set Pressure (barg).
3. For each of the 7 API 521 scenarios below, determine whether it is CREDIBLE (true) or NOT CREDIBLE (false), state the exact P&ID tag / source path, give a concise engineering justification per API 521, and provide realistic quantitative parameters if the reference document specifies or implies them:
   - "blocked_outlet" (API 521 §4.4.2 — Blocked Outlet)
   - "cv_failure" (API 521 §4.4.8 — Control Valve Fail-Open / Bypass Opening)
   - "abnormal_heat" (API 521 §4.4.5 — Abnormal Heat Input from Reboiler / Steam / Fired Heater)
   - "fire_liquid" (API 521 §4.4.13.2.4 — External Fire on Liquid-Wetted Vessel)
   - "fire_gas" (API 521 §4.4.13.2.7 — External Fire on Unwetted Gas Vessel)
   - "tube_rupture" (API 521 §4.4.14 — Heat Exchanger Tube Rupture, HP > 1.3 * LP MAWP)
   - "thermal_expansion" (API 521 §4.4.12 — Hydraulic / Thermal Expansion of Trapped Liquid)

Return ONLY a valid JSON object matching this exact structure (no markdown code fences outside the JSON):
{
  "pidSummary": "2-3 sentence summary of the P&ID system boundary, protected equipment, MAWP, and upstream pressure/heat sources.",
  "governingRecommendation": "1-2 sentence statement of which scenario governs PSV orifice sizing and why.",
  "extractedTopology": {
    "pidNumber": "string (optional override if found in PDF/JSON)",
    "protectedTag": "string (optional override)",
    "protectedService": "string (optional override)",
    "operatingPressureBarg": "number (optional)",
    "mawpBarg": "number (optional)",
    "upstreamSource": {
      "sourceTag": "string",
      "maxSourcePressureBarg": "number",
      "maxInflowKgHr": "number",
      "outletBlockValvePresent": "boolean"
    },
    "controlValve": {
      "present": "boolean",
      "cvTag": "string",
      "upstreamPressureBarg": "number",
      "ratedCv": "number"
    },
    "abnormalHeat": {
      "present": "boolean",
      "heaterTag": "string",
      "normalDutyKw": "number",
      "abnormalSurgeFactor": "number"
    },
    "fireZone": {
      "inFireZone": "boolean",
      "liquidInventoryPresent": "boolean"
    },
    "exchanger": {
      "present": "boolean",
      "exchangerTag": "string",
      "hpSidePressureBarg": "number"
    }
  },
  "scenarios": [
    {
      "scenarioKey": "blocked_outlet | cv_failure | abnormal_heat | fire_liquid | fire_gas | tube_rupture | thermal_expansion",
      "credible": true,
      "sourceTag": "Tag / path on P&ID",
      "sourcePressureBarg": 45.0,
      "rationale": "Concise API 521 engineering justification comparing source pressure or heat input against MAWP."
    }
  ],
  "engineeringNotes": [
    "Key P&ID safeguard note (e.g., check valve credit, CSO/CSC valve requirements, double-block credit per API 521)"
  ]
}`;

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
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    // -----------------------------------------------------------------------
    // MODE A: P&ID & REFERENCE FILE OVERPRESSURE SCENARIO IDENTIFICATION
    // -----------------------------------------------------------------------
    if (body.mode === 'pid_scenario_id') {
      const pidSpec = body.pidSpec || {};
      const referenceText = String(body.referenceText || '').trim().slice(0, 12000);
      const attachment = body.fileAttachment || null;

      const userParts = [];
      if (attachment && attachment.base64Data && attachment.mimeType) {
        const allowedMime = /^(application\/pdf|image\/(png|jpeg|jpg|webp))$/i;
        if (allowedMime.test(attachment.mimeType)) {
          userParts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: String(attachment.base64Data)
            }
          });
        }
      }

      userParts.push({
        text: `[P&ID SYSTEM TOPOLOGY STATE]\n${JSON.stringify(pidSpec, null, 2)}\n\n` +
          (referenceText ? `[UPLOADED P&ID / REFERENCE DOCUMENT CONTENT OR NOTES]\n${referenceText}\n\n` : '') +
          `Perform a complete API 521 §4 Overpressure Scenario Identification for this P&ID system and return the structured JSON object.`
      });

      const upstreamRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: PID_SCENARIO_ID_PROMPT }]
          },
          contents: [{ role: 'user', parts: userParts }],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 1600,
            responseMimeType: 'application/json',
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
      const rawJsonText = parts.map(p => p.text || '').join('').trim();
      let parsedAnalysis = null;
      try {
        const cleaned = rawJsonText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        parsedAnalysis = JSON.parse(cleaned);
      } catch (_) {
        parsedAnalysis = {
          pidSummary: rawJsonText.slice(0, 600),
          governingRecommendation: 'Evaluated via Gemini Flash + API 521 §4 rules.',
          scenarios: [],
          engineeringNotes: []
        };
      }

      return new Response(
        JSON.stringify({
          ok: true,
          model: modelName,
          mode: 'pid_scenario_id',
          analysis: parsedAnalysis
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // -----------------------------------------------------------------------
    // MODE B: STANDARD "ASK PSV" CONVERSATIONAL COPILOT
    // -----------------------------------------------------------------------
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
