/**
 * PSVCalc Pro — Step 7 Engineering Toolkit plug-in registry.
 *
 * Every toolkit module lives in its own file (tools/<id>.js) and calls PSVTools.register(tool).
 *
 * Tool contract:
 *   {
 *     id: 'twophase',                     // unique, kebab/lowercase
 *     title: 'Two-Phase Line Sizing',      // sub-nav label
 *     std: 'Beggs-Brill · API RP 14E',     // standards badge
 *     calc(input) -> result,               // PURE function, SI canonical units, no DOM access
 *     defaultState() -> object,            // canonical SI input state
 *     presets?: [{ id, label, state }],
 *     mount(container, ctx),               // renders inputs + outputs + SVG + trace into container
 *     getState() -> object,                // current canonical SI input state (JSON-serialisable)
 *     setState(state),                     // restore state and re-render if mounted
 *     summaryRows() -> [[param, value, units], ...]   // for PDF report / Excel / Ask PSV
 *   }
 *
 * ctx (passed to mount): see buildCtx() below.
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
      /** Navigate to a main workflow tab id, e.g. 'tab-sizing'. */
      switchTab: (tabId) => app && app.switchTab(tabId),
      /** Notify that tool outputs changed (lets the report / Ask PSV refresh). */
      notifyChanged: () => { if (app && app.onToolChanged) app.onToolChanged(); }
    };
  }

  function renderNav() {
    const nav = document.getElementById('toolkitNav');
    if (!nav) return;
    nav.innerHTML = tools.map(t => `
      <button type="button" class="seg-btn toolkit-nav-btn ${t.id === activeId ? 'active' : ''}" data-tool="${escapeHtml(t.id)}" id="toolkitBtn-${escapeHtml(t.id)}">
        ${escapeHtml(t.title)}
      </button>`).join('');
    nav.querySelectorAll('.toolkit-nav-btn').forEach(btn => btn.addEventListener('click', () => activate(btn.dataset.tool)));
  }

  function activate(id) {
    const tool = tools.find(t => t.id === id) || tools[0];
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
    get: (id) => tools.find(t => t.id === id),
    activate,
    get activeId() { return activeId; },
    init() {
      renderNav();
      if (tools.length) activate(activeId || tools[0].id);
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
