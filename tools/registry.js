/**
 * PSVCalc Pro — Engineering Toolkit & Standalone Module plug-in registry.
 *
 * Every toolkit module lives in its own file (tools/<id>.js) and calls PSVTools.register(tool).
 * Modules with `standaloneTab: 'tab-...'` mount directly into their own top-level workflow tab
 * while remaining first-class members of exportState(), importState(), allSummaries(), and unit sync.
 */
(function () {
  const tools = [];
  let activeId = null;
  let mountedIds = new Set();
  const unitListeners = new Set();

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function buildCtx() {
    const app = (typeof window !== 'undefined' && window.PSVApp) || null;
    return {
      E: typeof window !== 'undefined' ? window.PSVEngine : null,
      U: typeof window !== 'undefined' && window.PSVEngine ? window.PSVEngine.Units : null,
      isUSC: () => (app ? app.getUnitSystem() === 'USC' : false),
      escapeHtml,
      /** Subscribe to SI<->USC toggles; callback re-renders inputs/outputs in the active unit system. */
      onUnitChange: (fn) => { unitListeners.add(fn); return () => unitListeners.delete(fn); },
      /** Read-only snapshots of the main workbench. */
      getPsvTag: () => (app ? app.getTag() : null),
      getVesselResult: () => (app ? app.getVesselResult() : null),
      getPumpResult: () => (app ? app.getPumpResult() : null),
      /** Push a partial patch (canonical SI keys of state.tag) into Step 2 and recompute. */
      applyToPsvTag: (patch, goToTab) => app && app.applyTagPatch(patch, goToTab),
      /** Push Control Valve sizing results into Step 1D (CV Fail-Open PSV relief scenario). */
      applyControlValveToStep1D: (payload) => app && app.applyControlValveToStep1D && app.applyControlValveToStep1D(payload),
      /** Switch to Step 5 IPDS Datasheet in Control Valve (ISA-20) mode. */
      openCvIpds: () => app && app.openCvIpds && app.openCvIpds(),
      /** Navigate to a main workflow tab id, e.g. 'tab-sizing'. */
      switchTab: (tabId) => app && app.switchTab(tabId),
      /** Notify that tool outputs changed (lets the report / Ask PSV refresh). */
      notifyChanged: () => { if (app && app.onToolChanged) app.onToolChanged(); }
    };
  }

  function toolkitTools() {
    return tools.filter(t => !t.standaloneTab);
  }

  function renderNav() {
    const nav = document.getElementById('toolkitNav');
    if (!nav) return;
    const tk = toolkitTools();
    nav.innerHTML = tk.map(t => `
      <button type="button" class="seg-btn toolkit-nav-btn ${t.id === activeId ? 'active' : ''}" data-tool="${escapeHtml(t.id)}" id="toolkitBtn-${escapeHtml(t.id)}">
        ${escapeHtml(t.title)}
      </button>`).join('');
    nav.querySelectorAll('.toolkit-nav-btn').forEach(btn => btn.addEventListener('click', () => activate(btn.dataset.tool)));
  }

  function mountStandalone(tool) {
    if (!tool || !tool.standaloneTab || mountedIds.has(tool.id)) return;
    const tabEl = document.getElementById(tool.standaloneTab);
    if (!tabEl) return;
    let pane = document.getElementById(`toolPane-${tool.id}`);
    if (!pane) {
      pane = document.createElement('div');
      pane.className = 'toolkit-tool-pane';
      pane.dataset.tool = tool.id;
      pane.id = `toolPane-${tool.id}`;
      tabEl.appendChild(pane);
    }
    try {
      tool.mount(pane, buildCtx());
      mountedIds.add(tool.id);
    } catch (err) {
      pane.innerHTML = `<div class="panel"><div class="panel-body" style="color:var(--fail-text);">Module failed to load: ${escapeHtml(err.message)}</div></div>`;
      console.error(err);
    }
  }

  function activate(id) {
    const target = tools.find(t => t.id === id);
    if (target && target.standaloneTab) {
      mountStandalone(target);
      const app = (typeof window !== 'undefined' && window.PSVApp) || null;
      if (app && app.switchTab) app.switchTab(target.standaloneTab);
      return;
    }
    const tk = toolkitTools();
    const tool = tk.find(t => t.id === id) || tk[0];
    if (!tool) return;
    activeId = tool.id;
    const host = document.getElementById('toolkitMount');
    if (!host) return;
    host.querySelectorAll('.toolkit-tool-pane').forEach(p => { p.style.display = p.dataset.tool === tool.id ? '' : 'none'; });
    let pane = host.querySelector(`.toolkit-tool-pane[data-tool="${tool.id}"]`);
    if (!pane) {
      pane = document.createElement('div');
      pane.className = 'toolkit-tool-pane';
      pane.dataset.tool = tool.id;
      pane.id = `toolPane-${tool.id}`;
      host.appendChild(pane);
    }
    if (!mountedIds.has(tool.id)) {
      try {
        tool.mount(pane, buildCtx());
        mountedIds.add(tool.id);
      } catch (err) {
        pane.innerHTML = `<div class="panel"><div class="panel-body" style="color:var(--fail-text);">Tool failed to load: ${escapeHtml(err.message)}</div></div>`;
        console.error(err);
      }
    }
    renderNav();
  }

  const PSVTools = {
    register(tool) {
      if (!tool || !tool.id || tools.some(t => t.id === tool.id)) return;
      tools.push(tool);
      if (typeof document !== 'undefined' && document.readyState !== 'loading') renderNav();
    },
    list: () => tools.slice(),
    toolkitList: () => toolkitTools(),
    get: (id) => tools.find(t => t.id === id),
    activate,
    mountStandalone,
    get activeId() { return activeId; },
    init() {
      renderNav();
      tools.filter(t => t.standaloneTab).forEach(mountStandalone);
      const tk = toolkitTools();
      if (tk.length) activate(activeId || tk[0].id);
    },
    notifyUnitChange() { unitListeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },
    exportState() {
      const out = {};
      tools.forEach(t => { try { out[t.id] = t.getState(); } catch (_) { /* ignore */ } });
      return out;
    },
    importState(obj) {
      if (!obj || typeof obj !== 'object') return;
      tools.forEach(t => { if (obj[t.id]) { try { t.setState(obj[t.id]); } catch (e) { console.error(e); } } });
    },
    /** [{ id, title, std, rows }] for every tool, computed from current state (works even if never mounted). */
    allSummaries() {
      return tools.map(t => {
        let rows = [];
        try { rows = t.summaryRows(); } catch (_) { rows = []; }
        return { id: t.id, title: t.title, std: t.std, rows };
      });
    },
    escapeHtml
  };

  if (typeof window !== 'undefined') window.PSVTools = PSVTools;
  if (typeof module !== 'undefined' && module.exports) module.exports = PSVTools;
})();
