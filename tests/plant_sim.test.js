/**
 * Unit Verification Suite — Step 8 Plant Simulation Engine (plant-sim.js)
 * Verifies:
 *   1. Mass balance closure across V-1001 Separator + C-1001 Contactor + PSV/Flare (< 1e-6)
 *   2. Peng-Robinson k_ij sweep physics (phase split beta, oil dropout, rho_L, droplet d32 & v_t)
 *   3. Product specification transitions (Sales Gas ON-SPEC vs OFF-SPEC, Oil Light-Ends RVP spec)
 *   4. Multi-stage contactor tray profile (N = 6..20 trays, monotonic pressure & H2S/CO2 absorption)
 *   5. Normal vs Overpressure Relief mode (PSV lift, S-07/S-08 relief flow, mass balance preserved)
 *   6. Compatibility with all 5 EPC reference tags in engine.js
 */
'use strict';

const E = require('../engine.js');
const FP = require('../tools/fluid-props.js');
const PS = require('../plant-sim.js');

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? '  — ' + detail : ''}`);
  }
}

// 1. Baseline typical k_ij simulation on default PSV-1001A
const base = PS.simulatePlant({ sim: PS.defaultSimControls() });
check(
  'Baseline simulation succeeds and closes overall plant mass balance < 1e-6',
  base.ok && base.massBalance.relError < 1e-6,
  `In=${base.massBalance.massInKgHr} kg/h, Out=${base.massBalance.massOutKgHr} kg/h, relErr=${base.massBalance.relError.toExponential(2)}`
);

check(
  'Baseline has 7 units and 8 streams (S-01..S-08) with finite telemetry',
  Object.keys(base.units).length === 7 &&
    base.streams.length === 8 &&
    base.streams.every(s => Number.isFinite(s.massFlowKgHr) && Number.isFinite(s.tempC) && Number.isFinite(s.pressureBarg)),
  `units=${Object.keys(base.units).join(',')}, streams=${base.streams.map(s => s.id).join(',')}`
);

check(
  'Baseline GPA/DECHEMA typical k_ij meets both Sales Gas & Oil stabilization specs',
  base.specs.salesGasOnSpec === true && base.specs.oilOnSpec === true && base.specs.allOnSpec === true,
  `H2S=${base.specs.h2sPpmv.value} ppmv, CO2=${base.specs.co2MolPct.value}%, C5+=${base.specs.c5PlusPpmv.value} ppmv, Oil C1+C2=${base.specs.oilStabilization.value}%`
);

// 2. Sweep k_ij(C1-C5+) from negative (-0.085) -> typical (0.045) -> high (0.22)
const lowKij = PS.simulatePlant({ sim: { ...PS.KIJ_PRESETS.retrograde, trayCount: 12, lvRatio: 0.78 } });
const highKij = PS.simulatePlant({ sim: { ...PS.KIJ_PRESETS.high, trayCount: 12, lvRatio: 0.78 } });

check(
  'PR EOS k_ij(C1-Heavy) sweep monotonically increases vapour fraction beta and reduces swollen oil fraction',
  lowKij.eos.beta < base.eos.beta && base.eos.beta < highKij.eos.beta &&
    lowKij.droplets.sepOilKgHr > base.droplets.sepOilKgHr && base.droplets.sepOilKgHr > highKij.droplets.sepOilKgHr,
  `beta: ${lowKij.eos.beta} -> ${base.eos.beta} -> ${highKij.eos.beta}; Oil: ${lowKij.droplets.sepOilKgHr} -> ${base.droplets.sepOilKgHr} -> ${highKij.droplets.sepOilKgHr} kg/h`
);

check(
  'PR EOS k_ij sweep shifts liquid density rho_L, droplet diameter d32, and settling velocity v_t',
  lowKij.eos.liqRho < base.eos.liqRho && base.eos.liqRho < highKij.eos.liqRho &&
    lowKij.droplets.d32Um < highKij.droplets.d32Um &&
    lowKij.droplets.vtMS < highKij.droplets.vtMS,
  `rhoL: ${lowKij.eos.liqRho} -> ${highKij.eos.liqRho} kg/m3; d32: ${lowKij.droplets.d32Um} -> ${highKij.droplets.d32Um} um; vt: ${lowKij.droplets.vtMS} -> ${highKij.droplets.vtMS} m/s`
);

check(
  'Negative k_ij triggers OFF-SPEC Oil Stabilization (excess dissolved C1+C2 / RVP)',
  lowKij.specs.oilOnSpec === false && base.specs.oilOnSpec === true,
  `lowKij C1+C2=${lowKij.specs.oilStabilization.value}% (RVP=${lowKij.specs.oilStabilization.rvpBara} bar) vs base=${base.specs.oilStabilization.value}%`
);

check(
  'High k_ij triggers OFF-SPEC Sales Gas (reduced contactor absorption / heavy carryover)',
  highKij.specs.salesGasOnSpec === false && base.specs.salesGasOnSpec === true,
  `highKij H2S=${highKij.specs.h2sPpmv.value} ppmv, CO2=${highKij.specs.co2MolPct.value}%, C5+=${highKij.specs.c5PlusPpmv.value} ppmv`
);

// 3. Contactor tray count & monotonic profile verification
const trays6 = PS.simulatePlant({ sim: { ...PS.defaultSimControls(), trayCount: 6 } });
const trays18 = PS.simulatePlant({ sim: { ...PS.defaultSimControls(), trayCount: 18 } });

check(
  'Contactor generates exact stage profile for N=6, N=12, and N=18 trays, with higher removal at N=18',
  trays6.contactor.trays.length === 6 &&
    base.contactor.trays.length === 12 &&
    trays18.contactor.trays.length === 18 &&
    trays18.specs.h2sPpmv.value < trays6.specs.h2sPpmv.value &&
    trays18.specs.co2MolPct.value < trays6.specs.co2MolPct.value,
  `H2S @ 6 trays=${trays6.specs.h2sPpmv.value} ppmv vs 18 trays=${trays18.specs.h2sPpmv.value} ppmv`
);

const pMonotonic = base.contactor.trays.every((tr, idx, arr) => idx === 0 || tr.pressureBara >= arr[idx - 1].pressureBara - 1e-6);
const h2sMonotonic = base.contactor.trays.every((tr, idx, arr) => idx === 0 || tr.yH2SPpmv >= arr[idx - 1].yH2SPpmv - 1e-6);
check(
  'Contactor stage pressure and H2S gas mole fraction increase monotonically from Tray 1 (top) to Tray N (bottom)',
  pMonotonic && h2sMonotonic,
  `Top Tray 1: ${base.contactor.trays[0].pressureBarg} barg / ${base.contactor.trays[0].yH2SPpmv} ppmv -> Bottom Tray 12: ${base.contactor.trays[11].pressureBarg} barg / ${base.contactor.trays[11].yH2SPpmv} ppmv`
);

// 4. Relief simulation mode (PSV Pop)
const relief = PS.simulatePlant({ sim: { ...PS.defaultSimControls(), operatingMode: 'relief' } });
check(
  'Overpressure Relief mode lifts PSV, routes relief flow through S-07/S-08 to V-5001, and preserves mass balance',
  base.streamMap['S-07'].massFlowKgHr === 0 &&
    relief.streamMap['S-07'].massFlowKgHr > 1000 &&
    relief.streamMap['S-08'].massFlowKgHr === relief.streamMap['S-07'].massFlowKgHr &&
    relief.conditions.activePressBarg > base.conditions.setBarg &&
    relief.massBalance.relError < 1e-6,
  `P_rel=${relief.conditions.activePressBarg} barg > P_set=${base.conditions.setBarg} barg, W_rel=${relief.streamMap['S-07'].massFlowKgHr} kg/h`
);

// 5. All 5 EPC Tag Presets + Step 7 Fluid Presets run cleanly with zero NaN
const allPresetsOk = E.EPC_TAG_PRESETS.every(tag => {
  const r = PS.simulatePlant({ tag, fluidState: FP.presets[0].state });
  return r.ok && r.massBalance.relError < 1e-6 && Number.isFinite(r.step2Patch.mw) && Number.isFinite(r.step2Patch.z);
});
check('All 5 EPC Reference PSV Tags simulate cleanly with finite Step 2 EOS patch values', allPresetsOk);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
