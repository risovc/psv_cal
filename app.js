/**
 * PSVCalc Pro — Interactive Engineering Workbench Controller
 * Connects API 521 Overpressure Scenarios, API 520 Part I Orifice Sizing,
 * API 520 Part II Line Hydraulics, Formal IPDS Datasheet, and Project Register.
 */

(() => {
  const E = window.PSVEngine;
  const U = E.Units;

  const STORAGE_KEY = 'psvcalc_pro_register_v1';

  // Application State
  let state = {
    unitSystem: 'SI', // 'SI' or 'USC'
    activeTab: 'tab-sizing',
    activeScenarioKey: 'fire_liquid',
    flowBasis: 'rated',
    autoKb: true,
    manualKb: 1.0,
    ipdsMode: 'psv', // 'psv' or 'pump'
    tag: JSON.parse(JSON.stringify(E.EPC_TAG_PRESETS[0])),
    pumpLoop: JSON.parse(JSON.stringify(E.PUMP_LOOP_PRESETS[0])),
    register: []
  };

  // =========================================================================
  // 1. INITIALIZATION & LOCALSTORAGE PERSISTENCE
  // =========================================================================

  function loadRegisterFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          state.register = parsed;
          return;
        }
      }
    } catch (err) {
      console.warn('LocalStorage unavailable, using default presets:', err);
    }
    state.register = JSON.parse(JSON.stringify(E.EPC_TAG_PRESETS));
    saveRegisterToStorage();
  }

  function saveRegisterToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.register));
    } catch (err) {
      console.warn('Could not persist register to LocalStorage:', err);
    }
    const badge = document.getElementById('registerCountBadge');
    if (badge) badge.textContent = String(state.register.length);
  }

  // =========================================================================
  // 2. UNIT FORMATTING & CONVERSION HELPERS
  // =========================================================================

  function isUSC() {
    return state.unitSystem === 'USC';
  }

  function fmtFlow(kgHr, digits = 0) {
    const val = isUSC() ? U.kgHrToLbHr(kgHr) : kgHr;
    const unit = isUSC() ? 'lb/hr' : 'kg/h';
    return `${Number(val).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${unit}`;
  }

  function fmtVolFlow(m3Hr, digits = 1) {
    const val = isUSC() ? U.m3HrToGpm(m3Hr) : m3Hr;
    const unit = isUSC() ? 'gpm' : 'm³/h';
    return `${Number(val).toFixed(digits)} ${unit}`;
  }

  function fmtHead(m, digits = 1) {
    const val = isUSC() ? U.mToFt(m) : m;
    const unit = isUSC() ? 'ft' : 'm';
    return `${Number(val).toFixed(digits)} ${unit}`;
  }

  function fmtPressG(barg, digits = 2) {
    const val = isUSC() ? U.barToPsi(barg) : barg;
    const unit = isUSC() ? 'psig' : 'barg';
    return `${Number(val).toFixed(digits)} ${unit}`;
  }

  function fmtPressA(bara, digits = 2) {
    const val = isUSC() ? U.barToPsi(bara) : bara;
    const unit = isUSC() ? 'psia' : 'bara';
    return `${Number(val).toFixed(digits)} ${unit}`;
  }

  function fmtTemp(tempC, digits = 1) {
    const val = isUSC() ? U.cToF(tempC) : tempC;
    const unit = isUSC() ? '°F' : '°C';
    return `${Number(val).toFixed(digits)} ${unit}`;
  }

  function fmtArea(mm2) {
    if (isUSC()) {
      return `${U.mm2ToIn2(mm2).toFixed(4)} in² (${mm2.toFixed(1)} mm²)`;
    }
    return `${mm2.toFixed(1)} mm² (${U.mm2ToIn2(mm2).toFixed(4)} in²)`;
  }

  // Differential pressure (no gauge/absolute suffix)
  function fmtDP(bar, digits = 3) {
    const val = isUSC() ? U.barToPsi(bar) : bar;
    return `${Number(val).toFixed(digits)} ${isUSC() ? 'psi' : 'bar'}`;
  }

  // Read a numeric input; fall back to default only when empty/invalid (0 is a valid value)
  function num(id, def) {
    const el = document.getElementById(id);
    if (!el) return def;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : def;
  }

  // Escape user-provided text before inserting into innerHTML / SVG
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Single source of truth for sizing + hydraulics of any tag
  function computeForTag(tag) {
    const autoKb = tag === state.tag ? state.autoKb : (tag.autoKb ?? true);
    const manualKb = tag === state.tag ? state.manualKb : (tag.manualKb ?? 1.0);
    const flowBasis = tag === state.tag ? state.flowBasis : (tag.flowBasis || 'rated');
    const sizing = E.sizeOrificeApi520({ ...tag, autoKb, manualKb });
    const hyd = E.calcLineHydraulicsApi520Part2(sizing, { ...tag, flowBasis });
    return { sizing, hyd };
  }

  function updateUnitAddonLabels() {
    document.querySelectorAll('[data-unit-type]').forEach(el => {
      const t = el.getAttribute('data-unit-type');
      if (t === 'massFlow') el.textContent = isUSC() ? 'lb/hr' : 'kg/h';
      else if (t === 'volFlow') el.textContent = isUSC() ? 'gpm' : 'm³/h';
      else if (t === 'pressGauge') el.textContent = isUSC() ? 'psig' : 'barg';
      else if (t === 'pressAbs') el.textContent = isUSC() ? 'psia' : 'bara';
      else if (t === 'pressDiff') el.textContent = isUSC() ? 'psi' : 'bar';
      else if (t === 'temp') el.textContent = isUSC() ? '°F' : '°C';
      else if (t === 'tempDiff') el.textContent = isUSC() ? '°F' : '°C';
      else if (t === 'density') el.textContent = isUSC() ? 'lb/ft³' : 'kg/m³';
      else if (t === 'length') el.textContent = isUSC() ? 'ft' : 'm';
    });
  }

  // Sync canonical state.tag values into DOM inputs according to current unit system
  function syncTagToDomInputs() {
    const t = state.tag;
    const presetSel = document.getElementById('presetTagSelect');
    if ([...presetSel.options].some(o => o.value === t.tagNumber)) presetSel.value = t.tagNumber;
    document.getElementById('ctxTagNumber').value = t.tagNumber || '';
    document.getElementById('ctxService').value = t.service || '';
    document.getElementById('ctxEquipment').value = t.equipmentProtected || '';
    document.getElementById('ctxProject').value = t.projectTitle || '';
    document.getElementById('ctxClient').value = t.clientName || '';
    document.getElementById('ctxPid').value = t.pidNumber || '';

    // Phase segmented buttons
    document.querySelectorAll('#phaseSelectorGroup .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.phase === t.fluidPhase);
    });

    // Show/hide phase-specific fields
    const isGasOrSteam = t.fluidPhase === 'gas' || t.fluidPhase === 'steam';
    document.getElementById('fgMw').style.display = t.fluidPhase === 'liquid' ? 'none' : '';
    document.getElementById('fgK').style.display = isGasOrSteam ? '' : 'none';
    document.getElementById('fgZ').style.display = isGasOrSteam ? '' : 'none';
    document.getElementById('fgSteamSh').style.display = t.fluidPhase === 'steam' ? '' : 'none';
    document.getElementById('fgOmega').style.display = t.fluidPhase === 'twophase' ? '' : 'none';

    document.getElementById('fluidPresetSelect').value = t.fluidPresetKey || 'custom';
    document.getElementById('inpMw').value = Number(t.mw).toFixed(2);
    document.getElementById('inpK').value = Number(t.k).toFixed(2);
    document.getElementById('inpZ').value = Number(t.z).toFixed(2);
    document.getElementById('inpRhoLiq').value = isUSC()
      ? U.kgm3ToLbft3(t.rhoLiqKgM3).toFixed(2)
      : Number(t.rhoLiqKgM3).toFixed(1);
    document.getElementById('inpVisc').value = Number(t.viscCp);
    document.getElementById('inpSteamSh').value = isUSC()
      ? (t.steamSuperheatC * 1.8).toFixed(1)
      : Number(t.steamSuperheatC).toFixed(1);
    document.getElementById('inpOmega').value = Number(t.omegaParam || 0.65).toFixed(2);

    // Process conditions
    document.getElementById('inpFlowRate').value = isUSC()
      ? Math.round(U.kgHrToLbHr(t.flowRateKgHr))
      : Math.round(t.flowRateKgHr);
    document.getElementById('inpRelievingTemp').value = isUSC()
      ? U.cToF(t.relievingTempC).toFixed(1)
      : Number(t.relievingTempC).toFixed(1);
    document.getElementById('inpOpPressure').value = isUSC()
      ? U.barToPsi(t.operatingPressureBarg).toFixed(1)
      : Number(t.operatingPressureBarg).toFixed(2);
    document.getElementById('inpSetPressure').value = isUSC()
      ? U.barToPsi(t.setPressureBarg).toFixed(1)
      : Number(t.setPressureBarg).toFixed(2);
    document.getElementById('inpOverpressurePct').value = String(t.overpressurePct);
    document.getElementById('inpAtmPressure').value = isUSC()
      ? U.barToPsi(t.atmPressureBara).toFixed(2)
      : Number(t.atmPressureBara).toFixed(3);
    document.getElementById('inpSuperBack').value = isUSC()
      ? U.barToPsi(t.superimposedBackBarg).toFixed(2)
      : Number(t.superimposedBackBarg).toFixed(2);
    document.getElementById('inpBuiltUpBack').value = isUSC()
      ? U.barToPsi(t.builtUpBackBarg).toFixed(2)
      : Number(t.builtUpBackBarg).toFixed(2);

    // Valve Type
    document.querySelectorAll('#valveTypeGroup .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.vtype === t.valveType);
    });
    document.getElementById('inpRuptureDisc').value = String(Boolean(t.ruptureDiscUpstream));
    state.autoKb = t.autoKb ?? true;
    state.manualKb = t.manualKb ?? 1.0;
    state.flowBasis = t.flowBasis || 'rated';
    document.getElementById('inpAutoKb').value = String(state.autoKb);
    document.getElementById('inpManualKb').value = Number(state.manualKb).toFixed(2);
    document.getElementById('fgManualKb').style.display = state.autoKb ? 'none' : '';
    document.getElementById('inpHydFlowBasis').value = state.flowBasis;

    // Line Sizing Inputs
    document.getElementById('inpInletNps').value = t.inletNps;
    document.getElementById('inpInletSch').value = t.inletSch;
    document.getElementById('inpInletLength').value = isUSC()
      ? U.mToFt(t.inletLengthM).toFixed(1)
      : Number(t.inletLengthM).toFixed(1);
    document.getElementById('inpInletFittingsK').value = Number(t.inletFittingsK).toFixed(2);

    document.getElementById('inpOutletNps').value = t.outletNps;
    document.getElementById('inpOutletSch').value = t.outletSch;
    document.getElementById('inpOutletLength').value = isUSC()
      ? U.mToFt(t.outletLengthM).toFixed(1)
      : Number(t.outletLengthM).toFixed(1);
    document.getElementById('inpOutletFittingsK').value = Number(t.outletFittingsK).toFixed(2);

    updateUnitAddonLabels();
  }

  // Read DOM inputs back into canonical SI state.tag
  function readDomInputsToTag() {
    const t = state.tag;
    t.tagNumber = document.getElementById('ctxTagNumber').value.trim() || 'PSV-NEW';
    t.service = document.getElementById('ctxService').value.trim();
    t.equipmentProtected = document.getElementById('ctxEquipment').value.trim();
    t.projectTitle = document.getElementById('ctxProject').value.trim();
    t.clientName = document.getElementById('ctxClient').value.trim();
    t.pidNumber = document.getElementById('ctxPid').value.trim();

    t.mw = num('inpMw', 20.0);
    t.k = num('inpK', 1.25);
    t.z = num('inpZ', 0.90);

    const rawRho = num('inpRhoLiq', 800);
    t.rhoLiqKgM3 = isUSC() ? U.lbft3ToKgm3(rawRho) : rawRho;

    t.viscCp = num('inpVisc', 0.015);

    const rawSh = num('inpSteamSh', 0);
    t.steamSuperheatC = isUSC() ? rawSh / 1.8 : rawSh;

    t.omegaParam = num('inpOmega', 0.65);

    const rawFlow = num('inpFlowRate', 1000);
    t.flowRateKgHr = isUSC() ? U.lbHrToKgHr(rawFlow) : rawFlow;

    const rawTemp = num('inpRelievingTemp', 50);
    t.relievingTempC = isUSC() ? U.fToC(rawTemp) : rawTemp;

    const rawOpP = num('inpOpPressure', 10);
    t.operatingPressureBarg = isUSC() ? U.psiToBar(rawOpP) : rawOpP;

    const rawSetP = num('inpSetPressure', 15);
    t.setPressureBarg = isUSC() ? U.psiToBar(rawSetP) : rawSetP;
    t.mawpBarg = t.setPressureBarg;

    t.overpressurePct = num('inpOverpressurePct', 10);

    const rawAtmP = num('inpAtmPressure', 1.01325);
    t.atmPressureBara = isUSC() ? U.psiToBar(rawAtmP) : rawAtmP;

    const rawSuperBack = num('inpSuperBack', 0);
    t.superimposedBackBarg = isUSC() ? U.psiToBar(rawSuperBack) : rawSuperBack;

    const rawBuiltBack = num('inpBuiltUpBack', 0);
    t.builtUpBackBarg = isUSC() ? U.psiToBar(rawBuiltBack) : rawBuiltBack;

    t.ruptureDiscUpstream = document.getElementById('inpRuptureDisc').value === 'true';
    state.autoKb = document.getElementById('inpAutoKb').value === 'true';
    state.manualKb = num('inpManualKb', 1.0);
    t.autoKb = state.autoKb;
    t.manualKb = state.manualKb;

    // Hydraulics
    t.inletNps = document.getElementById('inpInletNps').value;
    t.inletSch = document.getElementById('inpInletSch').value;
    const rawInLen = num('inpInletLength', 2.0);
    t.inletLengthM = isUSC() ? U.ftToM(rawInLen) : rawInLen;
    t.inletFittingsK = num('inpInletFittingsK', 0.95);

    t.outletNps = document.getElementById('inpOutletNps').value;
    t.outletSch = document.getElementById('inpOutletSch').value;
    const rawOutLen = num('inpOutletLength', 12.0);
    t.outletLengthM = isUSC() ? U.ftToM(rawOutLen) : rawOutLen;
    t.outletFittingsK = num('inpOutletFittingsK', 1.80);
    state.flowBasis = document.getElementById('inpHydFlowBasis').value;
    t.flowBasis = state.flowBasis;
  }

  function syncPumpToDomInputs() {
    const p = state.pumpLoop;
    if (!p || !document.getElementById('inpPumpTag')) return;
    const presetSel = document.getElementById('pumpPresetSelect');
    if (presetSel && [...presetSel.options].some(o => o.value === p.pumpTag)) {
      presetSel.value = p.pumpTag;
    }
    document.getElementById('inpPumpTag').value = p.pumpTag || 'P-3102A/B';
    document.getElementById('inpPumpService').value = p.service || '';
    document.getElementById('inpPumpNormFlow').value = isUSC()
      ? U.m3HrToGpm(p.normalFlowM3Hr).toFixed(1)
      : Number(p.normalFlowM3Hr).toFixed(1);
    document.getElementById('inpPumpRatedMargin').value = Number(p.ratedMarginPct).toFixed(0);
    document.getElementById('inpPumpRho').value = isUSC()
      ? U.kgm3ToLbft3(p.rhoKgM3).toFixed(2)
      : Number(p.rhoKgM3).toFixed(1);
    document.getElementById('inpPumpVisc').value = Number(p.viscCp);
    document.getElementById('inpPumpVaporPress').value = isUSC()
      ? U.barToPsi(p.vaporPressBara).toFixed(2)
      : Number(p.vaporPressBara).toFixed(2);
    document.getElementById('inpPumpTemp').value = isUSC()
      ? U.cToF(p.tempC).toFixed(1)
      : Number(p.tempC).toFixed(1);

    document.getElementById('inpPumpSucPress').value = isUSC()
      ? U.barToPsi(p.suctionVesselBarg).toFixed(1)
      : Number(p.suctionVesselBarg).toFixed(2);
    document.getElementById('inpPumpSucHead').value = isUSC()
      ? U.mToFt(p.suctionStaticHeadM).toFixed(1)
      : Number(p.suctionStaticHeadM).toFixed(2);
    document.getElementById('inpPumpSucNps').value = p.suctionNps || '6"';
    document.getElementById('inpPumpSucLength').value = isUSC()
      ? U.mToFt(p.suctionLengthM).toFixed(1)
      : Number(p.suctionLengthM).toFixed(1);
    document.getElementById('inpPumpSucK').value = Number(p.suctionFittingsK).toFixed(2);
    document.getElementById('inpPumpNpshr').value = isUSC()
      ? U.mToFt(p.npshrM).toFixed(1)
      : Number(p.npshrM).toFixed(2);

    document.getElementById('inpPumpDestPress').value = isUSC()
      ? U.barToPsi(p.destVesselBarg).toFixed(1)
      : Number(p.destVesselBarg).toFixed(2);
    document.getElementById('inpPumpDisHead').value = isUSC()
      ? U.mToFt(p.dischargeStaticHeadM).toFixed(1)
      : Number(p.dischargeStaticHeadM).toFixed(1);
    document.getElementById('inpPumpDisNps').value = p.dischargeNps || '4"';
    document.getElementById('inpPumpDisLength').value = isUSC()
      ? U.mToFt(p.dischargeLengthM).toFixed(1)
      : Number(p.dischargeLengthM).toFixed(1);
    document.getElementById('inpPumpDisK').value = Number(p.dischargeFittingsK).toFixed(2);
    document.getElementById('inpPumpEquipDp').value = isUSC()
      ? U.barToPsi(p.equipmentDpBar).toFixed(1)
      : Number(p.equipmentDpBar).toFixed(2);
    document.getElementById('inpPumpCvMinDp').value = isUSC()
      ? U.barToPsi(p.cvMinDpBar).toFixed(1)
      : Number(p.cvMinDpBar).toFixed(2);
    document.getElementById('inpPumpCvMax').value = Number(p.cvRatedMaxCv).toFixed(1);
    document.getElementById('inpPumpEff').value = Number(p.pumpEfficiencyPct).toFixed(1);
    document.getElementById('inpPumpShutoffRise').value = Number(p.shutoffRisePct).toFixed(0);
  }

  function readDomInputsToPump() {
    const p = state.pumpLoop;
    if (!p || !document.getElementById('inpPumpTag')) return;
    p.pumpTag = document.getElementById('inpPumpTag').value.trim() || 'P-NEW';
    p.service = document.getElementById('inpPumpService').value.trim();

    const rawQ = num('inpPumpNormFlow', 100);
    p.normalFlowM3Hr = isUSC() ? U.gpmToM3Hr(rawQ) : rawQ;
    p.ratedMarginPct = num('inpPumpRatedMargin', 10);

    const rawRho = num('inpPumpRho', 1000);
    p.rhoKgM3 = isUSC() ? U.lbft3ToKgm3(rawRho) : rawRho;
    p.viscCp = num('inpPumpVisc', 1.0);

    const rawPv = num('inpPumpVaporPress', 0.2);
    p.vaporPressBara = isUSC() ? U.psiToBar(rawPv) : rawPv;

    const rawT = num('inpPumpTemp', 50);
    p.tempC = isUSC() ? U.fToC(rawT) : rawT;

    const rawPs = num('inpPumpSucPress', 1.0);
    p.suctionVesselBarg = isUSC() ? U.psiToBar(rawPs) : rawPs;

    const rawZs = num('inpPumpSucHead', 4.0);
    p.suctionStaticHeadM = isUSC() ? U.ftToM(rawZs) : rawZs;

    p.suctionNps = document.getElementById('inpPumpSucNps').value;
    const rawLs = num('inpPumpSucLength', 12.0);
    p.suctionLengthM = isUSC() ? U.ftToM(rawLs) : rawLs;
    p.suctionFittingsK = num('inpPumpSucK', 2.2);

    const rawNpshr = num('inpPumpNpshr', 3.0);
    p.npshrM = isUSC() ? U.ftToM(rawNpshr) : rawNpshr;

    const rawPd = num('inpPumpDestPress', 10.0);
    p.destVesselBarg = isUSC() ? U.psiToBar(rawPd) : rawPd;

    const rawZd = num('inpPumpDisHead', 20.0);
    p.dischargeStaticHeadM = isUSC() ? U.ftToM(rawZd) : rawZd;

    p.dischargeNps = document.getElementById('inpPumpDisNps').value;
    const rawLd = num('inpPumpDisLength', 80.0);
    p.dischargeLengthM = isUSC() ? U.ftToM(rawLd) : rawLd;
    p.dischargeFittingsK = num('inpPumpDisK', 5.8);

    const rawEqDp = num('inpPumpEquipDp', 0.65);
    p.equipmentDpBar = isUSC() ? U.psiToBar(rawEqDp) : rawEqDp;

    const rawCvDp = num('inpPumpCvMinDp', 0.70);
    p.cvMinDpBar = isUSC() ? U.psiToBar(rawCvDp) : rawCvDp;

    p.cvRatedMaxCv = num('inpPumpCvMax', 145);
    p.pumpEfficiencyPct = num('inpPumpEff', 75);
    p.shutoffRisePct = num('inpPumpShutoffRise', 20);
  }

  // =========================================================================
  // 3. STEP 1: API 521 OVERPRESSURE SCENARIOS ("FROM BASE")
  // =========================================================================

  function scenarioPhase(t, scenarioKey) {
    if (scenarioKey === 'thermal_expansion') return 'liquid';
    if (scenarioKey === 'fire_liquid' || scenarioKey === 'fire_gas') {
      // Fire generates vapor: size on the vapor phase (steam service stays steam)
      return t.fluidPhase === 'steam' ? 'steam' : 'gas';
    }
    return t.fluidPhase;
  }

  function evaluateAllScenariosForTag(t) {
    const sc = t.scenarios;
    const fireLiq = E.calcFireLiquidVessel(sc.fireLiquid);
    const fireGas = E.calcFireGasVessel({
      ...sc.fireGas,
      setPressureBarg: t.setPressureBarg,
      operatingPressureBarg: t.operatingPressureBarg,
      atmPressureBara: t.atmPressureBara,
      mw: t.mw
    });
    const blocked = E.calcBlockedOutlet(sc.blockedOutlet);
    const cvFail = E.calcControlValveFailure({
      ...sc.cvFailure,
      setPressureBarg: t.setPressureBarg,
      atmPressureBara: t.atmPressureBara,
      tempC: t.relievingTempC,
      mw: t.mw,
      z: t.z,
      rhoLiqKgM3: t.rhoLiqKgM3
    });
    const thermal = E.calcThermalExpansion({
      ...sc.thermalExpansion,
      rhoLiqKgM3: t.rhoLiqKgM3
    });
    const tubeRup = E.calcTubeRupture({
      ...sc.tubeRupture,
      lpSetPressureBarg: t.setPressureBarg,
      atmPressureBara: t.atmPressureBara,
      rhoHpKgM3: t.rhoLiqKgM3,
      mwHp: t.mw,
      kHp: t.k,
      zHp: t.z,
      tempHpC: t.relievingTempC
    });

    const list = [fireLiq, fireGas, blocked, cvFail, thermal, tubeRup];

    // Estimate required orifice area for each scenario using Step 2 engine
    const evaluated = list.map(item => {
      const phaseForScen = scenarioPhase(t, item.scenarioKey);
      const sizing = E.sizeOrificeApi520({
        ...t,
        autoKb: state.autoKb,
        manualKb: state.manualKb,
        fluidPhase: phaseForScen,
        flowRateKgHr: Math.max(1, item.reliefRateKgHr),
        overpressurePct: item.allowedOverpressurePct
      });
      return {
        ...item,
        phaseForScen,
        P1_bara: sizing.P1_bara,
        reqAreaMm2: sizing.reqAreaMm2,
        reqAreaIn2: sizing.reqAreaIn2,
        orifice: sizing.selectedOrifice
      };
    });

    // Find governing scenario (maximum required orifice area)
    let governing = evaluated[0];
    for (const ev of evaluated) {
      if (ev.reqAreaMm2 > governing.reqAreaMm2) {
        governing = ev;
      }
    }

    return { evaluated, governing, map: Object.fromEntries(evaluated.map(e => [e.scenarioKey, e])) };
  }

  function renderScenarioForm() {
    const container = document.getElementById('scenarioInputContainer');
    const titleEl = document.getElementById('activeScenarioFormTitle');
    const stdEl = document.getElementById('activeScenarioStdBadge');
    const sc = state.tag.scenarios;
    const key = state.activeScenarioKey;

    if (key === 'fire_liquid') {
      const f = sc.fireLiquid;
      titleEl.textContent = '1A. External Fire — Liquid-Wetted Vessel';
      stdEl.textContent = 'API 521 §4.4.13.2.4';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group">
            <label class="field-label"><span>Vessel Orientation</span><span class="field-sym">Geom</span></label>
            <div class="input-with-unit">
              <select id="scFireOrientation">
                <option value="horizontal" ${f.orientation === 'horizontal' ? 'selected' : ''}>Horizontal Cylinder</option>
                <option value="vertical" ${f.orientation === 'vertical' ? 'selected' : ''}>Vertical Column / Vessel</option>
                <option value="spherical" ${f.orientation === 'spherical' ? 'selected' : ''}>Spherical Vessel</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Head Type</span><span class="field-sym">2:1 / Hemi</span></label>
            <div class="input-with-unit">
              <select id="scFireHeadType">
                <option value="ellipsoidal" ${f.headType === 'ellipsoidal' ? 'selected' : ''}>2:1 Ellipsoidal Heads</option>
                <option value="hemispherical" ${f.headType === 'hemispherical' ? 'selected' : ''}>Hemispherical Heads</option>
                <option value="flat" ${f.headType === 'flat' ? 'selected' : ''}>Flat Heads</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Vessel Inside Diameter (D)</span><span class="field-sym">D</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireDiam" step="0.1" min="0.2" value="${f.diameterM}" />
              <span class="unit-addon">m</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Tangent-to-Tangent Length (L)</span><span class="field-sym">L</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireLen" step="0.5" min="0.5" value="${f.lengthM}" />
              <span class="unit-addon">m</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Normal Liquid Level (NLL)</span><span class="field-sym">H_liq</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireNll" step="0.1" min="0.05" value="${f.nllM}" />
              <span class="unit-addon">m</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Vessel Bottom Above Grade</span><span class="field-sym">Z_bot</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireElev" step="0.1" min="0" value="${f.elevAboveGradeM}" />
              <span class="unit-addon">m</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Drainage &amp; Firefighting</span><span class="field-sym">C_fire</span></label>
            <div class="input-with-unit">
              <select id="scFireDrainage">
                <option value="true" ${f.drainageAdequate ? 'selected' : ''}>Adequate (Q = 43,200·F·A^0.82)</option>
                <option value="false" ${!f.drainageAdequate ? 'selected' : ''}>Inadequate (Q = 70,900·F·A^0.82)</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Environmental / Insulation Factor</span><span class="field-sym">F</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireFactorF" step="0.05" min="0.05" max="1.0" value="${f.envFactorF}" />
              <span class="unit-addon">0.05–1.0</span>
            </div>
          </div>
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>Latent Heat of Vaporization at P₁ (λ)</span><span class="field-sym">λ</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireLatent" step="5" min="20" value="${f.latentHeatKjKg}" />
              <span class="unit-addon">kJ/kg</span>
            </div>
          </div>
        </div>
      `;
    } else if (key === 'fire_gas') {
      const fg = sc.fireGas;
      titleEl.textContent = '1B. External Fire — Unwetted / Gas Vessel';
      stdEl.textContent = 'API 521 §4.4.13.2.7';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>Total Exposed Vessel Surface Area</span><span class="field-sym">A'</span></label>
            <div class="input-with-unit">
              <input type="number" id="scGasArea" step="1" min="1" value="${fg.exposedAreaM2}" />
              <span class="unit-addon">m²</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Normal Operating Gas Temp (T_n)</span><span class="field-sym">T_n</span></label>
            <div class="input-with-unit">
              <input type="number" id="scGasTemp" step="1" value="${fg.normalGasTempC}" />
              <span class="unit-addon">°C</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Max Fire Wall Temperature (T_w)</span><span class="field-sym">T_w</span></label>
            <div class="input-with-unit">
              <input type="number" id="scGasWallTemp" step="5" value="${fg.maxWallTempC}" />
              <span class="unit-addon">°C (CS=593)</span>
            </div>
          </div>
        </div>
        <p style="font-size:0.74rem;color:var(--text-muted);margin-top:0.6rem;">Uninsulated vessel basis. T₁ = T_n × P₁/P_n uses the operating and set pressures from Step 2.</p>
      `;
    } else if (key === 'blocked_outlet') {
      const b = sc.blockedOutlet;
      titleEl.textContent = '1C. Blocked Outlet — Max Source Inflow';
      stdEl.textContent = 'API 521 §4.4.2';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>Upstream Pressure Source Type</span><span class="field-sym">Source</span></label>
            <div class="input-with-unit">
              <select id="scBlockedType">
                <option value="upstream_header" ${b.sourceType === 'upstream_header' ? 'selected' : ''}>Upstream High-Pressure Process Header / Feed</option>
                <option value="pump_compressor" ${b.sourceType === 'pump_compressor' ? 'selected' : ''}>Centrifugal / PD Pump or Compressor Max Runout</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Max Upstream Source Inflow</span><span class="field-sym">W_in,max</span></label>
            <div class="input-with-unit">
              <input type="number" id="scBlockedInflow" step="100" min="0" value="${b.maxInflowKgHr}" />
              <span class="unit-addon">kg/h</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Credited Outflow (if any)</span><span class="field-sym">W_credit</span></label>
            <div class="input-with-unit">
              <input type="number" id="scBlockedCredit" step="100" min="0" value="${b.creditedOutflowKgHr}" />
              <span class="unit-addon">kg/h</span>
            </div>
          </div>
        </div>
      `;
    } else if (key === 'cv_failure') {
      const c = sc.cvFailure;
      titleEl.textContent = '1D. Control Valve Failure (Fail-Open Cv)';
      stdEl.textContent = 'API 521 §4.4.8 / IEC 60534';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group">
            <label class="field-label"><span>Fluid Phase Across CV</span><span class="field-sym">Phase</span></label>
            <div class="input-with-unit">
              <select id="scCvPhase">
                <option value="gas" ${c.fluidPhase === 'gas' ? 'selected' : ''}>Gas / Vapor / Steam</option>
                <option value="liquid" ${c.fluidPhase === 'liquid' ? 'selected' : ''}>Liquid</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Control Valve Max Rated Cv</span><span class="field-sym">Cv_max</span></label>
            <div class="input-with-unit">
              <input type="number" id="scCvRated" step="1" min="0.5" value="${c.ratedCv}" />
              <span class="unit-addon">US gpm/√psi</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Credited Open Bypass Cv</span><span class="field-sym">Cv_byp</span></label>
            <div class="input-with-unit">
              <input type="number" id="scCvBypass" step="1" min="0" value="${c.bypassCv}" />
              <span class="unit-addon">Cv</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Upstream Header Pressure</span><span class="field-sym">P_up</span></label>
            <div class="input-with-unit">
              <input type="number" id="scCvUpPress" step="0.5" min="1" value="${c.upstreamPressBarg}" />
              <span class="unit-addon">barg</span>
            </div>
          </div>
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>Normal Downstream Flow Credit (API 521)</span><span class="field-sym">W_norm</span></label>
            <div class="input-with-unit">
              <input type="number" id="scCvCredit" step="100" min="0" value="${c.normalFlowCreditKgHr}" />
              <span class="unit-addon">kg/h</span>
            </div>
          </div>
        </div>
      `;
    } else if (key === 'thermal_expansion') {
      const th = sc.thermalExpansion;
      titleEl.textContent = '1E. Thermal / Hydraulic Expansion';
      stdEl.textContent = 'API 521 §4.4.12';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group">
            <label class="field-label"><span>Heat Input / Exchanger Duty (Q)</span><span class="field-sym">Q</span></label>
            <div class="input-with-unit">
              <input type="number" id="scThHeatKw" step="10" min="1" value="${th.heatInputKw}" />
              <span class="unit-addon">kW</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Cubic Thermal Expansion (α_v)</span><span class="field-sym">α_v</span></label>
            <div class="input-with-unit">
              <input type="number" id="scThAlpha" step="0.0001" min="0.0001" value="${th.alphaVPerC}" />
              <span class="unit-addon">1/°C</span>
            </div>
          </div>
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>Liquid Specific Heat Capacity (Cp)</span><span class="field-sym">Cp</span></label>
            <div class="input-with-unit">
              <input type="number" id="scThCp" step="0.05" min="0.5" value="${th.cpLiqKjKgK}" />
              <span class="unit-addon">kJ/(kg·K)</span>
            </div>
          </div>
        </div>
      `;
    } else if (key === 'tube_rupture') {
      const tr = sc.tubeRupture;
      titleEl.textContent = '1F. Heat Exchanger Tube Rupture (2 × A_tube)';
      stdEl.textContent = 'API 521 §4.4.14';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group">
            <label class="field-label"><span>High-Pressure Side Fluid Phase</span><span class="field-sym">Phase_HP</span></label>
            <div class="input-with-unit">
              <select id="scTrPhase">
                <option value="liquid" ${tr.hpFluidPhase === 'liquid' ? 'selected' : ''}>Liquid / Flashing Condensate</option>
                <option value="gas" ${tr.hpFluidPhase === 'gas' ? 'selected' : ''}>High-Pressure Gas / Vapor</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Single Exchanger Tube ID</span><span class="field-sym">d_tube</span></label>
            <div class="input-with-unit">
              <input type="number" id="scTrTubeId" step="0.5" min="4" value="${tr.tubeIdMm}" />
              <span class="unit-addon">mm</span>
            </div>
          </div>
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>HP Side Design / Operating Pressure</span><span class="field-sym">P_HP</span></label>
            <div class="input-with-unit">
              <input type="number" id="scTrHpPress" step="1" min="5" value="${tr.hpPressureBarg}" />
              <span class="unit-addon">barg</span>
            </div>
          </div>
        </div>
      `;
    }

    container.insertAdjacentHTML('afterbegin', '<p style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.6rem;">Scenario inputs are entered in SI units; results follow the selected unit system.</p>');

    // Bind input listeners inside scenario form
    container.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', () => {
        readScenarioFormToState();
        recomputeAll();
      });
    });
  }

  function readScenarioFormToState() {
    const sc = state.tag.scenarios;
    const key = state.activeScenarioKey;
    if (key === 'fire_liquid') {
      sc.fireLiquid.orientation = document.getElementById('scFireOrientation').value;
      sc.fireLiquid.headType = document.getElementById('scFireHeadType').value;
      sc.fireLiquid.diameterM = num('scFireDiam', 2.0);
      sc.fireLiquid.lengthM = num('scFireLen', 6.0);
      sc.fireLiquid.nllM = num('scFireNll', 1.2);
      sc.fireLiquid.elevAboveGradeM = num('scFireElev', 1.5);
      sc.fireLiquid.drainageAdequate = document.getElementById('scFireDrainage').value === 'true';
      sc.fireLiquid.envFactorF = num('scFireFactorF', 1.0);
      sc.fireLiquid.latentHeatKjKg = num('scFireLatent', 300);
    } else if (key === 'fire_gas') {
      sc.fireGas.exposedAreaM2 = num('scGasArea', 40);
      sc.fireGas.normalGasTempC = num('scGasTemp', 60);
      sc.fireGas.maxWallTempC = num('scGasWallTemp', 593);
    } else if (key === 'blocked_outlet') {
      sc.blockedOutlet.sourceType = document.getElementById('scBlockedType').value;
      sc.blockedOutlet.maxInflowKgHr = num('scBlockedInflow', 10000);
      sc.blockedOutlet.creditedOutflowKgHr = num('scBlockedCredit', 0);
    } else if (key === 'cv_failure') {
      sc.cvFailure.fluidPhase = document.getElementById('scCvPhase').value;
      sc.cvFailure.ratedCv = num('scCvRated', 50);
      sc.cvFailure.bypassCv = num('scCvBypass', 0);
      sc.cvFailure.upstreamPressBarg = num('scCvUpPress', 35);
      sc.cvFailure.normalFlowCreditKgHr = num('scCvCredit', 0);
    } else if (key === 'thermal_expansion') {
      sc.thermalExpansion.heatInputKw = num('scThHeatKw', 250);
      sc.thermalExpansion.alphaVPerC = num('scThAlpha', 0.0008);
      sc.thermalExpansion.cpLiqKjKgK = num('scThCp', 2.4);
    } else if (key === 'tube_rupture') {
      sc.tubeRupture.hpFluidPhase = document.getElementById('scTrPhase').value;
      sc.tubeRupture.tubeIdMm = num('scTrTubeId', 15.7);
      sc.tubeRupture.hpPressureBarg = num('scTrHpPress', 50);
    }
  }

  function renderScenarioOutputs(scenariosBundle) {
    const { evaluated, governing, map } = scenariosBundle;
    const activeObj = map[state.activeScenarioKey] || evaluated[0];

    // 1. Render Active Scenario Equation Breakdown & Bespoke Engineering Schematic
    const traceEl = document.getElementById('scenarioTraceContainer');
    const svgEl = document.getElementById('scenarioSvgContainer');

    if (activeObj.scenarioKey === 'fire_liquid') {
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Effective Wetted Surface Area (A_ws ≤ 7.62 m above grade)</div>
          <div class="eq-symbolic">${activeObj.geometryFormulaNote}</div>
          <div class="eq-substitution">Total Area = ${activeObj.totalAreaM2.toFixed(1)} m² | Effective Wetted Height h_eff = ${activeObj.hEffM.toFixed(2)} m</div>
          <div class="eq-result">A_ws = ${activeObj.wettedAreaM2.toFixed(2)} m² (${activeObj.wettedAreaFt2.toFixed(1)} ft²)</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. API 521 Pool Fire Heat Absorption (Q) &amp; Relief Load (W)</div>
          <div class="eq-symbolic">Q (W) = ${activeObj.cFireSI.toLocaleString()} × F × A_ws^0.82   |   W = Q / λ</div>
          <div class="eq-substitution">Q = ${activeObj.cFireSI.toLocaleString()} × ${activeObj.envFactorF.toFixed(2)} × (${activeObj.wettedAreaM2.toFixed(2)})^0.82 = ${activeObj.heatDutyKw.toFixed(1)} kW (${activeObj.heatDutyMmbtuHr.toFixed(2)} MMBTU/hr)</div>
          <div class="eq-result">W_fire = (${activeObj.heatDutyKw.toFixed(1)} × 3600) / ${activeObj.latentHeatKjKg.toFixed(1)} = ${fmtFlow(activeObj.reliefRateKgHr)}</div>
        </div>
      `;
    } else if (activeObj.scenarioKey === 'cv_failure') {
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Control Valve Full Fail-Open Capacity (IEC 60534-2-1)</div>
          <div class="eq-symbolic">${activeObj.equationNote}</div>
          <div class="eq-substitution">Total Cv = ${activeObj.totalCv.toFixed(1)} | P_up = ${activeObj.P_upBara.toFixed(2)} bara → P₁ = ${activeObj.P_1Bara.toFixed(2)} bara</div>
          <div class="eq-result">W_cv,max = ${fmtFlow(activeObj.maxCvFlowKgHr)}</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. Net Required Relief Load After Normal Outlet Flow Credit</div>
          <div class="eq-symbolic">W_net = W_cv,max - W_normal_credit</div>
          <div class="eq-substitution">W_net = ${activeObj.maxCvFlowKgHr.toFixed(0)} - ${activeObj.normalFlowCreditKgHr.toFixed(0)} kg/h</div>
          <div class="eq-result">W_relief = ${fmtFlow(activeObj.reliefRateKgHr)}</div>
        </div>
      `;
    } else if (activeObj.scenarioKey === 'tube_rupture') {
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Double-Ended Guillotine Tube Break Area (2 × A_tube)</div>
          <div class="eq-symbolic">A_break = 2 × (π / 4) × d_tube²</div>
          <div class="eq-substitution">d_tube = ${activeObj.tubeIdMm.toFixed(1)} mm → Single Tube = ${activeObj.singleTubeAreaMm2.toFixed(1)} mm²</div>
          <div class="eq-result">A_break = ${activeObj.totalBreakAreaMm2.toFixed(1)} mm² (Cd = ${activeObj.Cd})</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. HP-to-LP Orifice Discharge Relief Load (API 521 §4.4.14)</div>
          <div class="eq-symbolic">W = 3600 × Cd × A_break × √[ 2 × ρ × (P_HP - P_LP) ]</div>
          <div class="eq-substitution">P_HP = ${activeObj.P_hpBara.toFixed(2)} bara → P_LP,rel = ${activeObj.P_lpBara.toFixed(2)} bara</div>
          <div class="eq-result">W_tube = ${fmtFlow(activeObj.reliefRateKgHr)}</div>
        </div>
      `;
    } else if (activeObj.scenarioKey === 'fire_gas') {
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Gas Temperature at Relieving Pressure</div>
          <div class="eq-symbolic">T₁ = T_n × P₁ / P_n</div>
          <div class="eq-substitution">P₁ = ${activeObj.P1Psia.toFixed(1)} psia (21% OP), P_n = ${(activeObj.PnBara * 14.5038).toFixed(1)} psia</div>
          <div class="eq-result">T₁ = ${activeObj.T1R.toFixed(1)} °R (${activeObj.T1C.toFixed(1)} °C), T_w = ${activeObj.TwR.toFixed(1)} °R</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. Unwetted Vessel Relief Load (API 521 §4.4.13.2.7)</div>
          <div class="eq-symbolic">W (lb/h) = 0.2772 × √(M × P₁) × A' × (T_w − T₁)^1.25 / T₁^1.1506</div>
          <div class="eq-substitution">A' = ${activeObj.exposedAreaFt2.toFixed(1)} ft² (${activeObj.exposedAreaM2.toFixed(1)} m²)</div>
          <div class="eq-result">W = ${fmtFlow(activeObj.reliefRateKgHr)}${activeObj.wallTempWarning ? ' — ⚠ ' + activeObj.wallTempWarning : ''}</div>
        </div>
      `;
    } else if (activeObj.scenarioKey === 'blocked_outlet') {
      const b = state.tag.scenarios.blockedOutlet;
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Blocked Outlet Source Inflow Balance (API 521 §4.4.2)</div>
          <div class="eq-symbolic">W_relief = W_in,max − W_credit   (OP = ${activeObj.allowedOverpressurePct.toFixed(0)}%, P₁ = ${fmtPressA(activeObj.P1_bara)})</div>
          <div class="eq-substitution">W_in,max = ${fmtFlow(b.maxInflowKgHr)} − W_credit = ${fmtFlow(b.creditedOutflowKgHr)}</div>
          <div class="eq-result">W_blocked = ${fmtFlow(activeObj.reliefRateKgHr)}</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. Estimated API 520 Orifice Area for Blocked Outlet</div>
          <div class="eq-symbolic">A_req evaluated at OP = ${activeObj.allowedOverpressurePct.toFixed(0)}%</div>
          <div class="eq-result">A_req = ${activeObj.reqAreaMm2.toFixed(1)} mm² (${activeObj.reqAreaIn2.toFixed(3)} in²) → Orifice ${activeObj.orifice.letter}</div>
        </div>
      `;
    } else {
      const th = state.tag.scenarios.thermalExpansion;
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Blocked-In Liquid Thermal Expansion (API 521 §4.4.12)</div>
          <div class="eq-symbolic">W = (3600 × α_v × Q) / Cp</div>
          <div class="eq-substitution">α_v = ${th.alphaVPerC} 1/°C · Q = ${th.heatInputKw} kW · Cp = ${th.cpLiqKjKgK} kJ/(kg·K)</div>
          <div class="eq-result">W_thermal = ${fmtFlow(activeObj.reliefRateKgHr)}</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. Estimated API 520 Orifice Area for Thermal Expansion</div>
          <div class="eq-symbolic">A_req evaluated at OP = ${activeObj.allowedOverpressurePct.toFixed(0)}% (Liquid Service)</div>
          <div class="eq-result">A_req = ${activeObj.reqAreaMm2.toFixed(1)} mm² (${activeObj.reqAreaIn2.toFixed(3)} in²) → Orifice ${activeObj.orifice.letter}</div>
        </div>
      `;
    }

    svgEl.innerHTML = renderBespokeScenarioSvg(activeObj);
    renderScenarioComparisonChart(evaluated, governing);

    // 2. Render Multi-Scenario Comparison Table
    const tbody = document.getElementById('scenarioSummaryTbody');
    tbody.innerHTML = evaluated.map(ev => {
      const isGov = ev.scenarioKey === governing.scenarioKey;
      return `
        <tr class="${isGov ? 'row-governing' : ''}">
          <td>
            <div style="font-weight:700;">${ev.scenarioName}</div>
            ${isGov ? '<span class="status-badge status-pass" style="margin-top:2px;">★ GOVERNING SCENARIO</span>' : ''}
          </td>
          <td class="mono">${ev.allowedOverpressurePct.toFixed(0)}%</td>
          <td class="mono">${fmtPressA(ev.P1_bara)}</td>
          <td class="mono" style="font-weight:700;">${fmtFlow(ev.reliefRateKgHr)}</td>
          <td class="mono">${ev.reqAreaMm2.toFixed(1)} mm² (${ev.reqAreaIn2.toFixed(3)} in²)</td>
          <td class="mono" style="font-weight:700;color:var(--accent-primary);">Orifice ${ev.orifice.letter} (${ev.orifice.inletOutFlange})</td>
          <td>
            <button type="button" class="btn btn-secondary btn-apply-scen-row" data-skey="${ev.scenarioKey}" style="padding:0.25rem 0.55rem;font-size:0.74rem;">
              Send to Step 2 →
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-apply-scen-row').forEach(btn => {
      btn.addEventListener('click', () => {
        applyScenarioToStep2(map[btn.dataset.skey]);
      });
    });
  }

  function renderScenarioComparisonChart(evaluated, governing) {
    const container = document.getElementById('scenarioComparisonChartContainer');
    if (!container) return;
    const maxArea = Math.max(10, ...evaluated.map(e => e.reqAreaMm2));

    const rowsSvg = evaluated.map((ev, idx) => {
      const y = 26 + idx * 27;
      const isGov = ev.scenarioKey === governing.scenarioKey;
      const isActive = ev.scenarioKey === state.activeScenarioKey;
      const barW = Math.max(6, (ev.reqAreaMm2 / maxArea) * 290);
      const fill = isGov ? '#0284c7' : (isActive ? '#059669' : '#94a3b8');
      const shortName = ev.scenarioName.replace(/^1[A-F]\.\s*/, '').slice(0, 26);
      const areaLabel = isUSC()
        ? `${ev.reqAreaIn2.toFixed(3)} in² (Orif ${ev.orifice.letter})`
        : `${ev.reqAreaMm2.toFixed(1)} mm² (Orif ${ev.orifice.letter})`;

      return `
        <g style="cursor:pointer;" data-chart-scen="${ev.scenarioKey}">
          <text x="172" y="${y + 13}" text-anchor="end" font-size="9.5" font-weight="${isGov || isActive ? '800' : '600'}" fill="${isGov ? '#0284c7' : '#334155'}" font-family="JetBrains Mono">${isGov ? '★ ' : ''}${escapeHtml(shortName)}</text>
          <rect x="180" y="${y + 2}" width="300" height="16" rx="3" fill="rgba(148,163,184,0.15)" />
          <rect x="180" y="${y + 2}" width="${barW.toFixed(1)}" height="16" rx="3" fill="${fill}" />
          <text x="${Math.min(486, 186 + barW).toFixed(1)}" y="${y + 13}" font-size="9.5" font-weight="700" fill="#0f172a" font-family="JetBrains Mono">${areaLabel} · ${fmtFlow(ev.reliefRateKgHr)}</text>
        </g>
      `;
    }).join('');

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">
        <span style="font-size:0.75rem;font-weight:700;color:var(--text-secondary);">Visual Comparison: Required Relief Area (A_req) &amp; Selected Orifice Across All 6 API 521 Scenarios</span>
        <span class="mono" style="font-size:0.72rem;color:var(--accent-primary);font-weight:700;">Governing: ${escapeHtml(governing.scenarioName)} → Orifice ${governing.orifice.letter}</span>
      </div>
      <svg viewBox="0 0 680 192" width="100%" height="192" role="img" aria-label="Multi-Scenario Orifice Area Comparison Bar Chart">
        <line x1="180" y1="20" x2="180" y2="184" stroke="#64748b" stroke-width="1.5" />
        ${rowsSvg}
      </svg>
    `;

    container.querySelectorAll('[data-chart-scen]').forEach(g => {
      g.addEventListener('click', () => {
        state.activeScenarioKey = g.getAttribute('data-chart-scen');
        document.querySelectorAll('#scenarioSelectorList .scenario-nav-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.scenario === state.activeScenarioKey);
        });
        renderScenarioForm();
        recomputeAll();
      });
    });
  }

  function renderBespokeScenarioSvg(activeObj) {
    const key = activeObj.scenarioKey;
    if (key === 'fire_liquid') {
      const f = state.tag.scenarios.fireLiquid;
      const fillPct = Math.min(100, Math.max(12, (activeObj.hEffM / Math.max(0.5, f.diameterM)) * 100));
      const liqY = 136 - (96 * fillPct) / 100;
      return `
        <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Vessel Wetted Area Fire Diagram">
          <defs>
            <clipPath id="vesselClip">
              <rect x="65" y="42" width="230" height="94" rx="45" />
            </clipPath>
          </defs>
          <!-- Grade Line -->
          <line x1="15" y1="182" x2="365" y2="182" stroke="#475569" stroke-width="2" />
          <text x="20" y="198" fill="#64748b" font-size="9.5" font-family="JetBrains Mono">POOL FIRE GRADE (0.0m) · Z_bot=${f.elevAboveGradeM}m · Q=${activeObj.heatDutyKw.toFixed(0)} kW</text>
          <!-- 7.62m Flame Ceiling Line -->
          <line x1="20" y1="20" x2="360" y2="20" stroke="#d97706" stroke-width="1.5" stroke-dasharray="5,4" />
          <text x="22" y="13" fill="#d97706" font-size="9.5" font-weight="700" font-family="JetBrains Mono">API 521 7.62m (25 ft) WETTED ENVELOPE</text>
          <!-- Top Relief Vapour Line to PSV -->
          <path d="M180,42 L180,24 L318,24" fill="none" stroke="#0284c7" stroke-width="3" class="svg-flow-anim" />
          <polygon points="315,19 327,24 315,29" fill="#0284c7" />
          <text x="329" y="28" fill="#0284c7" font-size="9.5" font-weight="800" font-family="JetBrains Mono">PSV</text>
          <!-- Vessel Saddle Legs -->
          <line x1="105" y1="136" x2="105" y2="182" stroke="#334155" stroke-width="4" />
          <line x1="255" y1="136" x2="255" y2="182" stroke="#334155" stroke-width="4" />
          <!-- Liquid Wetted Zone + Boiling Vapour Bubbles -->
          <g clip-path="url(#vesselClip)">
            <rect x="65" y="${liqY.toFixed(1)}" width="230" height="${((96 * fillPct) / 100).toFixed(1)}" fill="rgba(2, 132, 199, 0.28)" />
            <line x1="65" y1="${liqY.toFixed(1)}" x2="295" y2="${liqY.toFixed(1)}" stroke="#0284c7" stroke-width="2" stroke-dasharray="4,2" />
            <circle cx="120" cy="${Math.min(128, liqY + 18).toFixed(1)}" r="3.5" fill="#0284c7" opacity="0.6" />
            <circle cx="155" cy="${Math.min(125, liqY + 12).toFixed(1)}" r="4.5" fill="#0284c7" opacity="0.5" />
            <circle cx="205" cy="${Math.min(128, liqY + 20).toFixed(1)}" r="3.5" fill="#0284c7" opacity="0.6" />
            <circle cx="240" cy="${Math.min(124, liqY + 10).toFixed(1)}" r="4" fill="#0284c7" opacity="0.5" />
          </g>
          <!-- Vessel Shell Outline -->
          <rect x="65" y="42" width="230" height="94" rx="45" fill="none" stroke="#0f172a" stroke-width="2.5" />
          <text x="180" y="72" text-anchor="middle" fill="#0f172a" font-size="10.5" font-weight="800" font-family="JetBrains Mono">D=${f.diameterM}m × L=${f.lengthM}m (${f.orientation})</text>
          <text x="180" y="92" text-anchor="middle" fill="#0369a1" font-size="10.5" font-weight="800" font-family="JetBrains Mono">A_ws = ${activeObj.wettedAreaM2.toFixed(1)} m² (${activeObj.wettedAreaFt2.toFixed(0)} ft²)</text>
          <text x="180" y="122" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="700" font-family="JetBrains Mono">W = ${fmtFlow(activeObj.reliefRateKgHr)}</text>
          <!-- Animated Pool Fire Flames -->
          <g class="svg-flame">
            <path d="M95,182 Q106,148 118,182 Q132,142 146,182 Q162,146 178,182 Q194,140 210,182 Q226,146 242,182 Q256,150 268,182" fill="rgba(220,38,38,0.18)" stroke="#dc2626" stroke-width="2.5" />
            <path d="M115,182 Q125,158 135,182 Q150,154 165,182 Q180,156 195,182 Q210,154 225,182 Q238,158 250,182" fill="none" stroke="#f59e0b" stroke-width="2" />
          </g>
        </svg>
      `;
    }

    if (key === 'fire_gas') {
      return `
        <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Unwetted Gas Vessel Fire Schematic">
          <!-- Vertical Gas Contactor / Vessel -->
          <rect x="125" y="28" width="110" height="135" rx="38" fill="rgba(245,158,11,0.12)" stroke="#d97706" stroke-width="2.5" />
          <text x="180" y="64" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="800" font-family="JetBrains Mono">UNWETTED GAS VESSEL</text>
          <text x="180" y="84" text-anchor="middle" fill="#d97706" font-size="10.5" font-weight="800" font-family="JetBrains Mono">A' = ${activeObj.exposedAreaM2.toFixed(1)} m²</text>
          <text x="180" y="104" text-anchor="middle" fill="#334155" font-size="9.5" font-family="JetBrains Mono">Wall T_w = ${activeObj.TwR ? ((activeObj.TwR - 491.67) / 1.8).toFixed(0) : 593} °C</text>
          <text x="180" y="122" text-anchor="middle" fill="#0369a1" font-size="9.5" font-weight="700" font-family="JetBrains Mono">Gas T₁ = ${activeObj.T1C.toFixed(0)} °C</text>
          <text x="180" y="142" text-anchor="middle" fill="#dc2626" font-size="10" font-weight="800" font-family="JetBrains Mono">${fmtFlow(activeObj.reliefRateKgHr)}</text>
          <!-- Relief Line out Top -->
          <path d="M180,28 L180,14 L315,14" fill="none" stroke="#dc2626" stroke-width="3" class="svg-flow-anim" />
          <polygon points="312,9 324,14 312,19" fill="#dc2626" />
          <text x="345" y="18" text-anchor="middle" fill="#dc2626" font-size="9.5" font-weight="800" font-family="JetBrains Mono">TO PSV</text>
          <!-- External Radiant Fire Waves on Both Sides -->
          <path d="M72,165 Q85,135 98,165 Q105,140 115,165" fill="none" stroke="#dc2626" stroke-width="2.2" class="svg-flame" />
          <path d="M245,165 Q255,140 265,165 Q278,135 290,165" fill="none" stroke="#dc2626" stroke-width="2.2" class="svg-flame" />
          <path d="M115,180 Q135,152 155,180 Q180,148 205,180 Q225,152 245,180" fill="rgba(220,38,38,0.16)" stroke="#dc2626" stroke-width="2.5" class="svg-flame" />
          <text x="190" y="198" text-anchor="middle" fill="#64748b" font-size="9.5" font-family="JetBrains Mono">API 521 §4.4.13.2.7 VAPOR EXPANSION IN FIRE (21% OP)</text>
        </svg>
      `;
    }

    if (key === 'blocked_outlet') {
      const b = state.tag.scenarios.blockedOutlet;
      return `
        <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Blocked Outlet Overpressure Schematic">
          <!-- Upstream Feed Line -->
          <line x1="18" y1="105" x2="112" y2="105" stroke="#0284c7" stroke-width="6" />
          <line x1="18" y1="105" x2="112" y2="105" stroke="#e0f2fe" stroke-width="2.5" class="svg-flow-anim" />
          <text x="64" y="88" text-anchor="middle" fill="#0369a1" font-size="9.5" font-weight="800" font-family="JetBrains Mono">INFLOW W_max</text>
          <text x="64" y="125" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="700" font-family="JetBrains Mono">${fmtFlow(b.maxInflowKgHr)}</text>
          <!-- Protected Vessel -->
          <rect x="112" y="42" width="105" height="122" rx="22" fill="rgba(2,132,199,0.12)" stroke="#0369a1" stroke-width="2.5" />
          <text x="164" y="82" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="800" font-family="JetBrains Mono">PROTECTED</text>
          <text x="164" y="98" text-anchor="middle" fill="#0369a1" font-size="10" font-weight="800" font-family="JetBrains Mono">P₁=${fmtPressA(activeObj.P1_bara)}</text>
          <text x="164" y="118" text-anchor="middle" fill="#059669" font-size="9.5" font-weight="700" font-family="JetBrains Mono">OP = 10%</text>
          <!-- Top Relief Path to PSV -->
          <path d="M164,42 L164,18 L295,18" fill="none" stroke="#059669" stroke-width="3.5" class="svg-flow-anim" />
          <polygon points="292,13 304,18 292,23" fill="#059669" />
          <text x="336" y="22" text-anchor="middle" fill="#059669" font-size="9.5" font-weight="800" font-family="JetBrains Mono">PSV LIFT</text>
          <!-- Blocked Downstream Outlet Pipe + Closed XV Valve -->
          <line x1="217" y1="105" x2="355" y2="105" stroke="#94a3b8" stroke-width="6" />
          <polygon points="268,90 290,105 268,120" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <polygon points="312,90 290,105 312,120" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <!-- Red X Block Symbol -->
          <line x1="276" y1="62" x2="304" y2="84" stroke="#dc2626" stroke-width="3" />
          <line x1="304" y1="62" x2="276" y2="84" stroke="#dc2626" stroke-width="3" />
          <text x="290" y="138" text-anchor="middle" fill="#dc2626" font-size="9.5" font-weight="800" font-family="JetBrains Mono">BLOCKED OUTLET</text>
          <text x="190" y="192" text-anchor="middle" fill="#0f172a" font-size="10.5" font-weight="800" font-family="JetBrains Mono">Net Relief W = ${fmtFlow(activeObj.reliefRateKgHr)} → Orifice ${activeObj.orifice.letter}</text>
        </svg>
      `;
    }

    if (key === 'cv_failure') {
      return `
        <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Control Valve Fail-Open Schematic">
          <!-- Upstream HP Header -->
          <rect x="14" y="65" width="76" height="80" rx="8" fill="rgba(220,38,38,0.12)" stroke="#dc2626" stroke-width="2" />
          <text x="52" y="95" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="800" font-family="JetBrains Mono">HP HEADER</text>
          <text x="52" y="114" text-anchor="middle" fill="#dc2626" font-size="9.5" font-weight="800" font-family="JetBrains Mono">${activeObj.P_upBara.toFixed(1)} bara</text>
          <!-- Pipe through Fail-Open Control Valve -->
          <line x1="90" y1="105" x2="245" y2="105" stroke="#dc2626" stroke-width="6" />
          <line x1="90" y1="105" x2="245" y2="105" stroke="#fef2f2" stroke-width="2.2" class="svg-flow-anim" />
          <!-- Control Valve + Diaphragm Dome -->
          <polygon points="145,90 168,105 145,120" fill="#d97706" stroke="#0f172a" stroke-width="1.8" />
          <polygon points="191,90 168,105 191,120" fill="#d97706" stroke="#0f172a" stroke-width="1.8" />
          <line x1="168" y1="105" x2="168" y2="66" stroke="#0f172a" stroke-width="2.5" />
          <path d="M148,66 A20,14 0 0,1 188,66 Z" fill="#d97706" stroke="#0f172a" stroke-width="1.8" />
          <text x="168" y="42" text-anchor="middle" fill="#dc2626" font-size="9.5" font-weight="800" font-family="JetBrains Mono">100% FAIL-OPEN</text>
          <text x="168" y="138" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="800" font-family="JetBrains Mono">Cv_tot = ${activeObj.totalCv.toFixed(1)}</text>
          <!-- Bypass Loop Line -->
          <path d="M115,105 L115,156 L220,156 L220,105" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="4,3" />
          <text x="168" y="170" text-anchor="middle" fill="#64748b" font-size="8.5" font-family="JetBrains Mono">Bypass Loop Credited</text>
          <!-- LP Receiver + PSV -->
          <rect x="245" y="52" width="115" height="106" rx="16" fill="rgba(2,132,199,0.12)" stroke="#0369a1" stroke-width="2.2" />
          <text x="302" y="85" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="800" font-family="JetBrains Mono">LP RECEIVER</text>
          <text x="302" y="104" text-anchor="middle" fill="#0369a1" font-size="9.5" font-weight="700" font-family="JetBrains Mono">P₁=${activeObj.P_1Bara.toFixed(1)} bara</text>
          <text x="302" y="124" text-anchor="middle" fill="#059669" font-size="10" font-weight="800" font-family="JetBrains Mono">${fmtFlow(activeObj.reliefRateKgHr)}</text>
          <text x="190" y="196" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="700" font-family="JetBrains Mono">IEC 60534 Fail-Open → Orifice ${activeObj.orifice.letter}</text>
        </svg>
      `;
    }

    if (key === 'thermal_expansion') {
      const th = state.tag.scenarios.thermalExpansion;
      return `
        <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Thermal Expansion Schematic">
          <!-- Blocked-In Pipe / Exchanger Section -->
          <line x1="30" y1="108" x2="350" y2="108" stroke="#0284c7" stroke-width="18" />
          <line x1="30" y1="108" x2="350" y2="108" stroke="#38bdf8" stroke-width="8" />
          <!-- Left & Right Closed Isolation Valves -->
          <polygon points="55,92 75,108 55,124" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <polygon points="95,92 75,108 95,124" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <polygon points="285,92 305,108 285,124" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <polygon points="325,92 305,108 325,124" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <text x="75" y="84" text-anchor="middle" fill="#dc2626" font-size="9" font-weight="800" font-family="JetBrains Mono">BLOCKED</text>
          <text x="305" y="84" text-anchor="middle" fill="#dc2626" font-size="9" font-weight="800" font-family="JetBrains Mono">BLOCKED</text>
          <!-- Solar / Process Heat Input Arrows -->
          <path d="M135,165 L135,130 M165,165 L165,130 M195,165 L195,130 M225,165 L225,130" stroke="#d97706" stroke-width="2.5" />
          <text x="180" y="182" text-anchor="middle" fill="#d97706" font-size="10" font-weight="800" font-family="JetBrains Mono">↑ HEAT INPUT Q = ${th.heatInputKw} kW (α_v = ${th.alphaVPerC}/°C) ↑</text>
          <!-- Top Thermal Relief Valve (TSV) -->
          <path d="M190,98 L190,34 L275,34" fill="none" stroke="#059669" stroke-width="3.5" class="svg-flow-anim" />
          <text x="190" y="22" text-anchor="middle" fill="#059669" font-size="10" font-weight="800" font-family="JetBrains Mono">TSV / PSV RELIEF: ${fmtFlow(activeObj.reliefRateKgHr)} (Orifice ${activeObj.orifice.letter})</text>
        </svg>
      `;
    }

    // 1F: Heat Exchanger Tube Rupture (2 x A_tube)
    return `
      <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Heat Exchanger Tube Rupture Schematic">
        <!-- Exchanger Shell Outline -->
        <rect x="45" y="48" width="270" height="106" rx="28" fill="rgba(2,132,199,0.10)" stroke="#0f172a" stroke-width="2.5" />
        <!-- Tube Sheet Divider -->
        <line x1="102" y1="48" x2="102" y2="154" stroke="#0f172a" stroke-width="3.5" />
        <!-- HP U-Tubes inside Shell -->
        <path d="M102,74 L265,74 A18,18 0 0,1 265,110 L102,110" fill="none" stroke="#dc2626" stroke-width="4" />
        <path d="M102,126 L250,126" fill="none" stroke="#dc2626" stroke-width="4" />
        <!-- Guillotine Rupture Jet at X=195 -->
        <circle cx="195" cy="74" r="9" fill="rgba(220,38,38,0.28)" class="svg-pulse-dot" />
        <circle cx="195" cy="74" r="5" fill="#dc2626" />
        <text x="195" y="62" text-anchor="middle" fill="#dc2626" font-size="9.5" font-weight="800" font-family="JetBrains Mono">⚡ 2×A_tube = ${activeObj.totalBreakAreaMm2.toFixed(0)} mm²</text>
        <text x="74" y="96" text-anchor="middle" fill="#dc2626" font-size="9" font-weight="800" font-family="JetBrains Mono">HP TUBE</text>
        <text x="74" y="112" text-anchor="middle" fill="#dc2626" font-size="9" font-weight="700" font-family="JetBrains Mono">${activeObj.P_hpBara.toFixed(1)}b</text>
        <text x="205" y="144" text-anchor="middle" fill="#0369a1" font-size="9.5" font-weight="800" font-family="JetBrains Mono">LP SHELL P₁ = ${activeObj.P_lpBara.toFixed(1)} bara</text>
        <!-- LP Shell Relief to PSV -->
        <path d="M265,48 L265,20 L345,20" fill="none" stroke="#0284c7" stroke-width="3.5" class="svg-flow-anim" />
        <text x="190" y="190" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="800" font-family="JetBrains Mono">Tube Rupture W = ${fmtFlow(activeObj.reliefRateKgHr)} → Orifice ${activeObj.orifice.letter}</text>
      </svg>
    `;
  }

  function applyScenarioToStep2(scenObj) {
    if (!scenObj) return;
    state.tag.governingScenarioKey = scenObj.scenarioKey;
    state.tag.flowRateKgHr = Math.max(1, Math.round(scenObj.reliefRateKgHr));
    state.tag.overpressurePct = scenObj.allowedOverpressurePct;
    if (scenObj.phaseForScen) {
      state.tag.fluidPhase = scenObj.phaseForScen;
    }
    syncTagToDomInputs();
    recomputeAll();
    switchTab('tab-sizing');
  }

  // =========================================================================
  // 4. STEP 2: API 520 PART I ORIFICE SIZING & VISUALIZERS
  // =========================================================================

  function renderSizingOutputs(sizing) {
    // Top Ribbon
    document.getElementById('ribbonReqArea').textContent = isUSC()
      ? `${sizing.reqAreaIn2.toFixed(3)} in²`
      : `${sizing.reqAreaMm2.toFixed(1)} mm²`;
    document.getElementById('ribbonOrificeLetter').textContent = `${sizing.selectedOrifice.letter} (${sizing.selectedOrifice.inletOutFlange})`;

    // Warnings Banner
    const warnEl = document.getElementById('sizingWarningsBanner');
    if (sizing.warnings.length > 0) {
      warnEl.style.display = 'block';
      warnEl.innerHTML = sizing.warnings.map(w => `<div>⚠ ${w}</div>`).join('');
    } else {
      warnEl.style.display = 'none';
    }

    // Hero Card
    document.getElementById('flowRegimeBadge').textContent = sizing.flowRegime;
    document.getElementById('resOrificeLetter').textContent = sizing.selectedOrifice.letter;
    document.getElementById('resOrificeFlange').textContent = `Flange: ${sizing.selectedOrifice.inletOutFlange}`;
    document.getElementById('resOrificeUtilization').textContent = `Utilization: ${sizing.selectedOrifice.utilizationPct.toFixed(1)}% (Margin: ${sizing.selectedOrifice.marginPct.toFixed(1)}%)`;

    document.getElementById('resReqAreaPrimary').textContent = isUSC()
      ? `${sizing.reqAreaIn2.toFixed(4)} in²`
      : `${sizing.reqAreaMm2.toFixed(1)} mm²`;
    document.getElementById('resReqAreaSecondary').textContent = isUSC()
      ? `${sizing.reqAreaMm2.toFixed(1)} mm²`
      : `${sizing.reqAreaIn2.toFixed(4)} in²`;

    document.getElementById('resSelAreaPrimary').textContent = isUSC()
      ? `${sizing.selectedOrifice.areaIn2.toFixed(3)} in²`
      : `${sizing.selectedOrifice.areaMm2.toFixed(1)} mm²`;
    document.getElementById('resSelAreaSecondary').textContent = `API 526 Orifice ${sizing.selectedOrifice.letter} (d=${sizing.selectedOrifice.dOrificeMm} mm)`;

    document.getElementById('resP1Primary').textContent = fmtPressA(sizing.P1_bara);
    document.getElementById('resP1Secondary').textContent = sizing.Pcf_bara > 0
      ? `P_cf = ${fmtPressA(sizing.Pcf_bara)} (OP ${sizing.overpressurePct}%)`
      : `Overpressure = ${sizing.overpressurePct}%`;

    document.getElementById('resP2Primary').textContent = fmtPressG(sizing.P_backBarg);
    document.getElementById('resP2Secondary').textContent = `${sizing.backpressurePctOfSet.toFixed(1)}% of P_set (P₂/P₁ = ${sizing.absBackpressureRatio.toFixed(3)})`;

    document.getElementById('resFactorsMain').textContent = `Kd=${sizing.Kd.toFixed(3)} · Kb=${sizing.Kb.toFixed(3)}`;
    document.getElementById('resFactorsSub').textContent = sizing.fluidPhase === 'liquid'
      ? `Kc=${sizing.Kc.toFixed(2)} · Kv=${sizing.Kv.toFixed(4)}`
      : (sizing.fluidPhase === 'steam'
        ? `Kn=${sizing.Kn.toFixed(3)} · Ksh=${sizing.Ksh.toFixed(3)}`
        : `Kc=${sizing.Kc.toFixed(2)} · C_SI=${sizing.C_SI.toFixed(4)}`);

    document.getElementById('resRatedCapPrimary').textContent = fmtFlow(sizing.ratedCapacityKgHr);
    document.getElementById('resRatedCapSecondary').textContent = isUSC()
      ? `${Math.round(sizing.ratedCapacityKgHr).toLocaleString()} kg/h (Rated)`
      : `${Math.round(sizing.ratedCapacityLbHr).toLocaleString()} lb/hr (Rated)`;

    // Equation Trace Method Badge
    const methodMap = {
      gas: 'API 520 Pt I §5.6 Gas / Vapor Sizing',
      liquid: 'API 520 Pt I §5.8 Liquid + Viscosity Kv',
      steam: 'API 520 Pt I §5.7 Steam Napier Equation',
      twophase: 'API 520 Pt I Annex C Leung Omega (ω)'
    };
    document.getElementById('eqTraceMethodBadge').textContent = methodMap[sizing.fluidPhase] || 'API 520 Part I';

    // Whitebox Equation Cards
    const stepsContainer = document.getElementById('sizingEquationSteps');
    stepsContainer.innerHTML = sizing.steps.map(s => `
      <div class="eq-step-card">
        <div class="eq-step-header">${s.title}</div>
        <div class="eq-symbolic">${s.formula}</div>
        <div class="eq-substitution">${s.substitution}</div>
        <div class="eq-result">⇒ ${s.result}</div>
      </div>
    `).join('') + `
      <div class="eq-step-card" style="border-left-color:var(--pass-dot);">
        <div class="eq-step-header">Final API 526 Standard Orifice Selection</div>
        <div class="eq-symbolic">Select smallest standard API 526 orifice with A_sel ≥ A_req (${sizing.reqAreaMm2.toFixed(1)} mm² / ${sizing.reqAreaIn2.toFixed(4)} in²)</div>
        <div class="eq-substitution">Selected Orifice "${sizing.selectedOrifice.letter}" → A_sel = ${sizing.selectedOrifice.areaMm2.toFixed(1)} mm² (${sizing.selectedOrifice.areaIn2.toFixed(3)} in²), Flange = ${sizing.selectedOrifice.inletOutFlange}</div>
        <div class="eq-result">⇒ Orifice ${sizing.selectedOrifice.letter} Selected (${sizing.selectedOrifice.utilizationPct.toFixed(1)}% Utilization, W_rated = ${fmtFlow(sizing.ratedCapacityKgHr)})</div>
      </div>
    `;

    renderRadialUtilizationGauge(sizing);
    renderOrificeScaleSvg(sizing);
    renderPressureLadderSvg(sizing);
    renderValveCutawaySvg(sizing);
    renderKbCurveSvg(sizing);
  }

  function renderRadialUtilizationGauge(sizing) {
    const container = document.getElementById('orificeRadialGaugeContainer');
    if (!container) return;
    const pct = Math.min(100, Math.max(2, sizing.selectedOrifice.utilizationPct));
    const r = 24;
    const circ = 2 * Math.PI * r;
    const dashOffset = circ * (1 - pct / 100);
    const strokeColor = pct > 92 ? '#f59e0b' : (pct > 80 ? '#38bdf8' : '#10b981');

    container.innerHTML = `
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="Orifice Utilization Gauge">
        <circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="5.5" />
        <circle cx="32" cy="32" r="${r}" fill="none" stroke="${strokeColor}" stroke-width="5.5"
          stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}"
          stroke-linecap="round" transform="rotate(-90 32 32)" />
        <text x="32" y="34" text-anchor="middle" font-size="11" font-weight="800" fill="#ffffff" font-family="JetBrains Mono">${pct.toFixed(0)}%</text>
        <text x="32" y="44" text-anchor="middle" font-size="6.8" font-weight="600" fill="#94a3b8" font-family="JetBrains Mono">LOAD</text>
      </svg>
    `;
  }

  function renderValveCutawaySvg(sizing) {
    const container = document.getElementById('valveCutawaySvgContainer');
    if (!container) return;
    const vtype = state.tag.valveType;
    const hasDisc = Boolean(state.tag.ruptureDiscUpstream);
    const badge = document.getElementById('valveCutawayBadge');
    if (badge) {
      const labelMap = {
        conventional: 'Conventional Spring-Loaded',
        bellows: 'Balanced Bellows',
        pilot: 'Pilot-Operated (Piston Dome)'
      };
      badge.textContent = (labelMap[vtype] || 'PSV') + (hasDisc ? ' + Rupture Disc' : '');
    }

    // Internal mechanism elements based on valveType
    let upperInternals = '';
    if (vtype === 'conventional') {
      upperInternals = `
        <!-- Conventional Spring Coils & Bonnet Vented to Body -->
        <rect x="132" y="22" width="66" height="68" rx="6" fill="rgba(148,163,184,0.14)" stroke="#0f172a" stroke-width="2" />
        <line x1="165" y1="12" x2="165" y2="108" stroke="#0f172a" stroke-width="3" />
        <path d="M146,34 L184,41 L146,48 L184,55 L146,62 L184,69 L146,76" fill="none" stroke="#0284c7" stroke-width="2.8" />
        <text x="275" y="42" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="800" font-family="JetBrains Mono">CONVENTIONAL BONNET</text>
        <text x="275" y="56" text-anchor="middle" fill="#d97706" font-size="9" font-weight="700" font-family="JetBrains Mono">P_bt acts on Disc Back</text>
        <text x="275" y="70" text-anchor="middle" fill="#64748b" font-size="8.5" font-family="JetBrains Mono">Limit: P_bt ≤ ${sizing.overpressurePct}% of P_set</text>
      `;
    } else if (vtype === 'bellows') {
      upperInternals = `
        <!-- Balanced Bellows + Vented Bonnet -->
        <rect x="132" y="20" width="66" height="72" rx="6" fill="rgba(2,132,199,0.10)" stroke="#0f172a" stroke-width="2" />
        <!-- Atmospheric Bonnet Vent Hole (Left Side) -->
        <line x1="108" y1="48" x2="132" y2="48" stroke="#059669" stroke-width="2.5" />
        <text x="64" y="51" text-anchor="middle" fill="#059669" font-size="8.5" font-weight="800" font-family="JetBrains Mono">BONNET VENT</text>
        <line x1="165" y1="12" x2="165" y2="108" stroke="#0f172a" stroke-width="3" />
        <path d="M148,30 L182,36 L148,42 L182,48 L148,54" fill="none" stroke="#334155" stroke-width="2.2" />
        <!-- Bellows Convolutions Shielding Disc Area -->
        <path d="M144,74 L138,80 L146,85 L138,91 L146,96 L142,104 M186,74 L192,80 L184,85 L192,91 L184,96 L188,104" fill="none" stroke="#059669" stroke-width="2.4" />
        <text x="286" y="34" text-anchor="middle" fill="#059669" font-size="9.5" font-weight="800" font-family="JetBrains Mono">BALANCED BELLOWS</text>
        <text x="286" y="48" text-anchor="middle" fill="#0369a1" font-size="9" font-weight="700" font-family="JetBrains Mono">Isolates Disc from P_bt</text>
        <text x="286" y="62" text-anchor="middle" fill="#64748b" font-size="8.5" font-family="JetBrains Mono">Kb/Kw = ${sizing.Kb.toFixed(3)} (${sizing.backpressurePctOfSet.toFixed(1)}% BP)</text>
      `;
    } else {
      upperInternals = `
        <!-- Pilot-Operated Dome + External Sense Line -->
        <rect x="130" y="26" width="70" height="60" rx="8" fill="rgba(5,150,105,0.14)" stroke="#0f172a" stroke-width="2" />
        <!-- Pilot Control Valve Assembly on Top -->
        <rect x="215" y="18" width="62" height="32" rx="4" fill="#0f172a" />
        <text x="246" y="37" text-anchor="middle" fill="#38bdf8" font-size="9" font-weight="800" font-family="JetBrains Mono">PILOT</text>
        <!-- Sense Tube from Inlet Nozzle to Pilot & Dome -->
        <path d="M138,155 L92,155 L92,34 L215,34 M200,42 L215,42" fill="none" stroke="#0284c7" stroke-width="2" stroke-dasharray="3,2" />
        <rect x="142" y="52" width="46" height="14" rx="2" fill="#059669" />
        <text x="286" y="66" text-anchor="middle" fill="#059669" font-size="9.5" font-weight="800" font-family="JetBrains Mono">PILOT PISTON DOME</text>
        <text x="286" y="80" text-anchor="middle" fill="#64748b" font-size="8.5" font-family="JetBrains Mono">Kb = 1.00 up to 70% BP</text>
      `;
    }

    container.innerHTML = `
      <svg viewBox="0 0 380 205" width="100%" height="205" role="img" aria-label="PSV Mechanical Cutaway Diagram">
        <!-- Valve Body Bowl & Outlet Nozzle -->
        <path d="M122,92 L208,92 L208,104 L288,104 L288,144 L208,144 L208,162 L122,162 Z" fill="rgba(148,163,184,0.16)" stroke="#0f172a" stroke-width="2.2" />
        ${upperInternals}
        <!-- Disc Holder & Lifting Disc -->
        <rect x="140" y="102" width="50" height="12" rx="3" fill="#0284c7" stroke="#0f172a" stroke-width="1.8" />
        <!-- Inlet Nozzle Throat (Orifice d = ${sizing.selectedOrifice.dOrificeMm} mm) -->
        <path d="M136,192 L136,124 L150,118 L180,118 L194,124 L194,192" fill="rgba(2,132,199,0.18)" stroke="#0f172a" stroke-width="2.4" />
        ${hasDisc ? `
          <!-- Upstream Rupture Disc Combination (Kc = 0.90) -->
          <path d="M136,174 Q165,162 194,174" fill="none" stroke="#dc2626" stroke-width="2.8" stroke-dasharray="4,2" />
          <text x="72" y="176" text-anchor="middle" fill="#dc2626" font-size="8.5" font-weight="800" font-family="JetBrains Mono">RUPTURE DISC</text>
          <text x="72" y="187" text-anchor="middle" fill="#dc2626" font-size="8.5" font-weight="700" font-family="JetBrains Mono">(Kc = 0.90)</text>
        ` : ''}
        <!-- Animated Choked Flow Stream through Nozzle & Out Side Branch -->
        <path d="M165,196 L165,122 Q165,112 182,116 L282,124" fill="none" stroke="#0284c7" stroke-width="3.5" class="svg-flow-anim" />
        <polygon points="278,119 290,124 278,129" fill="#0284c7" />
        <!-- Callout Annotations -->
        <text x="64" y="132" text-anchor="middle" fill="#0369a1" font-size="9.5" font-weight="800" font-family="JetBrains Mono">ORIFICE "${sizing.selectedOrifice.letter}"</text>
        <text x="64" y="146" text-anchor="middle" fill="#334155" font-size="8.5" font-family="JetBrains Mono">d = ${sizing.selectedOrifice.dOrificeMm} mm</text>
        <text x="292" y="162" text-anchor="middle" fill="#0f172a" font-size="9" font-weight="700" font-family="JetBrains Mono">OUTLET P₂ = ${fmtPressG(sizing.P_backBarg)}</text>
        <text x="292" y="176" text-anchor="middle" fill="#059669" font-size="9" font-weight="800" font-family="JetBrains Mono">${sizing.selectedOrifice.inletOutFlange}</text>
      </svg>
    `;
  }

  function renderKbCurveSvg(sizing) {
    const container = document.getElementById('kbCurveSvgContainer');
    if (!container) return;

    const xOf = (bpPct) => 42 + (Math.min(60, Math.max(0, bpPct)) / 60) * 310;
    const yOf = (kVal) => 165 - ((Math.min(1.05, Math.max(0.5, kVal)) - 0.5) / 0.55) * 135;

    // Sample points from 0% to 55% backpressure for Bellows Vapor (Kb) and Bellows Liquid (Kw)
    const samplePcts = [0, 10, 15, 20, 25, 30, 32, 35, 38, 40, 45, 50];
    const kbVaporPts = samplePcts.map((pct, i) => {
      const kb = E.computeBackpressureFactor('bellows', pct / 100, sizing.overpressurePct, 'gas');
      return `${i === 0 ? 'M' : 'L'}${xOf(pct).toFixed(1)},${yOf(kb).toFixed(1)}`;
    }).join(' ');

    const kwLiqPts = samplePcts.map((pct, i) => {
      const kw = E.computeBackpressureFactor('bellows', pct / 100, sizing.overpressurePct, 'liquid');
      return `${i === 0 ? 'M' : 'L'}${xOf(pct).toFixed(1)},${yOf(kw).toFixed(1)}`;
    }).join(' ');

    const curBpPct = Math.min(58, Math.max(0, sizing.backpressurePctOfSet));
    const curK = Math.min(1.0, Math.max(0.52, sizing.Kb));
    const cx = xOf(curBpPct);
    const cy = yOf(curK);

    container.innerHTML = `
      <svg viewBox="0 0 380 205" width="100%" height="205" role="img" aria-label="API 520 Backpressure Correction Curve">
        <!-- Axes & Grid -->
        <line x1="42" y1="22" x2="42" y2="165" stroke="#64748b" stroke-width="1.5" />
        <line x1="42" y1="165" x2="356" y2="165" stroke="#64748b" stroke-width="1.5" />
        <line x1="42" y1="${yOf(1.0).toFixed(1)}" x2="356" y2="${yOf(1.0).toFixed(1)}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3,3" />
        <text x="36" y="${(yOf(1.0) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">1.0</text>
        <text x="36" y="${(yOf(0.8) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">0.8</text>
        <text x="36" y="${(yOf(0.6) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">0.6</text>

        <!-- X-axis Ticks (0%, 15%, 30%, 50% of P_set) -->
        <text x="${xOf(0).toFixed(1)}" y="178" text-anchor="middle" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">0%</text>
        <text x="${xOf(15).toFixed(1)}" y="178" text-anchor="middle" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">15%</text>
        <text x="${xOf(30).toFixed(1)}" y="178" text-anchor="middle" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">30%</text>
        <text x="${xOf(50).toFixed(1)}" y="178" text-anchor="middle" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">50% P_set</text>

        <!-- Pilot Operated Flat Line (Kb = 1.0) -->
        <line x1="${xOf(0).toFixed(1)}" y1="${yOf(1.0).toFixed(1)}" x2="${xOf(55).toFixed(1)}" y2="${yOf(1.0).toFixed(1)}" stroke="#059669" stroke-width="2" stroke-dasharray="5,3" />
        <!-- Bellows Gas Kb Curve -->
        <path d="${kbVaporPts}" fill="none" stroke="#0284c7" stroke-width="2.6" />
        <!-- Bellows Liquid Kw Curve -->
        <path d="${kwLiqPts}" fill="none" stroke="#d97706" stroke-width="2.2" />

        <!-- Live Operating Point Marker -->
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="rgba(220,38,38,0.25)" class="svg-pulse-dot" />
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#dc2626" stroke="#ffffff" stroke-width="1.5" />
        <rect x="${Math.min(220, Math.max(46, cx - 65)).toFixed(1)}" y="${Math.max(18, cy - 26).toFixed(1)}" width="138" height="16" rx="3" fill="#ffffff" stroke="#fca5a5" />
        <text x="${Math.min(289, Math.max(115, cx + 4)).toFixed(1)}" y="${Math.max(29, cy - 15).toFixed(1)}" text-anchor="middle" font-size="8.8" font-weight="800" fill="#dc2626" font-family="JetBrains Mono">BP=${sizing.backpressurePctOfSet.toFixed(1)}% → K=${sizing.Kb.toFixed(3)}</text>

        <text x="200" y="196" text-anchor="middle" font-size="8.8" font-weight="700" fill="#475569" font-family="JetBrains Mono">Blue: Vapor Kb · Amber: Liquid Kw · Green: Pilot (1.00)</text>
      </svg>
    `;
  }

  function renderOrificeScaleSvg(sizing) {
    const container = document.getElementById('orificeScaleContainer');
    const orifices = E.API_526_ORIFICES;
    const maxLog = Math.log10(orifices[orifices.length - 1].areaMm2);
    const minLog = Math.log10(45);

    const barsHtml = orifices.map((o, idx) => {
      const x = 28 + idx * 24;
      const normH = ((Math.log10(o.areaMm2) - minLog) / (maxLog - minLog)) * 135;
      const y = 165 - normH;
      const isSelected = o.letter === sizing.selectedOrifice.letter;
      const fill = isSelected ? '#0284c7' : (o.areaMm2 < sizing.reqAreaMm2 ? '#cbd5e1' : '#94a3b8');
      return `
        <g>
          <rect x="${x}" y="${y.toFixed(1)}" width="16" height="${normH.toFixed(1)}" rx="2" fill="${fill}" />
          <text x="${x + 8}" y="182" text-anchor="middle" font-size="10" font-weight="${isSelected ? '800' : '600'}" fill="${isSelected ? '#0284c7' : '#475569'}" font-family="JetBrains Mono">${o.letter}</text>
          ${isSelected ? `<text x="${x + 8}" y="${Math.max(14, y - 6).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#0284c7" font-family="JetBrains Mono">★</text>` : ''}
        </g>
      `;
    }).join('');

    const reqClamp = Math.max(50, Math.min(orifices[orifices.length - 1].areaMm2, sizing.reqAreaMm2));
    const reqY = 165 - ((Math.log10(reqClamp) - minLog) / (maxLog - minLog)) * 135;

    container.innerHTML = `
      <svg viewBox="0 0 380 195" width="100%" height="195" role="img" aria-label="API 526 Orifice Scale D to T">
        <line x1="20" y1="165" x2="368" y2="165" stroke="#64748b" stroke-width="1.5" />
        ${barsHtml}
        <line x1="20" y1="${reqY.toFixed(1)}" x2="368" y2="${reqY.toFixed(1)}" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="4,3" />
        <rect x="24" y="${Math.max(4, reqY - 16).toFixed(1)}" width="148" height="15" rx="2" fill="#fef2f2" stroke="#fca5a5" />
        <text x="30" y="${Math.max(15, reqY - 5).toFixed(1)}" font-size="9.5" font-weight="700" fill="#991b1b" font-family="JetBrains Mono">A_req = ${sizing.reqAreaMm2.toFixed(0)} mm² (${sizing.reqAreaIn2.toFixed(2)} in²)</text>
      </svg>
    `;
  }

  function renderPressureLadderSvg(sizing) {
    const container = document.getElementById('pressureLadderContainer');
    const P_max = Math.max(1, sizing.P1_bara * 1.12);
    const yScale = (pBara) => 170 - Math.min(145, Math.max(10, (pBara / P_max) * 145));

    const yP1 = yScale(sizing.P1_bara);
    const yPset = yScale(sizing.P_setBarg + state.tag.atmPressureBara);
    const yPop = yScale(state.tag.operatingPressureBarg + state.tag.atmPressureBara);
    const yPcf = sizing.Pcf_bara > 0 ? yScale(sizing.Pcf_bara) : null;
    const yP2 = yScale(sizing.P2_bara);

    container.innerHTML = `
      <svg viewBox="0 0 380 195" width="100%" height="195" role="img" aria-label="Pressure Relationship Ladder">
        <!-- Left Column: Upstream Vessel Pressures -->
        <line x1="40" y1="${yP1}" x2="175" y2="${yP1}" stroke="#dc2626" stroke-width="2.5" />
        <text x="42" y="${yP1 - 5}" font-size="10" font-weight="700" fill="#dc2626" font-family="JetBrains Mono">P₁ Relieving: ${fmtPressA(sizing.P1_bara)}</text>

        <line x1="40" y1="${yPset}" x2="175" y2="${yPset}" stroke="#d97706" stroke-width="2" />
        <text x="42" y="${yPset - 5}" font-size="10" font-weight="700" fill="#d97706" font-family="JetBrains Mono">P_set / MAWP: ${fmtPressG(sizing.P_setBarg)}</text>

        <line x1="40" y1="${yPop}" x2="175" y2="${yPop}" stroke="#0284c7" stroke-width="2" />
        <text x="42" y="${yPop + 13}" font-size="10" font-weight="600" fill="#0284c7" font-family="JetBrains Mono">P_op Normal: ${fmtPressG(state.tag.operatingPressureBarg)}</text>

        <!-- Right Column: Nozzle Choking & Backpressure -->
        ${yPcf !== null ? `
          <line x1="205" y1="${yPcf}" x2="355" y2="${yPcf}" stroke="#059669" stroke-width="2" stroke-dasharray="4,3" />
          <text x="207" y="${yPcf - 5}" font-size="10" font-weight="700" fill="#059669" font-family="JetBrains Mono">P_cf Choke: ${fmtPressA(sizing.Pcf_bara)}</text>
        ` : ''}

        <line x1="205" y1="${yP2}" x2="355" y2="${yP2}" stroke="#475569" stroke-width="2.5" />
        <text x="207" y="${yP2 + 14}" font-size="10" font-weight="700" fill="#334155" font-family="JetBrains Mono">P₂ Backpress: ${fmtPressA(sizing.P2_bara)}</text>

        <!-- Center Divider -->
        <line x1="190" y1="20" x2="190" y2="175" stroke="#cbd5e1" stroke-width="1.5" />
        <text x="105" y="188" text-anchor="middle" font-size="9.5" font-weight="700" fill="#64748b" font-family="JetBrains Mono">UPSTREAM VESSEL</text>
        <text x="280" y="188" text-anchor="middle" font-size="9.5" font-weight="700" fill="#64748b" font-family="JetBrains Mono">NOZZLE / TAILPIPE</text>
      </svg>
    `;
  }

  // =========================================================================
  // 5. STEP 3: API 520 PART II INLET & OUTLET LINE HYDRAULICS
  // =========================================================================

  function renderHydraulicsOutputs(sizing, hyd) {
    const inPass = hyd.inlet.passes3Pct;
    const outPass = hyd.outlet.passesBackpressure && hyd.outlet.passesMach;

    // Update Top Ribbon Badges
    const ribIn = document.getElementById('ribbonInletBadge');
    ribIn.className = `status-badge ${inPass ? 'status-pass' : 'status-fail'}`;
    ribIn.textContent = `${hyd.inlet.lossPctOfSet.toFixed(2)}% ${inPass ? '≤ 3% PASS' : '> 3% FAIL'}`;

    const ribOut = document.getElementById('ribbonOutletBadge');
    ribOut.className = `status-badge ${outPass ? 'status-pass' : 'status-fail'}`;
    ribOut.textContent = `${hyd.outlet.totalBackPctOfSet.toFixed(1)}% ${outPass ? 'PASS' : 'CHECK'}`;

    // Header Badges on Step 3 Panels
    const inHeaderBadge = document.getElementById('inletStatusHeaderBadge');
    inHeaderBadge.className = `status-badge ${inPass ? 'status-pass' : 'status-fail'}`;
    inHeaderBadge.textContent = `ΔP_in = ${hyd.inlet.lossPctOfSet.toFixed(2)}% ${inPass ? '≤ 3.0% PASS' : '> 3.0% CHATTER RISK'}`;

    const outHeaderBadge = document.getElementById('outletStatusHeaderBadge');
    outHeaderBadge.className = `status-badge ${outPass ? 'status-pass' : 'status-fail'}`;
    outHeaderBadge.textContent = `P_bt = ${hyd.outlet.totalBackPctOfSet.toFixed(1)}% (Limit ${hyd.outlet.maxAllowedBackPct}%) · Ma=${hyd.outlet.machNumber.toFixed(2)}`;

    // Sync Built-Up Backpressure display
    document.getElementById('syncBuiltUpVal').textContent = fmtPressG(hyd.outlet.builtUpBackBarg);

    // Inlet Metrics Grid
    document.getElementById('inletMetricsGrid').innerHTML = `
      <div class="metric-box">
        <span class="metric-box-label">Inlet Pressure Loss (ΔP_in)</span>
        <span class="metric-box-main" style="color:${inPass ? 'var(--pass-text)' : 'var(--fail-text)'};">${hyd.inlet.lossPctOfSet.toFixed(2)}% of P_set</span>
        <span class="metric-box-sub">${fmtDP(hyd.inlet.dP_totalBar)} (Limit: ≤ 3.0%)</span>
      </div>
      <div class="metric-box">
        <span class="metric-box-label">Pipe ID &amp; Velocity</span>
        <span class="metric-box-main">${hyd.inlet.velocityMS.toFixed(1)} m/s</span>
        <span class="metric-box-sub">ID = ${hyd.inlet.idMm.toFixed(1)} mm (${hyd.inlet.velocityFtS.toFixed(1)} ft/s)</span>
      </div>
      <div class="metric-box">
        <span class="metric-box-label">Friction &amp; Total K</span>
        <span class="metric-box-main">K_tot = ${hyd.inlet.K_total.toFixed(2)}</span>
        <span class="metric-box-sub">f_D = ${hyd.inlet.fDarcy.toFixed(4)} · Re = ${hyd.inlet.Re.toExponential(2)}</span>
      </div>
    `;

    // Inlet Multi-NPS Comparison Table
    const npsTbody = document.getElementById('inletNpsComparisonTbody');
    npsTbody.innerHTML = hyd.inletNpsComparison.slice(0, 9).map(row => {
      const isCurrent = row.nps === hyd.inlet.nps;
      return `
        <tr class="${isCurrent ? 'row-governing' : ''}" style="cursor:pointer;" data-nps="${row.nps}">
          <td class="mono" style="font-weight:700;">${row.nps} ${isCurrent ? '(Selected)' : ''}</td>
          <td class="mono">${row.idMm.toFixed(1)}</td>
          <td class="mono">${row.velocityMS.toFixed(1)}</td>
          <td class="mono">${fmtDP(row.dPBar)}</td>
          <td class="mono" style="font-weight:700;">${row.lossPct.toFixed(2)}%</td>
          <td>
            <span class="status-badge ${row.passes ? 'status-pass' : 'status-fail'}">
              ${row.passes ? 'PASS ≤ 3%' : 'FAIL > 3%'}
            </span>
          </td>
        </tr>
      `;
    }).join('');

    npsTbody.querySelectorAll('tr[data-nps]').forEach(tr => {
      tr.addEventListener('click', () => {
        document.getElementById('inpInletNps').value = tr.dataset.nps;
        readDomInputsToTag();
        recomputeAll();
      });
    });

    // Outlet Metrics Grid
    document.getElementById('outletMetricsGrid').innerHTML = `
      <div class="metric-box">
        <span class="metric-box-label">Built-Up Backpressure</span>
        <span class="metric-box-main">${fmtPressG(hyd.outlet.builtUpBackBarg, 2)}</span>
        <span class="metric-box-sub">Superimposed: ${fmtPressG(hyd.outlet.superimposedBackBarg, 2)}</span>
      </div>
      <div class="metric-box">
        <span class="metric-box-label">Total Backpressure (P_bt)</span>
        <span class="metric-box-main" style="color:${hyd.outlet.passesBackpressure ? 'var(--pass-text)' : 'var(--fail-text)'};">${hyd.outlet.totalBackPctOfSet.toFixed(1)}% of P_set</span>
        <span class="metric-box-sub">${fmtPressG(hyd.outlet.totalBackBarg, 2)} (Allowable ≤ ${hyd.outlet.maxAllowedBackPct}%)</span>
      </div>
      <div class="metric-box">
        <span class="metric-box-label">Exit Mach &amp; Velocity</span>
        <span class="metric-box-main" style="color:${hyd.outlet.passesMach ? 'var(--pass-text)' : 'var(--warn-text)'};">${sizing.fluidPhase === 'gas' || sizing.fluidPhase === 'steam' ? 'Ma = ' + hyd.outlet.machNumber.toFixed(2) : 'N/A (non-vapor)'}</span>
        <span class="metric-box-sub">v_exit = ${hyd.outlet.exitVelocityMS.toFixed(1)} m/s at header (Target Ma ≤ 0.70)</span>
      </div>
      <div class="metric-box">
        <span class="metric-box-label">Reaction Force (open discharge)</span>
        <span class="metric-box-main">${hyd.outlet.reactionForceKn.toFixed(2)} kN</span>
        <span class="metric-box-sub">${Math.round(hyd.outlet.reactionForceLbf).toLocaleString()} lbf · P_exit = ${fmtPressA(hyd.outlet.exitPressureBara)}</span>
      </div>
      ${hyd.outlet.compressibleWarning ? `<div class="metric-box" style="grid-column:1/-1;background:var(--warn-bg);border-color:var(--warn-border);color:var(--warn-text);font-size:0.78rem;font-weight:600;">⚠ ${hyd.outlet.compressibleWarning}</div>` : ''}
    `;

    // Hydraulic Equation Trace
    document.getElementById('hydraulicEquationSteps').innerHTML = `
      <div class="eq-step-card">
        <div class="eq-step-header">1. Darcy-Weisbach Inlet Line Loss (API 520 Part II)</div>
        <div class="eq-symbolic">ΔP_in = [ f × (L_in / D_in) + ΣK_in ] × (ρ_in × v_in² / 2) ≤ 0.03 × P_set</div>
        <div class="eq-substitution">W_eval = ${fmtFlow(hyd.W_evalKgHr)} (${hyd.flowBasis.toUpperCase()}) | ρ_in = ${hyd.rhoInletKgM3.toFixed(2)} kg/m³ | K_tot = ${hyd.inlet.K_total.toFixed(2)}</div>
        <div class="eq-result">⇒ ΔP_in = ${fmtDP(hyd.inlet.dP_totalBar)} (${hyd.inlet.lossPctOfSet.toFixed(2)}% of P_set) — ${inPass ? 'COMPLIANT (≤ 3%)' : 'EXCEEDS 3% LIMIT (Select ' + hyd.inlet.recommendedNps + ')'}</div>
      </div>
      <div class="eq-step-card">
        <div class="eq-step-header">2. Tailpipe Built-Up Backpressure</div>
        <div class="eq-symbolic">P_bt = P_superimposed + ΔP_out   (vapor density iterated at mean tailpipe pressure)</div>
        <div class="eq-substitution">P_bt = ${hyd.outlet.superimposedBackBarg.toFixed(2)} + ${hyd.outlet.builtUpBackBarg.toFixed(2)} = ${hyd.outlet.totalBackBarg.toFixed(2)} barg (${hyd.outlet.totalBackPctOfSet.toFixed(1)}% of P_set) · ρ_out,avg = ${hyd.rhoOutletKgM3.toFixed(2)} kg/m³</div>
        <div class="eq-result">⇒ ${hyd.outlet.passesBackpressure ? 'Within' : 'EXCEEDS'} ${hyd.outlet.maxAllowedBackPct}% limit for selected valve type</div>
      </div>
      <div class="eq-step-card">
        <div class="eq-step-header">3. Reaction Force — Open Discharge to Atmosphere (API 520 Part II)</div>
        <div class="eq-symbolic">F = W·v_exit + A_exit·(P_exit − P_atm)   (vapor: sonic exit, T* = 2T₁/(k+1))</div>
        <div class="eq-substitution">Applies to vent stacks / open tailpipes. Closed discharge to a flare header has no steady-state thrust at the tailpipe outlet.</div>
        <div class="eq-result">⇒ F_r = ${hyd.outlet.reactionForceKn.toFixed(2)} kN (${Math.round(hyd.outlet.reactionForceLbf).toLocaleString()} lbf)</div>
      </div>
    `;

    renderPipingSchematicSvg(sizing, hyd);
    renderHydraulicPressureProfileSvg(sizing, hyd);
  }

  function renderPipingSchematicSvg(sizing, hyd) {
    const inPass = hyd.inlet.passes3Pct;
    const outPass = hyd.outlet.passesBackpressure;
    const container = document.getElementById('pipingSchematicSvgContainer');

    container.innerHTML = `
      <svg viewBox="0 0 920 175" width="100%" height="175" role="img" aria-label="Inlet PSV Outlet Piping Schematic">
        <!-- Protected Vessel on Left -->
        <rect x="20" y="25" width="145" height="125" rx="18" fill="rgba(2,132,199,0.12)" stroke="#0369a1" stroke-width="2.5" />
        <text x="92" y="58" text-anchor="middle" font-size="11" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">${escapeHtml(String(state.tag.equipmentProtected).slice(0, 18))}</text>
        <text x="92" y="80" text-anchor="middle" font-size="10.5" font-weight="700" fill="#0369a1" font-family="JetBrains Mono">P_set = ${fmtPressG(sizing.P_setBarg)}</text>
        <text x="92" y="100" text-anchor="middle" font-size="10" fill="#334155" font-family="JetBrains Mono">P₁ = ${fmtPressA(sizing.P1_bara)}</text>
        <text x="92" y="122" text-anchor="middle" font-size="9.5" fill="#64748b" font-family="JetBrains Mono">T₁ = ${fmtTemp(sizing.T1_C)}</text>

        <!-- Inlet Pipe Segment + Animated Flow Stream -->
        <line x1="165" y1="88" x2="395" y2="88" stroke="${inPass ? '#059669' : '#dc2626'}" stroke-width="9" />
        <line x1="165" y1="88" x2="395" y2="88" stroke="#ffffff" stroke-width="2.5" class="svg-flow-anim" opacity="0.85" />
        <rect x="185" y="24" width="190" height="48" rx="4" fill="#ffffff" stroke="${inPass ? '#6ee7b7' : '#fca5a5'}" stroke-width="1.5" />
        <text x="280" y="42" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">INLET: ${hyd.inlet.nps} ${hyd.inlet.schedule}</text>
        <text x="280" y="60" text-anchor="middle" font-size="10" font-weight="700" fill="${inPass ? '#059669' : '#dc2626'}" font-family="JetBrains Mono">ΔP_in = ${hyd.inlet.lossPctOfSet.toFixed(2)}% (≤ 3.0%)</text>
        <text x="280" y="114" text-anchor="middle" font-size="9.5" fill="#475569" font-family="JetBrains Mono">L=${hyd.inlet.lengthM}m · v=${hyd.inlet.velocityMS.toFixed(1)} m/s · ΣK=${hyd.inlet.K_fittings}</text>

        <!-- PSV Symbol in Center -->
        <polygon points="395,68 435,88 395,108" fill="#0284c7" stroke="#0f172a" stroke-width="2" />
        <polygon points="435,88 455,128 415,128" fill="#0284c7" stroke="#0f172a" stroke-width="2" />
        <line x1="435" y1="88" x2="435" y2="38" stroke="#0f172a" stroke-width="3" />
        <rect x="412" y="18" width="46" height="22" rx="3" fill="#0f172a" />
        <text x="435" y="33" text-anchor="middle" font-size="11" font-weight="800" fill="#38bdf8" font-family="JetBrains Mono">ORIF ${sizing.selectedOrifice.letter}</text>
        <text x="435" y="148" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">${escapeHtml(state.tag.tagNumber)} (${sizing.selectedOrifice.inletOutFlange})</text>

        <!-- Outlet Pipe Segment + Animated Flow Stream -->
        <line x1="455" y1="108" x2="735" y2="108" stroke="${outPass ? '#0284c7' : '#d97706'}" stroke-width="10" />
        <line x1="455" y1="108" x2="735" y2="108" stroke="#e0f2fe" stroke-width="2.8" class="svg-flow-anim" opacity="0.9" />
        <rect x="490" y="24" width="220" height="62" rx="4" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
        <text x="600" y="42" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">OUTLET: ${hyd.outlet.nps} ${hyd.outlet.schedule}</text>
        <text x="600" y="59" text-anchor="middle" font-size="10" font-weight="700" fill="${outPass ? '#059669' : '#dc2626'}" font-family="JetBrains Mono">P_bt = ${hyd.outlet.totalBackPctOfSet.toFixed(1)}% of P_set (Ma=${hyd.outlet.machNumber.toFixed(2)})</text>
        <text x="600" y="76" text-anchor="middle" font-size="9.5" fill="#475569" font-family="JetBrains Mono">Reaction Force F_r = ${hyd.outlet.reactionForceKn.toFixed(2)} kN (${Math.round(hyd.outlet.reactionForceLbf)} lbf)</text>

        <!-- Flare / Relief Header on Right -->
        <rect x="735" y="35" width="165" height="110" rx="10" fill="rgba(15,23,42,0.06)" stroke="#334155" stroke-width="2" />
        <text x="817" y="68" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">FLARE / RELIEF HEADER</text>
        <text x="817" y="90" text-anchor="middle" font-size="10" fill="#334155" font-family="JetBrains Mono">P_super = ${fmtPressG(hyd.outlet.superimposedBackBarg)}</text>
        <text x="817" y="110" text-anchor="middle" font-size="10" fill="#0369a1" font-family="JetBrains Mono">ΔP_built = ${fmtPressG(hyd.outlet.builtUpBackBarg)}</text>
        <text x="817" y="130" text-anchor="middle" font-size="10" font-weight="700" fill="#0f172a" font-family="JetBrains Mono">P_total = ${fmtPressG(hyd.outlet.totalBackBarg)}</text>
      </svg>
    `;
  }

  function renderHydraulicPressureProfileSvg(sizing, hyd) {
    const container = document.getElementById('hydraulicPressureProfileSvgContainer');
    if (!container) return;

    const pAtm = state.tag.atmPressureBara || 1.01325;
    const pVesselBara = sizing.P1_bara;
    const pInletFlangeBara = Math.max(pAtm, pVesselBara - hyd.inlet.dP_totalBar);
    const pNozzleThroatBara = sizing.Pcf_bara > 0
      ? Math.max(sizing.Pcf_bara, pAtm + hyd.outlet.totalBackBarg)
      : (pInletFlangeBara + pAtm + hyd.outlet.totalBackBarg) * 0.5;
    const pOutletBodyBara = pAtm + hyd.outlet.totalBackBarg;
    const pHeaderBara = pAtm + hyd.outlet.superimposedBackBarg;

    const pMax = Math.max(2, pVesselBara * 1.12);
    const yOf = (pBara) => 122 - Math.min(96, Math.max(6, (pBara / pMax) * 96));

    const nodes = [
      { x: 95, p: pVesselBara, label: '1. Vessel (P₁)', val: fmtPressA(pVesselBara), color: '#0369a1' },
      { x: 280, p: pInletFlangeBara, label: `2. PSV Inlet (ΔP=${hyd.inlet.lossPctOfSet.toFixed(2)}%)`, val: fmtPressA(pInletFlangeBara), color: hyd.inlet.passes3Pct ? '#059669' : '#dc2626' },
      { x: 460, p: pNozzleThroatBara, label: '3. Orifice Throat (P_cf)', val: fmtPressA(pNozzleThroatBara), color: '#d97706' },
      { x: 645, p: pOutletBodyBara, label: `4. Tailpipe In (P_bt=${hyd.outlet.totalBackPctOfSet.toFixed(1)}%)`, val: fmtPressA(pOutletBodyBara), color: '#0284c7' },
      { x: 825, p: pHeaderBara, label: '5. Flare Header (P_bs)', val: fmtPressA(pHeaderBara), color: '#475569' }
    ];

    const polyPoints = nodes.map(n => `${n.x},${yOf(n.p).toFixed(1)}`).join(' ');
    const areaPoints = `95,122 ${polyPoints} 825,122`;

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
        <span style="font-size:0.74rem;font-weight:700;color:var(--text-secondary);">Axial System Pressure Profile Along Relief Path (Vessel → Inlet Line → PSV Nozzle → Tailpipe → Header)</span>
        <span class="mono" style="font-size:0.71rem;color:var(--text-muted);">Flow Basis: ${fmtFlow(hyd.W_evalKgHr)} (${hyd.flowBasis.toUpperCase()})</span>
      </div>
      <svg viewBox="0 0 920 148" width="100%" height="148" role="img" aria-label="Axial Hydraulic Pressure Profile Chart">
        <line x1="55" y1="122" x2="865" y2="122" stroke="#64748b" stroke-width="1.5" />
        <polygon points="${areaPoints}" fill="rgba(2,132,199,0.10)" />
        <polyline points="${polyPoints}" fill="none" stroke="#0284c7" stroke-width="2.8" />
        ${nodes.map(n => {
          const y = yOf(n.p);
          return `
            <g>
              <line x1="${n.x}" y1="${y.toFixed(1)}" x2="${n.x}" y2="122" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3,3" />
              <circle cx="${n.x}" cy="${y.toFixed(1)}" r="4.5" fill="${n.color}" stroke="#ffffff" stroke-width="1.5" />
              <text x="${n.x}" y="${Math.max(14, y - 8).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="${n.color}" font-family="JetBrains Mono">${n.val}</text>
              <text x="${n.x}" y="138" text-anchor="middle" font-size="9" font-weight="700" fill="#334155" font-family="JetBrains Mono">${n.label}</text>
            </g>
          `;
        }).join('')}
      </svg>
    `;
  }

  // =========================================================================
  // 5B. STEP 4: PUMP & PROCESS LINE HYDRAULICS (API 610 / API 14E / IEC 60534)
  // =========================================================================

  function renderPumpOutputs(pumpRes) {
    const p = state.pumpLoop;
    const npshOk = pumpRes.npsh.compliant;
    const badge = document.getElementById('pumpNpshStatusBadge');
    if (badge) {
      badge.className = `status-badge ${npshOk ? 'status-pass' : 'status-fail'}`;
      badge.textContent = npshOk
        ? `NPSHa = ${fmtHead(pumpRes.npsh.npshaM, 2)} ≥ NPSHr (${fmtHead(pumpRes.npsh.npshrM, 2)}) PASS`
        : `NPSHa = ${fmtHead(pumpRes.npsh.npshaM, 2)} < NPSHr + Margin CAVITATION RISK`;
    }

    // 1. Pump Metrics Summary Grid
    const metricsGrid = document.getElementById('pumpMetricsSummaryGrid');
    if (metricsGrid) {
      metricsGrid.innerHTML = `
        <div class="metric-box">
          <span class="metric-box-label">Rated Flow &amp; Mass Rate</span>
          <span class="metric-box-main">${fmtVolFlow(pumpRes.Q_ratedM3Hr)}</span>
          <span class="metric-box-sub">Norm: ${fmtVolFlow(pumpRes.Q_normM3Hr)} · ${fmtFlow(pumpRes.W_ratedKgHr)}</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">Total Differential Head (TDH)</span>
          <span class="metric-box-main" style="color:var(--accent-primary);">${fmtHead(pumpRes.pump.tdhRatedM)}</span>
          <span class="metric-box-sub">ΔP = ${fmtDP(pumpRes.pump.diffPressureRatedBar, 2)} (Shutoff: ${fmtPressG(pumpRes.pump.maxDischargeBarg)})</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">NPSHa vs. NPSHr (API 610)</span>
          <span class="metric-box-main" style="color:${npshOk ? 'var(--pass-text)' : 'var(--fail-text)'};">${fmtHead(pumpRes.npsh.npshaM, 2)}</span>
          <span class="metric-box-sub">NPSHr = ${fmtHead(pumpRes.npsh.npshrM, 2)} · Margin = ${fmtHead(pumpRes.npsh.marginM, 2)}</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">Shaft Power &amp; API 610 Motor</span>
          <span class="metric-box-main">${pumpRes.pump.brakePowerKw.toFixed(1)} kW (${pumpRes.pump.brakePowerHp.toFixed(1)} hp)</span>
          <span class="metric-box-sub">Hyd: ${pumpRes.pump.hydraulicPowerKw.toFixed(1)} kW · Motor: <strong>${pumpRes.pump.selectedMotorKw} kW</strong></span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">Suction Nozzle &amp; Velocity</span>
          <span class="metric-box-main" style="color:${pumpRes.suction.velCompliant ? 'var(--pass-text)' : 'var(--warn-text)'};">${pumpRes.suction.velocityMS.toFixed(2)} m/s</span>
          <span class="metric-box-sub">P_suc = ${fmtPressG(pumpRes.suction.nozzleBarg)} · ΔP/100m = ${fmtDP(pumpRes.suction.dpPer100mBar, 3)}</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">Discharge Nozzle &amp; API 14E Vel</span>
          <span class="metric-box-main" style="color:${pumpRes.discharge.velCompliant ? 'var(--pass-text)' : 'var(--warn-text)'};">${pumpRes.discharge.velocityMS.toFixed(2)} m/s</span>
          <span class="metric-box-sub">P_dis = ${fmtPressG(pumpRes.discharge.nozzleBarg)} · v_e = ${pumpRes.discharge.vErosionalMS.toFixed(1)} m/s</span>
        </div>
      `;
    }

    // 2. Control Valve Envelope Table (Min / Normal / Rated)
    const cvContainer = document.getElementById('pumpCvTableContainer');
    if (cvContainer) {
      const cv = pumpRes.controlValve;
      cvContainer.innerHTML = `
        <table class="eng-table" style="font-size:0.75rem;">
          <thead>
            <tr>
              <th>Case</th>
              <th>Flow</th>
              <th>ΔP_CV</th>
              <th>Req. Cv</th>
              <th>% of Max Cv (${cv.selectedMaxCv})</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="mono"><strong>Min (${p.minFlowPct || 30}%)</strong></td>
              <td class="mono">${fmtVolFlow(cv.min.flowM3Hr)}</td>
              <td class="mono">${fmtDP(cv.min.availableCvDpBar, 2)}</td>
              <td class="mono" style="font-weight:700;">${cv.min.reqCv.toFixed(1)}</td>
              <td class="mono">${cv.min.pctOfSelectedCv.toFixed(1)}%</td>
            </tr>
            <tr class="row-governing">
              <td class="mono"><strong>Normal (100%)</strong></td>
              <td class="mono">${fmtVolFlow(cv.normal.flowM3Hr)}</td>
              <td class="mono">${fmtDP(cv.normal.availableCvDpBar, 2)}</td>
              <td class="mono" style="font-weight:800;color:var(--accent-primary);">${cv.normal.reqCv.toFixed(1)}</td>
              <td class="mono" style="font-weight:700;">${cv.normal.pctOfSelectedCv.toFixed(1)}%</td>
            </tr>
            <tr>
              <td class="mono"><strong>Rated (${100 + Number(p.ratedMarginPct)}%)</strong></td>
              <td class="mono">${fmtVolFlow(cv.rated.flowM3Hr)}</td>
              <td class="mono">${fmtDP(cv.rated.availableCvDpBar, 2)}</td>
              <td class="mono" style="font-weight:700;">${cv.rated.reqCv.toFixed(1)}</td>
              <td class="mono">
                <span class="status-badge ${cv.controllabilityPass ? 'status-pass' : 'status-warn'}">${cv.rated.pctOfSelectedCv.toFixed(1)}%</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.45rem;">
          Allocated Rated ΔP_CV = <strong>${fmtDP(cv.allocatedDpRatedBar, 2)}</strong> (${cv.pctOfDynamic.toFixed(1)}% of total dynamic drop). Target Cv opening: 20%–90%.
        </div>
      `;
    }

    // 3. Suction & Discharge Multi-NPS Line Sizing Table
    const lineTbody = document.getElementById('pumpLineSizingTbody');
    if (lineTbody) {
      lineTbody.innerHTML = pumpRes.pipeSizingComparison.slice(1, 9).map(row => {
        const isSuc = row.nps === pumpRes.suction.nps;
        const isDis = row.nps === pumpRes.discharge.nps;
        return `
          <tr class="${isSuc || isDis ? 'row-governing' : ''}">
            <td class="mono" style="font-weight:800;">
              ${row.nps}
              ${isSuc ? '<span class="status-badge status-pass" style="margin-left:3px;">SUC</span>' : ''}
              ${isDis ? '<span class="status-badge status-warn" style="margin-left:3px;">DIS</span>' : ''}
            </td>
            <td class="mono">${row.sucIdMm.toFixed(1)}</td>
            <td class="mono" style="color:${row.sucOk ? 'var(--pass-text)' : 'var(--fail-text)'};font-weight:700;">${row.sucVelMS.toFixed(2)}</td>
            <td class="mono">${fmtDP(row.sucDp100mBar, 3)}</td>
            <td class="mono" style="color:${row.disOk ? 'var(--pass-text)' : 'var(--fail-text)'};font-weight:700;">${row.disVelMS.toFixed(2)}</td>
            <td class="mono">${fmtDP(row.disDp100mBar, 3)}</td>
            <td>
              <div style="display:flex;gap:0.3rem;">
                <button type="button" class="btn btn-secondary btn-set-pump-suc" data-nps='${row.nps}' style="padding:0.18rem 0.45rem;font-size:0.7rem;">Set Suc</button>
                <button type="button" class="btn btn-secondary btn-set-pump-dis" data-nps='${row.nps}' style="padding:0.18rem 0.45rem;font-size:0.7rem;">Set Dis</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      lineTbody.querySelectorAll('.btn-set-pump-suc').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('inpPumpSucNps').value = btn.dataset.nps;
          readDomInputsToPump();
          recomputeAll();
        });
      });
      lineTbody.querySelectorAll('.btn-set-pump-dis').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('inpPumpDisNps').value = btn.dataset.nps;
          readDomInputsToPump();
          recomputeAll();
        });
      });
    }

    // 4. Whitebox Equation Steps
    const eqContainer = document.getElementById('pumpEquationSteps');
    if (eqContainer) {
      eqContainer.innerHTML = pumpRes.steps.map(s => `
        <div class="eq-step-card">
          <div class="eq-step-header">${s.title}</div>
          <div class="eq-symbolic">${s.formula}</div>
          <div class="eq-substitution">${s.substitution}</div>
          <div class="eq-result">⇒ ${s.result}</div>
        </div>
      `).join('');
    }

    renderPumpSchematicSvg(pumpRes);
    renderPumpCurveSvg(pumpRes);
    renderPumpWaterfallSvg(pumpRes);
  }

  function renderPumpSchematicSvg(pumpRes) {
    const container = document.getElementById('pumpSchematicSvgContainer');
    if (!container) return;
    const p = state.pumpLoop;
    const npshOk = pumpRes.npsh.compliant;

    container.innerHTML = `
      <svg viewBox="0 0 920 182" width="100%" height="182" role="img" aria-label="Centrifugal Pump Hydraulic Loop Schematic">
        <!-- Suction Vessel -->
        <rect x="18" y="22" width="145" height="134" rx="14" fill="rgba(2,132,199,0.12)" stroke="#0369a1" stroke-width="2.5" />
        <rect x="20" y="92" width="141" height="62" rx="11" fill="rgba(2,132,199,0.16)" />
        <text x="90" y="46" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">SUCTION VESSEL</text>
        <text x="90" y="66" text-anchor="middle" font-size="10" font-weight="700" fill="#0369a1" font-family="JetBrains Mono">P_s = ${fmtPressG(p.suctionVesselBarg)}</text>
        <text x="90" y="84" text-anchor="middle" font-size="9.5" fill="#334155" font-family="JetBrains Mono">Z_s = +${fmtHead(p.suctionStaticHeadM)}</text>
        <text x="90" y="112" text-anchor="middle" font-size="9.5" fill="#0f172a" font-family="JetBrains Mono">P_vap = ${fmtPressA(pumpRes.vaporPressBara)}</text>
        <text x="90" y="132" text-anchor="middle" font-size="9.5" font-weight="800" fill="${npshOk ? '#059669' : '#dc2626'}" font-family="JetBrains Mono">NPSHa = ${fmtHead(pumpRes.npsh.npshaM, 2)}</text>

        <!-- Suction Pipe + Animated Flow Stream -->
        <line x1="163" y1="115" x2="345" y2="115" stroke="${pumpRes.suction.velCompliant ? '#059669' : '#d97706'}" stroke-width="9" />
        <line x1="166" y1="115" x2="342" y2="115" stroke="#a7f3d0" stroke-width="3" class="svg-flow-anim-slow" />
        <rect x="175" y="32" width="158" height="54" rx="5" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
        <text x="254" y="50" text-anchor="middle" font-size="10" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">SUC: ${pumpRes.suction.nps} Sch 40</text>
        <text x="254" y="66" text-anchor="middle" font-size="9.5" font-weight="700" fill="#059669" font-family="JetBrains Mono">v = ${pumpRes.suction.velocityMS.toFixed(2)} m/s</text>
        <text x="254" y="80" text-anchor="middle" font-size="9" fill="#475569" font-family="JetBrains Mono">P_suc,noz = ${fmtPressG(pumpRes.suction.nozzleBarg)}</text>

        <!-- Centrifugal Pump Symbol (API 610) -->
        <polygon points="362,147 398,147 408,163 352,163" fill="#0f172a" />
        <line x1="380" y1="82" x2="435" y2="82" stroke="#0284c7" stroke-width="10" />
        <circle cx="380" cy="115" r="32" fill="#0284c7" stroke="#0f172a" stroke-width="2.5" />
        <circle cx="380" cy="115" r="22" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-dasharray="4,3" />
        <text x="380" y="112" text-anchor="middle" font-size="10" font-weight="800" fill="#ffffff" font-family="JetBrains Mono">${escapeHtml(p.pumpTag)}</text>
        <text x="380" y="126" text-anchor="middle" font-size="8.5" font-weight="700" fill="#e0f2fe" font-family="JetBrains Mono">${pumpRes.pump.selectedMotorKw} kW</text>
        <rect x="330" y="12" width="132" height="48" rx="5" fill="#0f172a" />
        <text x="396" y="31" text-anchor="middle" font-size="10" font-weight="800" fill="#38bdf8" font-family="JetBrains Mono">TDH = ${fmtHead(pumpRes.pump.tdhRatedM)}</text>
        <text x="396" y="48" text-anchor="middle" font-size="9.5" font-weight="700" fill="#f8fafc" font-family="JetBrains Mono">P_shutoff = ${fmtPressG(pumpRes.pump.maxDischargeBarg)}</text>

        <!-- Discharge Pipe + Animated Flow Stream -->
        <line x1="412" y1="82" x2="735" y2="82" stroke="#0284c7" stroke-width="8" />
        <line x1="416" y1="82" x2="730" y2="82" stroke="#bae6fd" stroke-width="2.8" class="svg-flow-anim" />

        <!-- Control Valve Bowtie + Diaphragm Actuator -->
        <polygon points="555,68 580,82 555,96" fill="#059669" stroke="#0f172a" stroke-width="1.8" />
        <polygon points="605,68 580,82 605,96" fill="#059669" stroke="#0f172a" stroke-width="1.8" />
        <line x1="580" y1="82" x2="580" y2="50" stroke="#0f172a" stroke-width="2.5" />
        <path d="M564,50 A16,12 0 0,1 596,50 Z" fill="#059669" stroke="#0f172a" stroke-width="1.8" />
        <text x="580" y="34" text-anchor="middle" font-size="8.5" font-weight="800" fill="#059669" font-family="JetBrains Mono">FCV (${pumpRes.controlValve.rated.pctOfSelectedCv.toFixed(0)}% Open)</text>

        <rect x="478" y="104" width="220" height="56" rx="5" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
        <text x="588" y="121" text-anchor="middle" font-size="10" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">DIS: ${pumpRes.discharge.nps} · v=${pumpRes.discharge.velocityMS.toFixed(2)} m/s</text>
        <text x="588" y="137" text-anchor="middle" font-size="9.5" font-weight="700" fill="#0369a1" font-family="JetBrains Mono">CV ΔP = ${fmtDP(pumpRes.controlValve.allocatedDpRatedBar, 2)} (${pumpRes.controlValve.pctOfDynamic.toFixed(0)}% Dyn)</text>
        <text x="588" y="151" text-anchor="middle" font-size="9" fill="#475569" font-family="JetBrains Mono">Cv_norm = ${pumpRes.controlValve.normal.reqCv.toFixed(1)} · Cv_rated = ${pumpRes.controlValve.rated.reqCv.toFixed(1)}</text>

        <!-- Destination Vessel -->
        <rect x="735" y="22" width="165" height="134" rx="14" fill="rgba(5,150,105,0.12)" stroke="#059669" stroke-width="2.5" />
        <rect x="737" y="96" width="161" height="58" rx="11" fill="rgba(5,150,105,0.16)" />
        <text x="817" y="46" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">DESTINATION VESSEL</text>
        <text x="817" y="66" text-anchor="middle" font-size="10" font-weight="700" fill="#059669" font-family="JetBrains Mono">P_d = ${fmtPressG(p.destVesselBarg)}</text>
        <text x="817" y="84" text-anchor="middle" font-size="9.5" fill="#334155" font-family="JetBrains Mono">Z_d = +${fmtHead(p.dischargeStaticHeadM)}</text>
        <text x="817" y="112" text-anchor="middle" font-size="9.5" fill="#0f172a" font-family="JetBrains Mono">ΔP_equip = ${fmtDP(pumpRes.discharge.dP_equipBar, 2)}</text>
        <text x="817" y="132" text-anchor="middle" font-size="9.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">Q_rated = ${fmtVolFlow(pumpRes.Q_ratedM3Hr)}</text>
      </svg>
    `;
  }

  function renderPumpCurveSvg(pumpRes) {
    const container = document.getElementById('pumpCurveSvgContainer');
    if (!container) return;

    const pts = pumpRes.curvePoints;
    const maxQ = pts[pts.length - 1].flowM3Hr;
    const maxH = Math.max(10, pumpRes.pump.shutoffHeadM * 1.15);

    const xOf = (qM3Hr) => 44 + (qM3Hr / maxQ) * 314;
    // Top panel: H(Q) from y=16 to y=132
    const yOfH = (hM) => 132 - Math.min(114, Math.max(0, (hM / maxH) * 114));

    const pumpPath = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.flowM3Hr).toFixed(1)},${yOfH(pt.pumpHeadM).toFixed(1)}`).join(' ');
    const sysExCvPath = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.flowM3Hr).toFixed(1)},${yOfH(pt.sysHeadExCvM).toFixed(1)}`).join(' ');
    const sysTotPath = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.flowM3Hr).toFixed(1)},${yOfH(pt.sysHeadWithRatedCvM).toFixed(1)}`).join(' ');

    // Bottom panel: NPSHa(Q) vs NPSHr(Q) from y=150 to y=202
    const rhoG = Math.max(100, pumpRes.rhoKgM3) * 9.80665;
    const sucHeadLossRatedM = (pumpRes.suction.dP_totalBar * 1e5) / rhoG;
    const npshaZeroFlowM = pumpRes.npsh.npshaM + sucHeadLossRatedM;
    const maxNpsh = Math.max(8, npshaZeroFlowM * 1.2, pumpRes.npsh.npshrM * 1.6);
    const yOfNpsh = (nM) => 202 - Math.min(48, Math.max(0, (nM / maxNpsh) * 48));

    const npshaPts = pts.map((pt, i) => {
      const ratio = pt.flowM3Hr / Math.max(1e-6, pumpRes.Q_ratedM3Hr);
      const npshaAtQ = Math.max(0, npshaZeroFlowM - sucHeadLossRatedM * ratio * ratio);
      return `${i === 0 ? 'M' : 'L'}${xOf(pt.flowM3Hr).toFixed(1)},${yOfNpsh(npshaAtQ).toFixed(1)}`;
    }).join(' ');

    const npshrPts = pts.map((pt, i) => {
      const ratio = pt.flowM3Hr / Math.max(1e-6, pumpRes.Q_ratedM3Hr);
      const npshrAtQ = pumpRes.npsh.npshrM * (0.65 + 0.35 * ratio * ratio);
      return `${i === 0 ? 'M' : 'L'}${xOf(pt.flowM3Hr).toFixed(1)},${yOfNpsh(npshrAtQ).toFixed(1)}`;
    }).join(' ');

    const xNorm = xOf(pumpRes.Q_normM3Hr);
    const xRated = xOf(pumpRes.Q_ratedM3Hr);
    const yRated = yOfH(pumpRes.pump.tdhRatedM);
    const yShutoff = yOfH(pumpRes.pump.shutoffHeadM);
    const yNpshaRated = yOfNpsh(pumpRes.npsh.npshaM);
    const yNpshrRated = yOfNpsh(pumpRes.npsh.npshrM);

    container.innerHTML = `
      <svg viewBox="0 0 380 224" width="100%" height="224" role="img" aria-label="Pump Head and NPSH vs Flow Curves">
        <!-- Top Axes: Head H(Q) -->
        <line x1="44" y1="16" x2="44" y2="132" stroke="#64748b" stroke-width="1.5" />
        <line x1="44" y1="132" x2="362" y2="132" stroke="#64748b" stroke-width="1.5" />
        <text x="14" y="76" text-anchor="middle" font-size="8.5" font-weight="700" fill="#475569" font-family="JetBrains Mono" transform="rotate(-90 14,76)">HEAD</text>

        <!-- Head Curves -->
        <path d="${pumpPath}" fill="none" stroke="#0284c7" stroke-width="2.8" />
        <path d="${sysTotPath}" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-dasharray="4,3" />
        <path d="${sysExCvPath}" fill="none" stroke="#059669" stroke-width="2" />

        <!-- Vertical Operating Guides across both subplots -->
        <line x1="${xRated.toFixed(1)}" y1="16" x2="${xRated.toFixed(1)}" y2="202" stroke="#94a3b8" stroke-width="1.1" stroke-dasharray="3,3" />
        <line x1="${xNorm.toFixed(1)}" y1="16" x2="${xNorm.toFixed(1)}" y2="202" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="2,3" />

        <!-- Rated Operating Point Marker -->
        <circle cx="${xRated.toFixed(1)}" cy="${yRated.toFixed(1)}" r="8" fill="#dc2626" opacity="0.2" class="svg-pulse-dot" />
        <circle cx="${xRated.toFixed(1)}" cy="${yRated.toFixed(1)}" r="4.8" fill="#dc2626" stroke="#ffffff" stroke-width="1.5" />
        <circle cx="44" cy="${yShutoff.toFixed(1)}" r="4" fill="#0284c7" />

        <!-- Top Legend & Labels -->
        <text x="50" y="${Math.max(25, yShutoff - 5).toFixed(1)}" font-size="8.5" font-weight="700" fill="#0284c7" font-family="JetBrains Mono">Shutoff: ${fmtHead(pumpRes.pump.shutoffHeadM, 0)}</text>
        <rect x="${Math.min(218, Math.max(48, xRated - 68)).toFixed(1)}" y="${Math.max(12, yRated - 20).toFixed(1)}" width="136" height="14" rx="3" fill="rgba(15,23,42,0.88)" />
        <text x="${Math.min(286, Math.max(116, xRated)).toFixed(1)}" y="${Math.max(22, yRated - 10).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#f8fafc" font-family="JetBrains Mono">Rated: ${fmtVolFlow(pumpRes.Q_ratedM3Hr, 0)} @ ${fmtHead(pumpRes.pump.tdhRatedM, 0)}</text>

        <!-- Bottom Subplot: NPSHa vs NPSHr -->
        <line x1="44" y1="150" x2="44" y2="202" stroke="#64748b" stroke-width="1.5" />
        <line x1="44" y1="202" x2="362" y2="202" stroke="#64748b" stroke-width="1.5" />
        <text x="14" y="176" text-anchor="middle" font-size="8.5" font-weight="700" fill="#475569" font-family="JetBrains Mono" transform="rotate(-90 14,176)">NPSH</text>

        <path d="${npshaPts}" fill="none" stroke="#059669" stroke-width="2.2" />
        <path d="${npshrPts}" fill="none" stroke="#d97706" stroke-width="2" stroke-dasharray="4,2" />
        <circle cx="${xRated.toFixed(1)}" cy="${yNpshaRated.toFixed(1)}" r="3.8" fill="#059669" stroke="#ffffff" stroke-width="1.2" />
        <circle cx="${xRated.toFixed(1)}" cy="${yNpshrRated.toFixed(1)}" r="3.8" fill="#d97706" stroke="#ffffff" stroke-width="1.2" />
        <text x="50" y="160" font-size="8" font-weight="700" fill="#059669" font-family="JetBrains Mono">NPSHa=${fmtHead(pumpRes.npsh.npshaM, 1)} vs NPSHr=${fmtHead(pumpRes.npsh.npshrM, 1)}</text>

        <text x="202" y="218" text-anchor="middle" font-size="8.5" font-weight="700" fill="#475569" font-family="JetBrains Mono">Top: Pump H(Q) / Sys+CV · Bottom: NPSHa (Green) vs NPSHr (Amber)</text>
      </svg>
    `;
  }

  function renderPumpWaterfallSvg(pumpRes) {
    const container = document.getElementById('pumpWaterfallSvgContainer');
    if (!container) return;

    const p = state.pumpLoop;
    const pSuc = Math.max(0, pumpRes.suction.nozzleBarg);
    const pDis = Math.max(0, pumpRes.discharge.nozzleBarg);
    const dpStaticDis = Math.max(0, (pumpRes.rhoKgM3 * 9.80665 * Math.max(0, Number(p.dischargeStaticHeadM) || 0)) / 1e5);
    const dpPipeEquip = Math.max(0, pumpRes.discharge.dP_pipeBar + pumpRes.discharge.dP_equipBar);
    const dpCv = Math.max(0, pumpRes.controlValve.allocatedDpRatedBar);
    const pDest = Math.max(0, Number(p.destVesselBarg) || 0);

    const maxP = Math.max(1, pDis * 1.18);
    const yTop = 20;
    const yBot = 128;
    const plotH = yBot - yTop;
    const yOfP = (valBarg) => yBot - Math.min(plotH, Math.max(0, (valBarg / maxP) * plotH));

    // Step levels along discharge hydraulic path:
    // 1. P_suc (0 -> pSuc)
    // 2. +ΔP_pump (pSuc -> pDis)
    // 3. -ΔP_static (pDis -> pAfterStat)
    // 4. -ΔP_pipe+eq (pAfterStat -> pAfterPipe)
    // 5. -ΔP_CV (pAfterPipe -> pDest)
    // 6. P_dest (0 -> pDest)
    const pAfterStat = Math.max(pDest, pDis - dpStaticDis);
    const pAfterPipe = Math.max(pDest, pAfterStat - dpPipeEquip);

    const bars = [
      { label: 'P_suc', valTxt: fmtPressG(pSuc, 1), pLow: 0, pHigh: pSuc, color: '#0284c7' },
      { label: '+ΔP_pump', valTxt: `+${fmtDP(pumpRes.pump.diffPressureRatedBar, 1)}`, pLow: pSuc, pHigh: pDis, color: '#059669' },
      { label: '-ΔP_stat', valTxt: `-${fmtDP(dpStaticDis, 1)}`, pLow: pAfterStat, pHigh: pDis, color: '#64748b' },
      { label: '-ΔP_line', valTxt: `-${fmtDP(dpPipeEquip, 1)}`, pLow: pAfterPipe, pHigh: pAfterStat, color: '#d97706' },
      { label: '-ΔP_CV', valTxt: `-${fmtDP(dpCv, 1)}`, pLow: pDest, pHigh: pAfterPipe, color: '#dc2626' },
      { label: 'P_dest', valTxt: fmtPressG(pDest, 1), pLow: 0, pHigh: pDest, color: '#0369a1' }
    ];

    const barsSvg = bars.map((b, idx) => {
      const x = 36 + idx * 54;
      const w = 38;
      const y1 = yOfP(b.pHigh);
      const y2 = yOfP(b.pLow);
      const h = Math.max(4, y2 - y1);
      return `
        <g>
          <rect x="${x}" y="${y1.toFixed(1)}" width="${w}" height="${h.toFixed(1)}" rx="3" fill="${b.color}" opacity="0.88" />
          <text x="${x + w / 2}" y="${Math.max(12, y1 - 4).toFixed(1)}" text-anchor="middle" font-size="7.8" font-weight="800" fill="${b.color}" font-family="JetBrains Mono">${b.valTxt}</text>
          <text x="${x + w / 2}" y="143" text-anchor="middle" font-size="8" font-weight="700" fill="#334155" font-family="JetBrains Mono">${b.label}</text>
        </g>
      `;
    }).join('');

    container.innerHTML = `
      <div style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);margin-bottom:0.25rem;">
        Circuit Pressure Waterfall Bridge (Suction → Pump TDH → Consumers → Destination)
      </div>
      <svg viewBox="0 0 380 152" width="100%" height="152" role="img" aria-label="Pump Differential Pressure Waterfall Chart">
        <line x1="28" y1="${yTop}" x2="28" y2="${yBot}" stroke="#94a3b8" stroke-width="1.2" />
        <line x1="28" y1="${yBot}" x2="365" y2="${yBot}" stroke="#94a3b8" stroke-width="1.2" />
        ${barsSvg}
      </svg>
    `;
  }


  // =========================================================================
  // 6. STEP 5: FORMAL IPDS DATASHEET & CALCULATION SHEET (PSV & PUMP MODES)
  // =========================================================================

  function renderPumpIpdsDatasheet(p, pumpRes, todayStr) {
    return `
      <table class="ipds-header-table">
        <tr>
          <td rowspan="3" style="width:24%;background:#0f172a;color:#ffffff;text-align:center;">
            <div style="font-family:var(--font-mono);font-size:1.15rem;font-weight:800;letter-spacing:0.04em;">EQUIPMENT PROCESS DATASHEET (IPDS)</div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:4px;">CENTRIFUGAL PUMP &amp; HYDRAULIC LOOP (API 610 / API 14E)</div>
          </td>
          <td style="width:38%;"><strong>PROJECT:</strong> ${escapeHtml(p.project || state.tag.projectTitle)}</td>
          <td style="width:20%;"><strong>PUMP TAG:</strong> <span class="mono" style="font-weight:800;color:#0369a1;">${escapeHtml(p.pumpTag)}</span></td>
          <td style="width:18%;"><strong>DATE:</strong> <span class="mono">${todayStr}</span></td>
        </tr>
        <tr>
          <td><strong>CLIENT / STD:</strong> ${escapeHtml(state.tag.clientName)} · API 610 12th Ed.</td>
          <td><strong>MOTOR RATING:</strong> <span class="mono" style="font-weight:800;">${pumpRes.pump.selectedMotorKw} kW</span></td>
          <td><strong>REV:</strong> <span class="mono">0 (Vendor Print / IFD)</span></td>
        </tr>
        <tr>
          <td><strong>SERVICE:</strong> ${escapeHtml(p.service)}</td>
          <td colspan="2"><strong>LINES:</strong> <span class="mono">Suction ${pumpRes.suction.nps} ${pumpRes.suction.schedule} × Discharge ${pumpRes.discharge.nps} ${pumpRes.discharge.schedule}</span></td>
        </tr>
      </table>

      <div class="ipds-section-banner">1. OPERATING CONDITIONS, LIQUID PROPERTIES &amp; FLOW RATES</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">1</td>
          <td style="width:32%;"><strong>Pumped Liquid /Pumping Temperature (T_pump)</strong></td>
          <td class="mono" style="width:18%;">${escapeHtml(p.FluidName || 'Process Liquid')} @ ${fmtTemp(pumpRes.tempC)}</td>
          <td class="ipds-line-no">2</td>
          <td style="width:32%;"><strong>Liquid Density (ρ) / Specific Gravity (SG) / Viscosity (μ)</strong></td>
          <td class="mono" style="width:18%;">${pumpRes.rhoKgM3.toFixed(1)} kg/m³ (SG=${pumpRes.SG.toFixed(3)}) / ${pumpRes.viscCp} cP</td>
        </tr>
        <tr>
          <td class="ipds-line-no">3</td>
          <td><strong>Vapor Pressure at Pumping Temp (P_vap)</strong></td>
          <td class="mono">${fmtPressA(pumpRes.vaporPressBara, 3)}</td>
          <td class="ipds-line-no">4</td>
          <td><strong>Normal / Rated / Minimum Continuous Flow</strong></td>
          <td class="mono"><strong>${fmtVolFlow(pumpRes.Q_normM3Hr)}</strong> / <strong>${fmtVolFlow(pumpRes.Q_ratedM3Hr)}</strong> / ${fmtVolFlow(pumpRes.Q_minM3Hr)}</td>
        </tr>
      </table>

      <div class="ipds-section-banner">2. SUCTION &amp; DISCHARGE HYDRAULICS, NPSH &amp; DIFFERENTIAL HEAD (API 610)</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">5</td>
          <td style="width:32%;"><strong>Suction Vessel Pressure / Static Elevation Head (Z_s)</strong></td>
          <td class="mono" style="width:18%;">${fmtPressG(p.suctionVesselBarg)} / +${fmtHead(p.suctionStaticHeadM)}</td>
          <td class="ipds-line-no">6</td>
          <td style="width:32%;"><strong>Destination Vessel Pressure / Static Elevation Head (Z_d)</strong></td>
          <td class="mono" style="width:18%;">${fmtPressG(p.destVesselBarg)} / +${fmtHead(p.dischargeStaticHeadM)}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">7</td>
          <td><strong>Suction Line Friction Loss / Pump Suction Nozzle Pressure</strong></td>
          <td class="mono">${fmtDP(pumpRes.suction.dP_totalBar, 3)} / <strong>${fmtPressG(pumpRes.suction.nozzleBarg)}</strong></td>
          <td class="ipds-line-no">8</td>
          <td><strong>Discharge Line + Equip + CV Loss / Discharge Nozzle Pressure</strong></td>
          <td class="mono">${fmtDP(pumpRes.discharge.dP_pipeBar + pumpRes.discharge.dP_equipBar + pumpRes.controlValve.allocatedDpRatedBar, 2)} / <strong>${fmtPressG(pumpRes.discharge.nozzleBarg)}</strong></td>
        </tr>
        <tr>
          <td class="ipds-line-no">9</td>
          <td><strong>Rated Differential Pressure (ΔP_rated) &amp; Total Head (TDH)</strong></td>
          <td class="mono" style="font-weight:800;color:#0369a1;">${fmtDP(pumpRes.pump.diffPressureRatedBar, 2)} / ${fmtHead(pumpRes.pump.tdhRatedM)}</td>
          <td class="ipds-line-no">10</td>
          <td><strong>Shutoff Differential Head &amp; Max Shutoff Discharge Pressure</strong></td>
          <td class="mono" style="font-weight:800;color:#dc2626;">${fmtHead(pumpRes.pump.shutoffHeadM)} / ${fmtPressG(pumpRes.pump.maxDischargeBarg)}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">11</td>
          <td><strong>Available NPSH (NPSHa) vs Vendor Required NPSHr (3%)</strong></td>
          <td class="mono" style="font-weight:700;color:${pumpRes.npsh.compliant ? '#065f46' : '#991b1b'};">NPSHa = ${fmtHead(pumpRes.npsh.npshaM, 2)} vs NPSHr = ${fmtHead(pumpRes.npsh.npshrM, 2)} (${pumpRes.npsh.compliant ? 'PASS' : 'FAIL'})</td>
          <td class="ipds-line-no">12</td>
          <td><strong>Hydraulic Power / Brake Shaft Power / API 610 Motor Nameplate</strong></td>
          <td class="mono">${pumpRes.pump.hydraulicPowerKw.toFixed(1)} kW / ${pumpRes.pump.brakePowerKw.toFixed(1)} kW (${pumpRes.pump.brakePowerHp.toFixed(1)} hp) / <strong>${pumpRes.pump.selectedMotorKw} kW</strong></td>
        </tr>
      </table>

      <div class="ipds-section-banner">3. CONTROL VALVE SIZING (IEC 60534) &amp; LINE VELOCITY SUMMARY (API 14E)</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">13</td>
          <td style="width:32%;"><strong>Allocated Control Valve ΔP at Rated Flow (% Dynamic)</strong></td>
          <td class="mono" style="width:18%;">${fmtDP(pumpRes.controlValve.allocatedDpRatedBar, 2)} (${pumpRes.controlValve.pctOfDynamic.toFixed(1)}%)</td>
          <td class="ipds-line-no">14</td>
          <td style="width:32%;"><strong>Required Control Valve Cv (Min / Normal / Rated)</strong></td>
          <td class="mono" style="width:18%;font-weight:700;">${pumpRes.controlValve.min.reqCv.toFixed(1)} / ${pumpRes.controlValve.normal.reqCv.toFixed(1)} / ${pumpRes.controlValve.rated.reqCv.toFixed(1)} (Max Cv=${pumpRes.controlValve.selectedMaxCv})</td>
        </tr>
        <tr>
          <td class="ipds-line-no">15</td>
          <td><strong>Suction Line Velocity &amp; ΔP/100m (${pumpRes.suction.nps} ${pumpRes.suction.schedule})</strong></td>
          <td class="mono">v_s = ${pumpRes.suction.velocityMS.toFixed(2)} m/s | ${fmtDP(pumpRes.suction.dpPer100mBar, 3)}/100m</td>
          <td class="ipds-line-no">16</td>
          <td><strong>Discharge Line Velocity &amp; API 14E Erosional Limit (${pumpRes.discharge.nps})</strong></td>
          <td class="mono">v_d = ${pumpRes.discharge.velocityMS.toFixed(2)} m/s (v_e = ${pumpRes.discharge.vErosionalMS.toFixed(2)} m/s)</td>
        </tr>
      </table>

      <div class="ipds-section-banner">4. STEP-BY-STEP PUMP HYDRAULIC VERIFICATION TRACE</div>
      <table class="ipds-data-table">
        ${pumpRes.steps.map((s, idx) => `
          <tr>
            <td class="ipds-line-no">P${idx + 1}</td>
            <td style="width:28%;font-weight:700;">${s.title}</td>
            <td class="mono" style="font-size:0.74rem;">
              <div><strong>Eq:</strong> ${s.formula}</div>
              <div><strong>Sub:</strong> ${s.substitution}</div>
              <div style="color:#065f46;font-weight:700;"><strong>Result:</strong> ${s.result}</div>
            </td>
          </tr>
        `).join('')}
      </table>
    `;
  }

  function renderIpdsDatasheet(t, scenariosBundle, sizing, hyd, pumpRes) {
    const sheet = document.getElementById('ipdsPrintableSheet');
    const todayStr = new Date().toISOString().slice(0, 10);

    if (state.ipdsMode === 'pump' && pumpRes) {
      sheet.innerHTML = renderPumpIpdsDatasheet(state.pumpLoop, pumpRes, todayStr);
      return;
    }

    const gov = scenariosBundle.governing;

    sheet.innerHTML = `
      <table class="ipds-header-table">
        <tr>
          <td rowspan="3" style="width:24%;background:#0f172a;color:#ffffff;text-align:center;">
            <div style="font-family:var(--font-mono);font-size:1.15rem;font-weight:800;letter-spacing:0.04em;">INSTRUMENT PROCESS DATASHEET (IPDS)</div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:4px;">PRESSURE RELIEF VALVE (API 520 / 521 / 526)</div>
          </td>
          <td style="width:38%;"><strong>PROJECT:</strong> ${escapeHtml(t.projectTitle)}</td>
          <td style="width:20%;"><strong>TAG NO.:</strong> <span class="mono" style="font-weight:800;color:#0369a1;">${escapeHtml(t.tagNumber)}</span></td>
          <td style="width:18%;"><strong>DATE:</strong> <span class="mono">${todayStr}</span></td>
        </tr>
        <tr>
          <td><strong>CLIENT / STD:</strong> ${escapeHtml(t.clientName)}</td>
          <td><strong>ORIFICE:</strong> <span class="mono" style="font-weight:800;">API 526 "${sizing.selectedOrifice.letter}"</span></td>
          <td><strong>REV:</strong> <span class="mono">0 (Issued for Design)</span></td>
        </tr>
        <tr>
          <td><strong>SERVICE:</strong> ${escapeHtml(t.service)}</td>
          <td colspan="2"><strong>P&amp;ID NO.:</strong> <span class="mono">${escapeHtml(t.pidNumber)}</span></td>
        </tr>
      </table>

      <div class="ipds-section-banner">1. GENERAL &amp; EQUIPMENT BASIS</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">1</td>
          <td style="width:32%;"><strong>Protected Equipment No. &amp; Description</strong></td>
          <td style="width:18%;">${escapeHtml(t.equipmentProtected)}</td>
          <td class="ipds-line-no">2</td>
          <td style="width:32%;"><strong>Governing Overpressure Scenario (API 521)</strong></td>
          <td style="width:18%;font-weight:700;">${gov.scenarioName}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">3</td>
          <td><strong>Design Code / Sizing Standard</strong></td>
          <td>ASME Sec. VIII Div.1 / API 520 Pt I &amp; II</td>
          <td class="ipds-line-no">4</td>
          <td><strong>Valve Design Type</strong></td>
          <td style="text-transform:capitalize;font-weight:700;">${t.valveType === 'bellows' ? 'Balanced Bellows' : (t.valveType === 'pilot' ? 'Pilot-Operated' : 'Conventional Spring-Loaded')}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">5</td>
          <td><strong>Upstream Rupture Disc Combination (Kc)</strong></td>
          <td class="mono">${t.ruptureDiscUpstream ? 'Yes (Kc = 0.90)' : 'No (Kc = 1.00)'}</td>
          <td class="ipds-line-no">6</td>
          <td><strong>Barometric Atmospheric Pressure</strong></td>
          <td class="mono">${fmtPressA(t.atmPressureBara, 3)}</td>
        </tr>
      </table>

      <div class="ipds-section-banner">2. PROCESS OPERATING, RELIEVING &amp; FLUID PROPERTIES</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">7</td>
          <td style="width:32%;"><strong>Fluid State / Phase at Relieving Conditions</strong></td>
          <td style="width:18%;text-transform:uppercase;font-weight:700;">${t.fluidPhase}</td>
          <td class="ipds-line-no">8</td>
          <td style="width:32%;"><strong>Required Relief Mass Flow Rate (W_req)</strong></td>
          <td class="mono" style="width:18%;font-weight:700;">${fmtFlow(sizing.W_kgHr)}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">9</td>
          <td><strong>Normal Operating Pressure / Set Pressure (P_set)</strong></td>
          <td class="mono">${fmtPressG(t.operatingPressureBarg)} / <strong>${fmtPressG(sizing.P_setBarg)}</strong></td>
          <td class="ipds-line-no">10</td>
          <td><strong>Allowed Overpressure % / Relieving Pressure (P₁)</strong></td>
          <td class="mono">${sizing.overpressurePct.toFixed(0)}% / <strong>${fmtPressA(sizing.P1_bara)}</strong></td>
        </tr>
        <tr>
          <td class="ipds-line-no">11</td>
          <td><strong>Superimposed / Built-Up / Total Backpressure</strong></td>
          <td class="mono">${fmtPressG(t.superimposedBackBarg)} / ${fmtPressG(hyd.outlet.builtUpBackBarg)} / <strong>${fmtPressG(hyd.outlet.totalBackBarg)} (${hyd.outlet.totalBackPctOfSet.toFixed(1)}%)</strong></td>
          <td class="ipds-line-no">12</td>
          <td><strong>Relieving Temperature (T₁)</strong></td>
          <td class="mono">${fmtTemp(sizing.T1_C)} (${sizing.T1_K.toFixed(2)} K)</td>
        </tr>
        <tr>
          <td class="ipds-line-no">13</td>
          <td><strong>Molecular Weight (M) / Specific Heat Ratio (k = Cp/Cv)</strong></td>
          <td class="mono">${t.mw.toFixed(2)} kg/kmol / k = ${t.k.toFixed(3)}</td>
          <td class="ipds-line-no">14</td>
          <td><strong>Compressibility (Z) / Liquid Density (ρ) / Viscosity (μ)</strong></td>
          <td class="mono">Z = ${t.z.toFixed(3)} / ρ = ${t.rhoLiqKgM3.toFixed(1)} kg/m³ / μ = ${t.viscCp} cP</td>
        </tr>
      </table>

      <div class="ipds-section-banner">3. API 520 PART I ORIFICE SIZING &amp; API 526 SELECTION SUMMARY</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">15</td>
          <td style="width:32%;"><strong>Flow Regime &amp; Critical Choking Pressure (P_cf)</strong></td>
          <td class="mono" style="width:18%;">${sizing.flowRegime} (${sizing.Pcf_bara > 0 ? fmtPressA(sizing.Pcf_bara) : 'N/A'})</td>
          <td class="ipds-line-no">16</td>
          <td style="width:32%;"><strong>Sizing Coefficients (Kd / Kb or Kw / Kc / Kv)</strong></td>
          <td class="mono" style="width:18%;">Kd=${sizing.Kd} | Kb=${sizing.Kb.toFixed(3)} | Kc=${sizing.Kc} | Kv=${sizing.Kv.toFixed(3)}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">17</td>
          <td><strong>Required Effective Orifice Area (A_req)</strong></td>
          <td class="mono" style="font-weight:800;color:#dc2626;">${sizing.reqAreaMm2.toFixed(1)} mm² (${sizing.reqAreaIn2.toFixed(4)} in²)</td>
          <td class="ipds-line-no">18</td>
          <td><strong>Selected API 526 Standard Orifice &amp; Area (A_sel)</strong></td>
          <td class="mono" style="font-weight:800;color:#0369a1;">Orifice "${sizing.selectedOrifice.letter}" — ${sizing.selectedOrifice.areaMm2.toFixed(1)} mm² (${sizing.selectedOrifice.areaIn2.toFixed(3)} in²)</td>
        </tr>
        <tr>
          <td class="ipds-line-no">19</td>
          <td><strong>Standard Valve Inlet × Outlet Flange Size</strong></td>
          <td class="mono" style="font-weight:700;">${sizing.selectedOrifice.inletOutFlange}</td>
          <td class="ipds-line-no">20</td>
          <td><strong>Orifice Utilization % &amp; Valve Rated Capacity (W_rated)</strong></td>
          <td class="mono">${sizing.selectedOrifice.utilizationPct.toFixed(1)}% | W_rated = ${fmtFlow(sizing.ratedCapacityKgHr)}</td>
        </tr>
      </table>

      <div class="ipds-section-banner">4. API 520 PART II INLET &amp; OUTLET PIPING HYDRAULIC SUMMARY</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">21</td>
          <td style="width:32%;"><strong>Inlet Line NPS, Schedule, Length &amp; Fittings ΣK</strong></td>
          <td class="mono" style="width:18%;">${hyd.inlet.nps} ${hyd.inlet.schedule} (ID=${hyd.inlet.idMm} mm), L=${hyd.inlet.lengthM}m, ΣK=${hyd.inlet.K_fittings}</td>
          <td class="ipds-line-no">22</td>
          <td style="width:32%;"><strong>Inlet Pressure Loss ΔP_inlet (% of P_set ≤ 3.0% Rule)</strong></td>
          <td class="mono" style="width:18%;font-weight:700;color:${hyd.inlet.passes3Pct ? '#065f46' : '#991b1b'};">${fmtDP(hyd.inlet.dP_totalBar)} (${hyd.inlet.lossPctOfSet.toFixed(2)}%) — ${hyd.inlet.passes3Pct ? 'PASS' : 'FAIL'}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">23</td>
          <td><strong>Outlet Tailpipe NPS, Schedule, Length &amp; Fittings ΣK</strong></td>
          <td class="mono">${hyd.outlet.nps} ${hyd.outlet.schedule} (ID=${hyd.outlet.idMm} mm), L=${hyd.outlet.lengthM}m, ΣK=${hyd.outlet.K_fittings}</td>
          <td class="ipds-line-no">24</td>
          <td><strong>Outlet Mach Number &amp; Discharge Reaction Force (F_r)</strong></td>
          <td class="mono">Ma = ${hyd.outlet.machNumber.toFixed(2)} | F_r = ${hyd.outlet.reactionForceKn.toFixed(2)} kN (${Math.round(hyd.outlet.reactionForceLbf)} lbf)</td>
        </tr>
      </table>

      <div class="ipds-section-banner">5. STEP-BY-STEP EQUATION VERIFICATION TRACE</div>
      <table class="ipds-data-table">
        ${sizing.steps.map((s, idx) => `
          <tr>
            <td class="ipds-line-no">S${idx + 1}</td>
            <td style="width:28%;font-weight:700;">${s.title}</td>
            <td class="mono" style="font-size:0.74rem;">
              <div><strong>Eq:</strong> ${s.formula}</div>
              <div><strong>Sub:</strong> ${s.substitution}</div>
              <div style="color:#065f46;font-weight:700;"><strong>Result:</strong> ${s.result}</div>
            </td>
          </tr>
        `).join('')}
      </table>
    `;
  }

  // =========================================================================
  // 7. STEP 6: PROJECT TAG REGISTER & EXPORT / IMPORT
  // =========================================================================

  function renderProjectRegisterTable() {
    const tbody = document.getElementById('projectRegisterTbody');
    if (!tbody) return;
    const badge = document.getElementById('registerCountBadge');
    if (badge) badge.textContent = String(state.register.length);

    const evaluatedRows = state.register.map((tagItem, idx) => {
      const { sizing: s, hyd: h } = computeForTag(tagItem);
      return { tagItem, idx, s, h };
    });

    renderRegisterVisualDashboard(evaluatedRows);

    tbody.innerHTML = evaluatedRows.map(({ tagItem, idx, s, h }) => {
      const isCurrent = tagItem.tagNumber === state.tag.tagNumber;
      return `
        <tr class="${isCurrent ? 'row-governing' : ''}">
          <td class="mono" style="font-weight:800;color:var(--accent-primary);">${escapeHtml(tagItem.tagNumber)}</td>
          <td>
            <div style="font-weight:700;">${escapeHtml(tagItem.service)}</div>
            <div style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(tagItem.equipmentProtected)} · ${escapeHtml(tagItem.pidNumber || '')}</div>
          </td>
          <td class="mono" style="text-transform:uppercase;">${escapeHtml(tagItem.fluidPhase)}</td>
          <td class="mono">${escapeHtml((tagItem.governingScenarioKey || 'blocked_outlet').replace('_', ' '))}</td>
          <td class="mono">${fmtPressG(tagItem.setPressureBarg)}</td>
          <td class="mono">${fmtFlow(tagItem.flowRateKgHr)}</td>
          <td class="mono" style="font-weight:700;">${s.reqAreaMm2.toFixed(1)} mm²</td>
          <td class="mono" style="font-weight:800;color:var(--accent-primary);">${s.selectedOrifice.letter} (${s.selectedOrifice.inletOutFlange})</td>
          <td class="mono">
            <span class="status-badge ${h.inlet.passes3Pct ? 'status-pass' : 'status-fail'}">${escapeHtml(tagItem.inletNps)}: ${h.inlet.lossPctOfSet.toFixed(2)}%</span>
          </td>
          <td class="mono">
            <span class="status-badge ${h.outlet.passesBackpressure ? 'status-pass' : 'status-fail'}">${escapeHtml(tagItem.outletNps)}: ${h.outlet.totalBackPctOfSet.toFixed(1)}%</span>
          </td>
          <td>
            <div style="display:flex;gap:0.35rem;">
              <button type="button" class="btn btn-primary btn-load-reg" data-idx="${idx}" style="padding:0.22rem 0.5rem;font-size:0.73rem;">Load</button>
              <button type="button" class="btn btn-secondary btn-del-reg" data-idx="${idx}" style="padding:0.22rem 0.5rem;font-size:0.73rem;">✕</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-load-reg').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if (state.register[idx]) {
          state.tag = JSON.parse(JSON.stringify(state.register[idx]));
          syncTagToDomInputs();
          renderScenarioForm();
          recomputeAll();
          switchTab('tab-sizing');
        }
      });
    });

    tbody.querySelectorAll('.btn-del-reg').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if (state.register.length > 1) {
          state.register.splice(idx, 1);
          saveRegisterToStorage();
          renderProjectRegisterTable();
        }
      });
    });
  }

  function renderRegisterVisualDashboard(evaluatedRows) {
    const container = document.getElementById('registerVisualDashboard');
    if (!container) return;

    const totalTags = evaluatedRows.length;
    const totalRelievingKgHr = evaluatedRows.reduce((acc, r) => acc + (Number(r.tagItem.flowRateKgHr) || 0), 0);
    const inletPassCount = evaluatedRows.filter(r => r.h.inlet.passes3Pct).length;
    const outletPassCount = evaluatedRows.filter(r => r.h.outlet.passesBackpressure).length;
    const fullAuditPassCount = evaluatedRows.filter(r => r.h.inlet.passes3Pct && r.h.outlet.passesBackpressure).length;

    const phaseCounts = {};
    const orificeCounts = {};
    evaluatedRows.forEach(({ tagItem, s }) => {
      const ph = (tagItem.fluidPhase || 'vapor').toUpperCase();
      phaseCounts[ph] = (phaseCounts[ph] || 0) + 1;
      const lettr = s.selectedOrifice.letter;
      orificeCounts[lettr] = (orificeCounts[lettr] || 0) + 1;
    });

    const letters = Object.keys(orificeCounts);
    const maxOrificeCount = Math.max(1, ...Object.values(orificeCounts));
    const barSlotW = Math.min(68, Math.floor(340 / Math.max(1, letters.length)));
    const barsSvg = letters.map((lettr, idx) => {
      const cnt = orificeCounts[lettr];
      const x = 44 + idx * barSlotW;
      const bw = Math.max(22, barSlotW - 14);
      const bh = Math.max(14, (cnt / maxOrificeCount) * 62);
      const y = 92 - bh;
      return `
        <g>
          <rect x="${x}" y="${y.toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="4" fill="#0284c7" />
          <text x="${x + bw / 2}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#0284c7" font-family="JetBrains Mono">${cnt} tag${cnt > 1 ? 's' : ''}</text>
          <text x="${x + bw / 2}" y="107" text-anchor="middle" font-size="10" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">"${lettr}"</text>
        </g>
      `;
    }).join('');

    const phaseSummaryStr = Object.entries(phaseCounts).map(([k, v]) => `${k}: ${v}`).join(' · ');

    container.innerHTML = `
      <div class="register-exec-grid">
        <div class="exec-kpi-card">
          <span class="exec-kpi-label">Total Plant PSVs Registered</span>
          <span class="exec-kpi-value">${totalTags} Tags</span>
          <span class="exec-kpi-sub">Phases: ${escapeHtml(phaseSummaryStr)}</span>
        </div>
        <div class="exec-kpi-card">
          <span class="exec-kpi-label">Cumulative Relief Load</span>
          <span class="exec-kpi-value" style="color:var(--accent-primary);">${fmtFlow(totalRelievingKgHr)}</span>
          <span class="exec-kpi-sub">Combined peak flare/vent header basis</span>
        </div>
        <div class="exec-kpi-card">
          <span class="exec-kpi-label">API 520 3% Inlet Audit</span>
          <span class="exec-kpi-value" style="color:${inletPassCount === totalTags ? 'var(--pass-text)' : 'var(--warn-text)'};">${inletPassCount} / ${totalTags} PASS</span>
          <span class="exec-kpi-sub">Chatter-free non-recoverable ΔP_in ≤ 3%</span>
        </div>
        <div class="exec-kpi-card">
          <span class="exec-kpi-label">Overall EPC Audit Compliance</span>
          <span class="exec-kpi-value" style="color:${fullAuditPassCount === totalTags ? 'var(--pass-text)' : 'var(--warn-text)'};">${Math.round((fullAuditPassCount / Math.max(1, totalTags)) * 100)}%</span>
          <span class="exec-kpi-sub">Inlet (${inletPassCount}/${totalTags}) &amp; Backpressure (${outletPassCount}/${totalTags})</span>
        </div>
      </div>
      <div style="background:var(--bg-surface-alt);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:0.65rem 0.9rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;">
        <div>
          <div style="font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">API 526 Standard Orifice Procurement Distribution</div>
          <div style="font-size:0.73rem;color:var(--text-muted);margin-top:0.15rem;">Breakdown of selected API 526 standard orifice designations across all registered plant relief valves</div>
        </div>
        <svg viewBox="0 0 420 116" width="420" height="116" style="max-width:100%;" role="img" aria-label="API 526 Orifice Distribution Chart">
          <line x1="30" y1="92" x2="405" y2="92" stroke="#94a3b8" stroke-width="1.4" />
          ${barsSvg}
        </svg>
      </div>
    `;
  }

  // =========================================================================
  // 8. MASTER RECOMPUTE & EVENT BINDING
  // =========================================================================

  function recomputeAll() {
    const t = state.tag;
    const scenariosBundle = evaluateAllScenariosForTag(t);
    const { sizing, hyd } = computeForTag(t);
    const pumpRes = E.calcPumpLoopHydraulics({
      ...state.pumpLoop,
      atmPressureBara: t.atmPressureBara || 1.01325
    });

    renderScenarioOutputs(scenariosBundle);
    renderSizingOutputs(sizing);
    renderHydraulicsOutputs(sizing, hyd);
    renderPumpOutputs(pumpRes);
    renderIpdsDatasheet(t, scenariosBundle, sizing, hyd, pumpRes);
    renderProjectRegisterTable();
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.workflow-tabs .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === tabId);
    });
  }

  function exportCsvFile(filename, rows) {
    const csvContent = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function initEventListeners() {
    // Tab switching
    document.querySelectorAll('.workflow-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Unit System Toggle (SI <-> USC)
    document.querySelectorAll('.unit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetUnit = btn.dataset.unit;
        if (targetUnit !== state.unitSystem) {
          state.unitSystem = targetUnit;
          document.querySelectorAll('.unit-btn').forEach(b => b.classList.toggle('active', b.dataset.unit === targetUnit));
          syncTagToDomInputs();
          syncPumpToDomInputs();
          recomputeAll();
        }
      });
    });

    // Preset EPC Tag Loader
    document.getElementById('presetTagSelect').addEventListener('change', (e) => {
      const preset = E.EPC_TAG_PRESETS.find(p => p.id === e.target.value);
      if (preset) {
        state.tag = JSON.parse(JSON.stringify(preset));
        state.activeScenarioKey = preset.governingScenarioKey || 'fire_liquid';
        document.querySelectorAll('#scenarioSelectorList .scenario-nav-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.scenario === state.activeScenarioKey);
        });
        syncTagToDomInputs();
        renderScenarioForm();
        recomputeAll();
      }
    });

    // Pump Loop Preset Loader
    const pumpPresetSel = document.getElementById('pumpPresetSelect');
    if (pumpPresetSel) {
      pumpPresetSel.addEventListener('change', (e) => {
        const preset = E.PUMP_LOOP_PRESETS.find(p => p.id === e.target.value);
        if (preset) {
          state.pumpLoop = JSON.parse(JSON.stringify(preset));
          syncPumpToDomInputs();
          recomputeAll();
        }
      });
    }

    // Pump Loop Reactive Inputs
    const pumpReactiveIds = [
      'inpPumpTag', 'inpPumpService', 'inpPumpNormFlow', 'inpPumpRatedMargin',
      'inpPumpRho', 'inpPumpVisc', 'inpPumpVaporPress', 'inpPumpTemp',
      'inpPumpSucPress', 'inpPumpSucHead', 'inpPumpSucNps', 'inpPumpSucLength',
      'inpPumpSucK', 'inpPumpNpshr', 'inpPumpDestPress', 'inpPumpDisHead',
      'inpPumpDisNps', 'inpPumpDisLength', 'inpPumpDisK', 'inpPumpEquipDp',
      'inpPumpCvMinDp', 'inpPumpCvMax', 'inpPumpEff', 'inpPumpShutoffRise'
    ];
    pumpReactiveIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          readDomInputsToPump();
          recomputeAll();
        });
        el.addEventListener('change', () => {
          readDomInputsToPump();
          recomputeAll();
        });
      }
    });

    // Send Pump Rated Flow & Shutoff Pressure to PSV Blocked-Outlet Sizing
    const btnSendPump = document.getElementById('btnSendPumpToPsv');
    if (btnSendPump) {
      btnSendPump.addEventListener('click', () => {
        readDomInputsToPump();
        const pumpRes = E.calcPumpLoopHydraulics({
          ...state.pumpLoop,
          atmPressureBara: state.tag.atmPressureBara || 1.01325
        });
        state.tag.fluidPhase = 'liquid';
        state.tag.rhoLiqKgM3 = Number(pumpRes.rhoKgM3.toFixed(1));
        state.tag.viscCp = Number(pumpRes.viscCp);
        state.tag.relievingTempC = Number(pumpRes.tempC.toFixed(1));
        state.tag.flowRateKgHr = Math.round(pumpRes.W_ratedKgHr);
        state.tag.operatingPressureBarg = Number(pumpRes.discharge.nozzleBarg.toFixed(2));
        state.tag.setPressureBarg = Number(pumpRes.pump.maxDischargeBarg.toFixed(2));
        state.tag.mawpBarg = state.tag.setPressureBarg;
        state.tag.overpressurePct = 10.0;
        state.tag.governingScenarioKey = 'blocked_outlet';
        state.tag.scenarios.blockedOutlet.sourceType = 'pump_compressor';
        state.tag.scenarios.blockedOutlet.maxInflowKgHr = Math.round(pumpRes.W_ratedKgHr);
        state.tag.scenarios.blockedOutlet.creditedOutflowKgHr = 0;

        syncTagToDomInputs();
        renderScenarioForm();
        recomputeAll();
        switchTab('tab-sizing');
      });
    }

    // IPDS Datasheet Mode Toggle (PSV vs Centrifugal Pump)
    document.querySelectorAll('#ipdsModeSelectorGroup .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.ipdsMode = btn.dataset.ipdsMode;
        document.querySelectorAll('#ipdsModeSelectorGroup .seg-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.ipdsMode === state.ipdsMode);
        });
        recomputeAll();
      });
    });

    // Scenario Selector buttons in Step 1
    document.querySelectorAll('#scenarioSelectorList .scenario-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeScenarioKey = btn.dataset.scenario;
        document.querySelectorAll('#scenarioSelectorList .scenario-nav-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.scenario === state.activeScenarioKey);
        });
        renderScenarioForm();
        recomputeAll();
      });
    });

    // Apply Active or Governing Scenario to Step 2
    document.getElementById('btnApplyActiveScenario').addEventListener('click', () => {
      const bundle = evaluateAllScenariosForTag(state.tag);
      applyScenarioToStep2(bundle.map[state.activeScenarioKey]);
    });
    document.getElementById('btnApplyGoverningScenario').addEventListener('click', () => {
      const bundle = evaluateAllScenariosForTag(state.tag);
      applyScenarioToStep2(bundle.governing);
    });

    // Fluid Phase segmented buttons
    document.querySelectorAll('#phaseSelectorGroup .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.tag.fluidPhase = btn.dataset.phase;
        syncTagToDomInputs();
        recomputeAll();
      });
    });

    // Fluid Preset Dropdown
    document.getElementById('fluidPresetSelect').addEventListener('change', (e) => {
      const key = e.target.value;
      state.tag.fluidPresetKey = key;
      const fp = E.FLUID_PRESETS[key];
      if (fp) {
        state.tag.fluidPhase = fp.phase;
        state.tag.mw = fp.mw;
        state.tag.k = fp.k;
        state.tag.z = fp.z;
        state.tag.rhoLiqKgM3 = fp.rhoLiq;
        state.tag.viscCp = fp.viscCp;
        state.tag.scenarios.fireLiquid.latentHeatKjKg = fp.latentHeat;
        state.tag.scenarios.thermalExpansion.cpLiqKjKgK = fp.cpLiq;
        state.tag.scenarios.thermalExpansion.alphaVPerC = fp.alphaV;
        syncTagToDomInputs();
        renderScenarioForm();
        recomputeAll();
      }
    });

    // Valve Type segmented buttons
    document.querySelectorAll('#valveTypeGroup .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.tag.valveType = btn.dataset.vtype;
        syncTagToDomInputs();
        recomputeAll();
      });
    });

    // Auto vs Manual Kb toggle
    document.getElementById('inpAutoKb').addEventListener('change', (e) => {
      state.autoKb = e.target.value === 'true';
      state.tag.autoKb = state.autoKb;
      document.getElementById('fgManualKb').style.display = state.autoKb ? 'none' : '';
      recomputeAll();
    });

    // All Step 2 & Step 3 & Context inputs
    const reactiveIds = [
      'ctxTagNumber', 'ctxService', 'ctxEquipment', 'ctxProject', 'ctxClient', 'ctxPid',
      'inpMw', 'inpK', 'inpZ', 'inpRhoLiq', 'inpVisc', 'inpSteamSh', 'inpOmega',
      'inpFlowRate', 'inpRelievingTemp', 'inpOpPressure', 'inpSetPressure',
      'inpOverpressurePct', 'inpAtmPressure', 'inpSuperBack', 'inpBuiltUpBack',
      'inpRuptureDisc', 'inpManualKb', 'inpHydFlowBasis',
      'inpInletNps', 'inpInletSch', 'inpInletLength', 'inpInletFittingsK',
      'inpOutletNps', 'inpOutletSch', 'inpOutletLength', 'inpOutletFittingsK'
    ];
    reactiveIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          readDomInputsToTag();
          recomputeAll();
        });
        el.addEventListener('change', () => {
          readDomInputsToTag();
          recomputeAll();
        });
      }
    });

    // Quick Inlet Fittings K-factor preset buttons
    document.querySelectorAll('.btn-inlet-k').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('inpInletFittingsK').value = btn.dataset.k;
        readDomInputsToTag();
        recomputeAll();
      });
    });

    // Select Optimal Compliant Inlet NPS button
    document.getElementById('btnAutoSelectInletNps').addEventListener('click', () => {
      const { hyd } = computeForTag(state.tag);
      document.getElementById('inpInletNps').value = hyd.inlet.recommendedNps;
      readDomInputsToTag();
      recomputeAll();
    });

    // Sync Built-Up Backpressure from Step 3 to Step 2
    document.getElementById('btnSyncBuiltUpToSizing').addEventListener('click', () => {
      const { hyd } = computeForTag(state.tag);
      state.tag.builtUpBackBarg = Number(hyd.outlet.builtUpBackBarg.toFixed(3));
      syncTagToDomInputs();
      recomputeAll();
    });

    // Save Current Tag to Register
    document.getElementById('btnSaveTagToRegister').addEventListener('click', () => {
      readDomInputsToTag();
      const copy = JSON.parse(JSON.stringify(state.tag));
      const existingIdx = state.register.findIndex(r => r.tagNumber === copy.tagNumber);
      if (existingIdx >= 0) {
        state.register[existingIdx] = copy;
      } else {
        state.register.push(copy);
      }
      saveRegisterToStorage();
      renderProjectRegisterTable();
      const btn = document.getElementById('btnSaveTagToRegister');
      const orig = btn.innerHTML;
      btn.innerHTML = '<span>✓ Saved to Register</span>';
      setTimeout(() => { btn.innerHTML = orig; }, 1400);
    });

    // Print / PDF IPDS Datasheet
    const triggerPrint = () => {
      switchTab('tab-ipds');
      setTimeout(() => window.print(), 150);
    };
    document.getElementById('btnPrintDatasheet').addEventListener('click', triggerPrint);
    document.getElementById('btnPrintIpdsView').addEventListener('click', triggerPrint);

    // Export Current Tag Datasheet CSV
    document.getElementById('btnExportCurrentCsv').addEventListener('click', () => {
      if (state.ipdsMode === 'pump') {
        const p = state.pumpLoop;
        const pr = E.calcPumpLoopHydraulics({ ...p, atmPressureBara: state.tag.atmPressureBara || 1.01325 });
        const rows = [
          ['PARAMETER', 'VALUE', 'UNITS / NOTES'],
          ['Pump Tag Number', p.pumpTag, p.project || state.tag.projectTitle],
          ['Service Description', p.service, p.FluidName || 'Process Liquid'],
          ['Liquid Density / Viscosity', pr.rhoKgM3.toFixed(1), `kg/m3 (SG=${pr.SG.toFixed(3)}), mu=${pr.viscCp} cP`],
          ['Normal / Rated Flow', `${pr.Q_normM3Hr.toFixed(1)} / ${pr.Q_ratedM3Hr.toFixed(1)}`, `m3/h (${pr.W_ratedKgHr.toFixed(0)} kg/h)`],
          ['Suction Nozzle Pressure', pr.suction.nozzleBarg.toFixed(2), `barg (Line: ${pr.suction.nps} ${pr.suction.schedule}, v=${pr.suction.velocityMS.toFixed(2)} m/s)`],
          ['Discharge Nozzle Pressure', pr.discharge.nozzleBarg.toFixed(2), `barg (Line: ${pr.discharge.nps} ${pr.discharge.schedule}, v=${pr.discharge.velocityMS.toFixed(2)} m/s)`],
          ['Total Differential Head (TDH)', pr.pump.tdhRatedM.toFixed(2), `m (${pr.pump.tdhRatedFt.toFixed(1)} ft) | dP = ${pr.pump.diffPressureRatedBar.toFixed(2)} bar`],
          ['Shutoff Head & Max Discharge Pressure', pr.pump.maxDischargeBarg.toFixed(2), `barg (Shutoff Head = ${pr.pump.shutoffHeadM.toFixed(1)} m)`],
          ['NPSHa vs NPSHr (API 610)', `${pr.npsh.npshaM.toFixed(2)} vs ${pr.npsh.npshrM.toFixed(2)}`, `m (Margin = ${pr.npsh.marginM.toFixed(2)} m — ${pr.npsh.compliant ? 'PASS' : 'FAIL'})`],
          ['Control Valve Allocated dP & Cv', pr.controlValve.allocatedDpRatedBar.toFixed(2), `bar (${pr.controlValve.pctOfDynamic.toFixed(1)}% Dyn) | Cv Min/Norm/Rated = ${pr.controlValve.min.reqCv.toFixed(1)} / ${pr.controlValve.normal.reqCv.toFixed(1)} / ${pr.controlValve.rated.reqCv.toFixed(1)}`],
          ['Hydraulic / Shaft / API 610 Motor Power', `${pr.pump.hydraulicPowerKw.toFixed(1)} / ${pr.pump.brakePowerKw.toFixed(1)} / ${pr.pump.selectedMotorKw}`, `kW (Pump Eff = ${pr.pump.pumpEfficiencyPct}%)`]
        ];
        exportCsvFile(`${escapeHtml(p.pumpTag)}_Pump_IPDS_Calculation.csv`, rows);
        return;
      }

      const t = state.tag;
      const { sizing: s, hyd: h } = computeForTag(t);
      const rows = [
        ['PARAMETER', 'VALUE', 'UNITS / NOTES'],
        ['PSV Tag Number', t.tagNumber, t.pidNumber],
        ['Service Description', t.service, t.equipmentProtected],
        ['Project / Client', t.projectTitle, t.clientName],
        ['Fluid Phase', t.fluidPhase.toUpperCase(), `MW=${t.mw}, k=${t.k}, Z=${t.z}, rho=${t.rhoLiqKgM3} kg/m3`],
        ['Required Relief Rate (W)', t.flowRateKgHr.toFixed(1), 'kg/h'],
        ['Set Pressure (P_set)', t.setPressureBarg.toFixed(2), 'barg'],
        ['Allowed Overpressure', t.overpressurePct.toFixed(1), '%'],
        ['Relieving Pressure (P1)', s.P1_bara.toFixed(3), 'bara'],
        ['Total Backpressure (P2)', s.P_backBarg.toFixed(2), 'barg'],
        ['Flow Regime', s.flowRegime, `P_cf = ${s.Pcf_bara.toFixed(3)} bara`],
        ['Required Orifice Area (A_req)', s.reqAreaMm2.toFixed(1), `mm2 (${s.reqAreaIn2.toFixed(4)} in2)`],
        ['Selected API 526 Orifice', s.selectedOrifice.letter, `${s.selectedOrifice.areaMm2} mm2 (${s.selectedOrifice.inletOutFlange})`],
        ['Valve Rated Capacity (W_rated)', s.ratedCapacityKgHr.toFixed(1), 'kg/h'],
        ['Inlet Line Size & Loss', `${h.inlet.nps} ${h.inlet.schedule}`, `dP = ${h.inlet.lossPctOfSet.toFixed(2)}% of P_set (Limit <= 3%)`],
        ['Outlet Line Size & Backpressure', `${h.outlet.nps} ${h.outlet.schedule}`, `P_bt = ${h.outlet.totalBackPctOfSet.toFixed(1)}% of P_set, Mach = ${h.outlet.machNumber.toFixed(2)}`],
        ['Discharge Reaction Force (Fr)', h.outlet.reactionForceKn.toFixed(2), `kN (${Math.round(h.outlet.reactionForceLbf)} lbf)`]
      ];
      exportCsvFile(`${escapeHtml(t.tagNumber)}_IPDS_Calculation.csv`, rows);
    });

    // Register Actions (Restore Presets, Export CSV, Export/Import JSON)
    document.getElementById('btnResetDefaultPresets').addEventListener('click', () => {
      state.register = JSON.parse(JSON.stringify(E.EPC_TAG_PRESETS));
      saveRegisterToStorage();
      renderProjectRegisterTable();
    });

    document.getElementById('btnExportRegisterCsv').addEventListener('click', () => {
      const header = [
        'Tag Number', 'Service', 'Protected Equipment', 'P&ID', 'Phase', 'Governing Scenario',
        'Set Pressure (barg)', 'Overpressure (%)', 'Relief Rate (kg/h)', 'Req Area (mm2)', 'Req Area (in2)',
        'API 526 Orifice', 'Flange Size', 'Inlet NPS', 'Inlet dP (%)', 'Outlet NPS', 'Total Backpressure (%)', 'Outlet Mach'
      ];
      const rows = [header];
      state.register.forEach(item => {
        const { sizing: s, hyd: h } = computeForTag(item);
        rows.push([
          item.tagNumber, item.service, item.equipmentProtected, item.pidNumber,
          item.fluidPhase, item.governingScenarioKey,
          item.setPressureBarg.toFixed(2), item.overpressurePct.toFixed(0),
          item.flowRateKgHr.toFixed(0), s.reqAreaMm2.toFixed(1), s.reqAreaIn2.toFixed(4),
          s.selectedOrifice.letter, s.selectedOrifice.inletOutFlange,
          item.inletNps, h.inlet.lossPctOfSet.toFixed(2),
          item.outletNps, h.outlet.totalBackPctOfSet.toFixed(1), h.outlet.machNumber.toFixed(2)
        ]);
      });
      exportCsvFile('PSV_Project_Tag_Register.csv', rows);
    });

    document.getElementById('btnExportRegisterJson').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state.register, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'psvcalc_project_register.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    document.getElementById('inpImportRegisterJson').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (Array.isArray(parsed) && parsed.length > 0) {
            state.register = parsed;
            state.tag = JSON.parse(JSON.stringify(parsed[0]));
            saveRegisterToStorage();
            syncTagToDomInputs();
            renderScenarioForm();
            recomputeAll();
          }
        } catch (err) {
          alert('Invalid PSV project JSON file.');
        }
      };
      reader.readAsText(file);
    });

    // Dark/Light Theme Toggle
    document.getElementById('btnThemeToggle').addEventListener('click', () => {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      document.getElementById('themeToggleLabel').textContent = next === 'dark' ? 'Light Mode' : 'Dark Mode';
    });
  }

  // Boot application
  document.addEventListener('DOMContentLoaded', () => {
    loadRegisterFromStorage();
    syncTagToDomInputs();
    syncPumpToDomInputs();
    renderScenarioForm();
    initEventListeners();
    recomputeAll();
  });
})();
