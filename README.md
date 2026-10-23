# PSVCalc Pro — Process Pressure Relief, Pump Hydraulics & Sizing Workbench (API 521 / 520 / 526 / 610 / 14E)

A zero-backend, 100% static web application built for Chemical & Process Engineers to automate end-to-end Pressure Safety Valve (PSV) calculations, Centrifugal Pump & Process Line Hydraulics ("HYTOS" module), and Instrument / Equipment Process Datasheets (IPDS).

## Demo
[psv.chakrabortty.in](https://psv.chakrabortty.in)

## Engineering Standards Covered
1. **API 521 (8th Ed.) — Overpressure & Relief Load Scenarios ("From Base")**
   - **1A. External Fire — Liquid-Wetted Vessel (§4.4.13.2.4)**: Automatic wetted surface area ($A_{ws}$) geometry calculator up to $7.62\text{ m}$ ($25\text{ ft}$) above fire grade for Horizontal, Vertical, and Spherical vessels; adequate vs. inadequate drainage ($Q = 43{,}200 \cdot F \cdot A_{ws}^{0.82}$ or $70{,}900 \cdot F \cdot A_{ws}^{0.82}$); latent heat vaporization relief rate ($W = Q/\lambda$).
   - **1B. External Fire — Unwetted / Gas-Filled Vessel (§4.4.13.2.7)**: Vapor expansion relief load.
   - **1C. Blocked Outlet (§4.4.2)**: Maximum upstream pump, compressor, or header inflow minus credited outflows.
   - **1D. Control Valve Failure (§4.4.8)**: Full fail-open $C_v$ capacity (plus bypass) per IEC 60534-2-1 / ISA-75.01 for Gas/Vapor or Liquid minus normal flow credit.
   - **1E. Thermal / Hydraulic Expansion (§4.4.12)**: Trapped liquid thermal expansion from solar radiation or exchanger blocked-in heat duty.
   - **1F. Heat Exchanger Tube Rupture (§4.4.14)**: Double-ended guillotine tube break ($2 \times A_{\text{tube}}$, $C_d = 0.70$) for HP liquid or gas into LP shell/tube side.
2. **API 520 Part I (10th Ed.) & API 526 (7th Ed.) — Orifice Sizing & Selection**
   - **Gas / Vapor**: Critical ($P_2 \le P_{cf}$) and Subcritical ($P_2 > P_{cf}$ with $F_2$) sizing.
   - **Liquid**: Iterative Reynolds number ($Re$) and viscosity correction factor ($K_v$) sizing.
   - **Steam**: Napier equation with high-pressure factor ($K_n$) and superheat factor ($K_{sh}$).
   - **Two-Phase / Flashing**: Leung Omega ($\omega$) method per API 520 Part I Annex C.
   - **API 526 Standard Orifice Selection**: Full `D` through `T` orifice selection, flange ratings, utilization %, and rated capacity ($W_{\text{rated}}$).
3. **API 520 Part II (7th Ed.) — PSV Inlet & Outlet Piping Hydraulics**
   - **Inlet Line 3% Rule**: Evaluates Darcy-Weisbach friction loss (Churchill full-regime friction factor $f$) + fittings $\sum K_{\text{in}}$ against the $\Delta P_{\text{inlet}} \le 3\%$ of $P_{\text{set}}$ non-chatter criterion.
   - **Outlet Tailpipe Check**: Built-up + superimposed backpressure vs. valve limit (Conventional, Balanced Bellows, Pilot-Operated), exit Mach number ($Ma \le 0.70$), and discharge reaction force ($F_r$).
4. **API 610 (12th Ed.), API RP 14E & IEC 60534 — Centrifugal Pump & Line Hydraulics ("HYTOS" Module)**
   - **Suction Circuit & NPSHa**: Darcy-Weisbach suction line loss, strainer $\Delta P$, suction nozzle pressure, and Available NPSH ($\text{NPSH}_a$) vs. Vendor Required $\text{NPSH}_r$ cavitation check.
   - **Discharge Circuit & API 14E Erosional Velocity**: Discharge line friction, equipment $\Delta P$, erosional velocity limit ($v_e = C / \sqrt{\rho}$), and multi-NPS pipe sizing table.
   - **Control Valve Allocation & $C_v$ Envelope**: Allocates $\Delta P_{\text{CV}} = \max(\Delta P_{\text{min}}, 30\%\text{ dynamic loss})$ and calculates required $C_v$ and % travel across Minimum, Normal, and Rated flows.
   - **TDH, Shutoff Pressure, Power & 1-Click PSV Coupling**: Total Differential Head (TDH), shutoff head & max discharge pressure, hydraulic/shaft power, API 610 Table 12 motor sizing margin (125% / 115% / 110%), interactive H–Q pump vs. system curve, printable Centrifugal Pump IPDS datasheet, and 1-click coupling to PSV Blocked-Outlet sizing.

## Project Structure
```
index.html        App layout (6-step workflow including Pump & Line Hydraulics)
styles.css        Design system, dark mode, print (A4 PSV & Pump IPDS) styles
engine.js         Calculation engine (API 521 / 520 / 526 / 610 / 14E) — pure functions, no DOM
app.js            UI controller, SVG diagrams, LocalStorage register, CSV/JSON export
_headers          Cloudflare Pages security & cache headers
tests/            Verification suites (not needed at runtime)
```

## Testing
```bash
node tests/verify_engine.js                       # 37 checks vs. USC-form API equations
python3 -m http.server 8085 &                      # serve locally
node tests/ui_e2e.js http://127.0.0.1:8085/index.html   # 49 headless-Chrome UI checks (Node ≥ 22, Chrome)
```

## Deploy: GitHub → Cloudflare Pages
1. Create an empty GitHub repo (e.g. `psvcalc-pro`), then from this folder:
   ```bash
   git init -b main
   git add .
   git commit -m "PSVCalc Pro initial release"
   git remote add origin https://github.com/<you>/psvcalc-pro.git
   git push -u origin main
   ```
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → select the repo.
3. Build settings: **Framework preset: None**, **Build command: (leave empty)**, **Build output directory: `/`**.
4. **Save and Deploy** → app is live at `https://<project>.pages.dev`. Every `git push` to `main` redeploys automatically; other branches get preview URLs.
5. Optional: **Custom domains** tab to attach your own domain; **Zero Trust → Access** to restrict to your team's emails.

Alternative without GitHub: Workers & Pages → Create → Pages → **Upload assets** → drag the unzipped folder.

## Offline Use
Unzip `psvcalc-pro-standalone.zip` and double-click `index.html` — works fully offline (fonts fall back to system fonts).

## Engineering Disclaimer
Bellows Kb/Kw curves and steam Ksh are generic approximations of API 520 figures/tables — use vendor-certified values for final design. Line hydraulics use Darcy-Weisbach with mean density (a warning is shown when compressibility makes this inaccurate). Reaction force is the open-discharge (atmospheric) case. Results must be checked by a qualified engineer.
