window.__ModuleLoader__.load({
  id: 'annot-dsh',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /**
     * Host routes are documented-relative (no leading slash) on purpose: the
     * GUI is served with <base href="./">, so a root-absolute /api/... escapes
     * a sub-path deployment and never reaches the route.
     */
    const API = {
      status: 'api/annot/status',
      selfcheck: 'api/annot/selfcheck',
      report: 'api/annot/selfcheck/report',
      list: 'api/annot/list',
      search: 'api/annot/search',
      flow: 'api/annot/flow',
      audit: 'api/annot/audit',
    };

    const NODE_COLORS = {
      stage: { fill: '#eef2ff', stroke: '#6366f1', text: '#1e1b4b' },
      decision: { fill: '#fff7ed', stroke: '#f97316', text: '#431407' },
      gate: { fill: '#fef2f2', stroke: '#dc2626', text: '#450a0a' },
      artifact: { fill: '#ecfdf5', stroke: '#059669', text: '#022c22' },
      external: { fill: '#f0f9ff', stroke: '#0284c7', text: '#082f49' },
    };
    const TYPE_LABEL = { stage: '阶段', decision: '判定', gate: '门禁', artifact: '产物', external: '外部调用' };
    /** Node flags are machine names; a reviewer reads the consequence. */
    const FLAG_LABEL = {
      'low-confidence': '置信度偏低',
      'unresolved-branch': '分支未落地',
      'empty-label': '标签为空',
      'empty-body': '正文为空',
      stale: '源文件已改，锚点可疑',
      broken: '锚点找不到原文',
    };

    async function request(url) {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return payload;
    }

    // ---- styles -----------------------------------------------------------
    // Only theme tokens for host-like surfaces; the node palette is artwork and
    // keeps its own colors so the graph reads the same in light and dark.
    //
    // Two rules here are not style opinions:
    //   - `font:` shorthand may not contain `inherit` as a family, so the whole
    //     declaration is dropped by the parser. Sizes are set with `font-size`
    //     and the family is inherited from the host on purpose.
    //   - the side column is `minmax(240px, 320px)` so a narrow pane shrinks it
    //     instead of clipping it, and the layout stacks below 560px because a
    //     320px fixed track leaves the graph no width at all.
    const STYLE = `
      .annot-root { display:flex; flex-direction:column; height:100%; min-height:0; font-size:13px; line-height:1.5; color: var(--dsw-alias-label-primary); }
      .annot-bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:10px 14px; border-bottom:1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
      .annot-bar h1 { font-size:14px; margin:0; font-weight:650; }
      .annot-pill { font-size:11.5px; padding:1px 8px; border-radius:999px; border:1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); white-space:nowrap; }
      .annot-pill b { color: var(--dsw-alias-label-primary); font-weight:650; }
      .annot-pill.warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
      .annot-pill.on { border-color: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); background: var(--dsw-alias-button-primary-fill); }
      .annot-body { display:grid; grid-template-columns: minmax(0,1fr) minmax(240px,320px); flex:1; min-height:0; }
      .annot-canvas { overflow:auto; padding:14px; min-width:0; }
      .annot-side { border-left:1px solid var(--dsw-alias-border-l1); overflow:auto; padding:12px 14px 32px; background: var(--dsw-alias-bg-base); min-width:0; }
      .annot-side h2 { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color: var(--dsw-alias-label-tertiary); margin:14px 0 6px; font-weight:650; }
      .annot-side h2:first-child { margin-top:0; }
      .annot-kv { display:grid; grid-template-columns:64px 1fr; gap:4px 10px; margin:0; font-size:12.5px; }
      .annot-kv dt { color: var(--dsw-alias-label-tertiary); }
      .annot-kv dd { margin:0; word-break:break-word; }
      .annot-raw { white-space:pre-wrap; background: color-mix(in oklab, var(--dsw-alias-bg-base), var(--dsw-alias-label-primary) 4%); border:1px solid var(--dsw-alias-border-l1); border-radius:8px; padding:8px; font-size:11.5px; line-height:1.55; font-family: ui-monospace, Consolas, monospace; max-height:240px; overflow:auto; margin:0; }
      .annot-list { list-style:none; margin:0; padding:0; }
      .annot-list li { margin:0; }
      .annot-list button { all:unset; display:block; width:100%; box-sizing:border-box; padding:5px 8px; border-radius:6px; cursor:pointer; font-size:12.5px; line-height:1.4; }
      .annot-list button:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .annot-list button:focus-visible { outline:2px solid var(--dsw-alias-button-primary-fill); outline-offset:1px; }
      .annot-list button.on { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
      .annot-muted { color: var(--dsw-alias-label-tertiary); font-size:12px; margin:6px 0; }
      .annot-busy { display:flex; align-items:center; gap:7px; font-size:12px; color: var(--dsw-alias-label-secondary); margin:6px 0; }
      .annot-spin { width:11px; height:11px; border-radius:50%; border:2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-button-primary-fill); animation: annot-spin .7s linear infinite; }
      @keyframes annot-spin { to { transform: rotate(360deg); } }
      .annot-error { color: var(--dsw-alias-state-error-primary); font-size:12.5px; white-space:pre-wrap; }
      .annot-tag { display:inline-block; font-size:11px; padding:0 7px; border-radius:999px; border:1px solid var(--dsw-alias-border-l1); margin:0 4px 4px 0; }
      .annot-tag.warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
      .annot-tag.bad { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
      .annot-tag.ok { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
      .annot-node { cursor:pointer; }
      .annot-node:focus-visible { outline:none; }
      .annot-node:focus-visible rect:first-of-type { stroke-width:3; }
      .annot-node rect { transition: filter .12s ease, stroke-width .12s ease; }
      .annot-node:hover rect:first-of-type { filter: drop-shadow(0 2px 8px color-mix(in oklab, var(--dsw-alias-label-primary), transparent 78%)); stroke-width:2.4; }
      .annot-node.sel rect:first-of-type { stroke-width:3; }
      .annot-node text { pointer-events:none; }
      .annot-legend { display:flex; gap:10px; flex-wrap:wrap; align-items:center; font-size:11px; color: var(--dsw-alias-label-tertiary); margin:0 0 10px; }
      .annot-legend i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
      .annot-tabs { display:flex; gap:6px; padding:0 14px; border-bottom:1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
      .annot-tabs button { all:unset; cursor:pointer; padding:7px 10px; font-size:12.5px; color: var(--dsw-alias-label-secondary); border-bottom:2px solid transparent; }
      .annot-tabs button:focus-visible { outline:2px solid var(--dsw-alias-button-primary-fill); outline-offset:-2px; }
      .annot-tabs button.on { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-button-primary-fill); }
      .annot-scroll { overflow:auto; }
      .annot-table { width:100%; border-collapse:collapse; font-size:12.5px; }
      .annot-table th, .annot-table td { text-align:left; padding:5px 8px; border-bottom:1px solid var(--dsw-alias-border-l1); white-space:nowrap; }
      .annot-table th { color: var(--dsw-alias-label-tertiary); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
      .annot-table td.num { text-align:right; font-variant-numeric: tabular-nums; }
      .annot-table tbody tr { cursor:pointer; }
      .annot-table tbody tr:hover { background: var(--dsw-alias-interactive-bg-hover); }
      @media (max-width: 560px) {
        .annot-body { grid-template-columns: minmax(0,1fr); }
        .annot-side { border-left:0; border-top:1px solid var(--dsw-alias-border-l1); }
      }
    `;

    /**
     * Injects the stylesheet once per page.
     *
     * Deliberately no cleanup: the loading tree and the installed tree are
     * different component instances, so unmounting the first one used to remove
     * the <style> tag and the next frame re-added it — a flash of unstyled
     * panel every time `status.loading` flipped. A page-lifetime stylesheet
     * that is only ever added is the correct owner here.
     */
    function StyleOnce() {
      React.useEffect(() => {
        const id = 'annot-dsh-style';
        if (document.getElementById(id)) return;
        const el = document.createElement('style');
        el.id = id;
        el.textContent = STYLE;
        document.head.appendChild(el);
      }, []);
      return null;
    }

    // ---- graph ------------------------------------------------------------
    function Graph({ layout, doc, selected, onSelect, svgRef }) {
      React.useEffect(() => {
        const svg = svgRef.current;
        if (!svg || !layout) return;
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        const ns = 'http://www.w3.org/2000/svg';
        const el = (tag, attrs) => {
          const node = document.createElementNS(ns, tag);
          for (const key in attrs || {}) node.setAttribute(key, String(attrs[key]));
          return node;
        };

        svg.setAttribute('width', String(layout.width));
        svg.setAttribute('height', String(layout.height));
        svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);

        for (const id of ['arrow-seq', 'arrow-branch']) {
          const marker = el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
          marker.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: id === 'arrow-branch' ? '#f97316' : '#94a3b8' }));
          svg.appendChild(marker);
        }

        for (const edge of layout.edges) {
          const isBranch = edge.kind === 'branch';
          const attrs = {
            d: edge.d,
            fill: 'none',
            stroke: isBranch ? '#f97316' : '#cbd5e1',
            'stroke-width': isBranch ? 1.6 : 1.7,
            'marker-end': `url(#${isBranch ? 'arrow-branch' : 'arrow-seq'})`,
          };
          // `setAttribute(key, 'null')` is not the same as omitting the attribute:
          // it sets a literal string the parser then drops. Only add when real.
          if (isBranch) attrs['stroke-dasharray'] = '5 4';
          svg.appendChild(el('path', attrs));
        }

        for (const node of layout.nodes) {
          const group = el('g', {
            class: `annot-node${selected === node.id ? ' sel' : ''}`,
            'data-id': node.id,
            transform: `translate(${node.x} ${node.y})`,
            // The graph is the primary reading surface; keyboard access is not
            // optional decoration. tabindex + role + Enter/Space mirror a button.
            tabindex: '0',
            role: 'button',
            'aria-label': `${node.label}，${TYPE_LABEL[node.type] || node.type}，第 ${node.anchor.start} 到 ${node.anchor.end} 行`,
          });
          const colors = NODE_COLORS[node.type] || NODE_COLORS.stage;
          group.appendChild(el('rect', { x: 0, y: 0, width: node.w, height: node.h, rx: 10, fill: colors.fill, stroke: colors.stroke, 'stroke-width': 1.6 }));
          group.appendChild(el('rect', { x: 0, y: 0, width: 4, height: node.h, rx: 2, fill: colors.stroke }));

          const lines = fitLines(node.label, 30, 2);
          lines.forEach((line, index) => {
            const text = el('text', { x: 14, y: index === 0 ? 26 : 42, 'font-size': 12, fill: colors.text });
            text.textContent = line;
            group.appendChild(text);
          });
          const meta = el('text', { x: 14, y: 55, 'font-size': 10, fill: colors.stroke, opacity: 0.9 });
          meta.textContent = `${TYPE_LABEL[node.type] || node.type} · L${node.anchor.start}-${node.anchor.end}`;
          group.appendChild(meta);

          // Two different "look at this" signals, both documented:
          //   amber count  = branches this node declares whose other end is unknown
          //   warn dot     = the extractor itself is under 60% sure of this node
          const branches = Array.isArray(node.branches) ? node.branches : [];
          const open = branches.filter((branch) => !branch.to).length;
          if (open > 0) {
            group.appendChild(el('circle', { cx: node.w - 14, cy: 13, r: 7, fill: '#fef3c7' }));
            const badge = el('text', { x: node.w - 14, y: 16.5, 'font-size': 9.5, fill: '#92400e', 'text-anchor': 'middle', 'font-weight': 700 });
            badge.textContent = String(open);
            group.appendChild(badge);
          }
          if (node.confidence < 0.6) {
            group.appendChild(el('circle', { cx: node.w - (open > 0 ? 32 : 14), cy: 13, r: 4.5, fill: '#f59e0b', 'data-role': 'low-confidence' }));
          }

          const choose = () => onSelect(node.id);
          group.addEventListener('click', choose);
          group.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            choose();
          });
          svg.appendChild(group);
        }
      }, [layout, selected, onSelect, svgRef]);

      return h('div', null, h(Legend), h('svg', { ref: svgRef, role: 'img', 'aria-label': doc ? `${doc.skill} 的流程图` : '流程图' }));
    }

    /** The artifact has a legend; the panel promises the same reading without one. */
    function Legend() {
      return h(
        'div',
        { className: 'annot-legend' },
        Object.entries(TYPE_LABEL).map(([type, label]) =>
          h('span', { key: type }, h('i', { style: { background: (NODE_COLORS[type] || NODE_COLORS.stage).stroke } }), label),
        ),
        h('span', null, h('i', { style: { background: '#f59e0b', borderRadius: '50%' } }), '置信度低'),
      );
    }

    /** Rough CJK-aware wrap: the same budget the artifact uses, kept simple here. */
    function fitLines(label, maxUnits, maxLines) {
      const text = String(label || '');
      const lines = [];
      let current = '';
      let units = 0;
      for (const char of text) {
        const width = /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1;
        if (units + width > maxUnits && current !== '') {
          lines.push(current);
          if (lines.length === maxLines) return trimLast(lines);
          current = '';
          units = 0;
        }
        current += char;
        units += width;
      }
      if (current !== '') lines.push(current);
      return trimLast(lines.slice(0, maxLines));
    }

    /** Drop trailing empty lines so an overflowed label never draws a blank row. */
    function trimLast(lines) {
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      return lines.length === 0 ? [''] : lines;
    }

    // ---- host -------------------------------------------------------------
    function useAnnot() {
      const [status, setStatus] = React.useState({ loading: true });
      const [skills, setSkills] = React.useState([]);
      const [scan, setScan] = React.useState({ skipped: [], total: 0 });
      const [audit, setAudit] = React.useState(null);
      const [auditting, setAuditting] = React.useState(false);
      const [current, setCurrent] = React.useState(null);
      const [selected, setSelected] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [tab, setTab] = React.useState('graph');
      const [query, setQuery] = React.useState('');
      const [search, setSearch] = React.useState(null);
      const [searching, setSearching] = React.useState(false);

      // Every request that can be superseded carries a ticket. A response whose
      // ticket is no longer the latest is dropped, which is the only way a slow
      // first answer cannot overwrite a fast second one — the classic
      // "I cleared the box and the old results came back" bug.
      const tickets = React.useRef({ list: 0, search: 0, flow: 0, audit: 0 });
      const stamp = (key) => {
        tickets.current[key] += 1;
        return tickets.current[key];
      };
      const stale = (key, ticket) => tickets.current[key] !== ticket;

      const loadList = React.useCallback(async (options = {}) => {
        const ticket = stamp('list');
        setError(null);
        try {
          const payload = await request(`${API.list}${options.fresh ? '?fresh=1' : ''}`);
          if (stale('list', ticket)) return;
          setSkills(payload.skills || []);
          setScan({ skipped: payload.skipped || [], total: (payload.skills || []).length });
          setStatus((previous) => ({ ...previous, loading: false }));
        } catch (failure) {
          if (stale('list', ticket)) return;
          // A failed *list* says nothing about whether the CLI is installed;
          // only /status can answer that. Claiming "not installed" here is how
          // a permissions error turns into a wrong installation instruction.
          setError(failure.message);
          setStatus((previous) => ({ ...previous, loading: false }));
        }
      }, []);

      const loadAudit = React.useCallback(async () => {
        const ticket = stamp('audit');
        setError(null);
        setAuditting(true);
        // The table is the point of the click, so show it while it fills rather
        // than leaving the user on a graph wondering whether anything happened.
        setTab('audit');
        try {
          const payload = await request(API.audit);
          if (stale('audit', ticket)) return;
          setAudit(payload);
        } catch (failure) {
          if (stale('audit', ticket)) return;
          setError(failure.message);
        } finally {
          if (!stale('audit', ticket)) setAuditting(false);
        }
      }, []);

      /**
       * Search hits the server so the ranking lives in one place (the CLI). An
       * empty query clears back to the full list instead of returning nothing:
       * "no filter" and "no match" must not look the same.
       */
      const runSearch = React.useCallback(async (text, deep) => {
        const trimmed = String(text || '').trim();
        const ticket = stamp('search');
        setQuery(text);
        if (trimmed === '') {
          setSearch(null);
          setSearching(false);
          setError(null);
          return;
        }
        setSearching(true);
        setError(null);
        try {
          const payload = await request(`${API.search}?q=${encodeURIComponent(trimmed)}${deep ? '&body=1' : ''}`);
          if (stale('search', ticket)) return;
          setSearch(payload);
        } catch (failure) {
          if (stale('search', ticket)) return;
          setSearch(null);
          setError(failure.message);
        } finally {
          if (!stale('search', ticket)) setSearching(false);
        }
      }, []);

      const openSkill = React.useCallback(async (skill, options = {}) => {
        const ticket = stamp('flow');
        setError(null);
        setCurrent({ loading: true, skill });
        if (!options.keepSelection) setSelected(null);
        try {
          const payload = await request(`${API.flow}?path=${encodeURIComponent(skill.file)}`);
          if (stale('flow', ticket)) return;
          setCurrent({ ...payload, skill });
          // Keep the node the user was reading when re-opening the same skill;
          // jumping back to node 0 loses their place for no reason.
          const firstNode = payload.layout && payload.layout.nodes.length ? payload.layout.nodes[0].id : null;
          setSelected((previous) => (options.keepSelection && previous ? previous : firstNode));
          setTab('graph');
        } catch (failure) {
          if (stale('flow', ticket)) return;
          setCurrent({ skill, error: failure.message });
          setError(failure.message);
        }
      }, []);

      /** Re-open whatever is on screen, after invalidating the scan cache. */
      const refresh = React.useCallback(async () => {
        await loadList({ fresh: true });
        if (current && current.skill) await openSkill(current.skill, { keepSelection: true });
      }, [current, loadList, openSkill]);

      React.useEffect(() => {
        request(API.status)
          .then((payload) => setStatus({ loading: false, installed: Boolean(payload.installed), roots: payload.roots || [] }))
          .catch((failure) => setStatus({ loading: false, installed: false, roots: [], statusError: failure.message }));
        loadList();
      }, [loadList]);

      return {
        status,
        skills,
        scan,
        audit,
        auditting,
        current,
        selected,
        setSelected,
        error,
        tab,
        setTab,
        loadList,
        loadAudit,
        openSkill,
        refresh,
        query,
        search,
        searching,
        runSearch,
      };
    }

    function Detail({ doc, nodeId }) {
      if (!doc) return h('p', { className: 'annot-muted' }, '从右边的列表里搜一个 skill，点它出图。');
      if (!nodeId) return h('p', { className: 'annot-muted' }, '点一个方块查看它的原文与锚点。');
      const node = doc.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return h('p', { className: 'annot-muted' }, '节点已不在当前图里。');
      const branches = Array.isArray(node.branches) ? node.branches : [];
      const flags = (Array.isArray(node.flags) ? node.flags : []).map((flag) =>
        h(
          'span',
          { key: flag, className: `annot-tag ${flag === 'stale' || flag === 'broken' ? 'bad' : 'warn'}` },
          FLAG_LABEL[flag] || flag,
        ),
      );
      return h(
        'div',
        null,
        h('h2', null, '节点'),
        h(
          'dl',
          { className: 'annot-kv' },
          h('dt', null, '类型'),
          h('dd', null, TYPE_LABEL[node.type] || node.type),
          h('dt', null, '置信度'),
          h('dd', null, `${Math.round(node.confidence * 100)}%${node.confidence < 0.6 ? '（偏低）' : ''}`),
          h('dt', null, '锚点'),
          h(
            'dd',
            null,
            h('code', null, `${doc.source.file}:${node.anchor.start}–${node.anchor.end}`),
            h('span', { className: 'annot-muted', style: { display: 'block', fontSize: 11 } }, `行哈希 ${node.anchor.sha.slice(0, 12)}`),
          ),
          h('dt', null, '小节'),
          h('dd', null, (node.anchor.heading || []).join(' › ') || '(前言)'),
          flags.length ? h('dt', null, '标记') : null,
          flags.length ? h('dd', null, flags) : null,
        ),
        h('h2', null, '分支'),
        branches.length === 0
          ? h('p', { className: 'annot-muted' }, '无')
          : h(
              'ul',
              { className: 'annot-list' },
              branches.map((branch, index) =>
                h(
                  'li',
                  { key: index, style: { padding: '2px 0' } },
                  h('code', null, branch.when),
                  branch.to ? ` → ${branch.to}` : h('span', { className: 'annot-tag warn' }, '未绑定'),
                ),
              ),
            ),
        h('h2', null, '原文'),
        h('pre', { className: 'annot-raw' }, node.raw),
      );
    }

    function AuditTable({ audit, auditting, onOpen }) {
      if (auditting && !audit) {
        return h('div', null, h('div', { className: 'annot-busy' }, h('i', { className: 'annot-spin' }), '正在逐个 skill 跑抽取…整库通常要几秒'));
      }
      if (!audit) return h('p', { className: 'annot-muted' }, '尚未运行整库审计。点右上角「运行整库审计」。');
      const rows = audit.audits || [];
      return h(
        'div',
        null,
        h(
          'p',
          { className: 'annot-muted' },
          `${audit.total} 个 skill，${audit.clean} 个零瑕疵。分数越高说明抽取结果越差。点一行打开它。`,
        ),
        auditting ? h('div', { className: 'annot-busy' }, h('i', { className: 'annot-spin' }), '重新审计中…') : null,
        h(
          'div',
          { className: 'annot-scroll' },
          h(
            'table',
            { className: 'annot-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                ['分数', '节点', '低置信', '未绑定', '空标签', 'skill'].map((label) => h('th', { key: label }, label)),
              ),
            ),
            h(
              'tbody',
              null,
              rows.map((row) =>
                h(
                  'tr',
                  {
                    key: row.skill,
                    tabindex: '0',
                    role: 'button',
                    title: row.file,
                    onClick: () => onOpen && onOpen({ name: row.skill, file: row.file }),
                    onKeyDown: (event) => {
                      if ((event.key === 'Enter' || event.key === ' ') && onOpen) {
                        event.preventDefault();
                        onOpen({ name: row.skill, file: row.file });
                      }
                    },
                  },
                  h('td', { className: 'num' }, row.score.toFixed(1)),
                  h('td', { className: 'num' }, String(row.nodes)),
                  h('td', { className: 'num' }, String(row.lowConfidence)),
                  h('td', { className: 'num' }, String(row.unresolvedBranches)),
                  h('td', { className: 'num' }, String(row.junkLabels ?? 0)),
                  h('td', null, row.skill),
                ),
              ),
            ),
          ),
        ),
        rows.length < (audit.total || 0)
          ? h('p', { className: 'annot-muted' }, `表格只显示前 ${rows.length} 个，另有 ${audit.total - rows.length} 个未列出。`)
          : null,
      );
    }

    /**
     * The sidebar answers three questions in one place, because they are the
     * same question at three levels of specificity: what exists (the list), what
     * do I vaguely remember (search), show me this one (open).
     *
     * The search box debounces and is the only thing that changes the list, so
     * an empty box always means "everything" — a filtered list that looks like
     * the full list is how a reviewer concludes a skill is missing.
     */
    function SearchPanel({ skills, query, search, searching, onSearch, onOpen, current, scan }) {
      const [deep, setDeep] = React.useState(false);
      const [draft, setDraft] = React.useState(query || '');
      const timer = React.useRef(null);

      // Clearing the pending timer on unmount matters: a stray debounce firing
      // after the panel is gone would search against a dead component.
      React.useEffect(() => () => timer.current && clearTimeout(timer.current), []);

      const schedule = (text, useBody) => {
        setDraft(text);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onSearch(text, useBody), 180);
      };

      const matches = search && Array.isArray(search.matches) ? search.matches : null;
      const shown = matches
        ? matches.map((m) => ({ name: m.name, file: m.file, hits: m.hits, score: m.score, description: m.description }))
        : (skills || []).map((s) => ({ name: s.name, file: s.file, hits: [], score: null, description: s.description }));

      const skipped = (scan && scan.skipped) || [];

      return h(
        'div',
        null,
        h('h2', null, '找一个 skill'),
        h(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'center', margin: '0 0 8px' } },
          h('input', {
            value: draft,
            placeholder: '名字 / 描述 / 标题',
            'aria-label': '搜索 skill',
            onChange: (event) => schedule(event.target.value, deep),
            style: {
              flex: 1,
              minWidth: 0,
              padding: '5px 8px',
              borderRadius: 6,
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: '12.5px',
            },
          }),
          h(
            'button',
            {
              className: `annot-pill${deep ? ' on' : ''}`,
              style: { cursor: 'pointer' },
              title: deep ? '当前会搜索正文，命中更多也更慢；再点一次回到只看标题' : '只在名字 / 描述 / 标题里找；点一下加搜正文',
              'aria-pressed': deep ? 'true' : 'false',
              onClick: () => {
                setDeep(!deep);
                if (draft.trim() !== '') onSearch(draft, !deep);
              },
            },
            deep ? '含正文' : '只看标题',
          ),
        ),
        searching ? h('div', { className: 'annot-busy' }, h('i', { className: 'annot-spin' }), '搜索中…') : null,
        matches && matches.length === 0
          ? h('p', { className: 'annot-muted' }, `没有匹配「${query}」。切到「含正文」再试，或清空搜索框看全部。`)
          : null,
        matches
          ? h('p', { className: 'annot-muted' }, `${matches.length} 个匹配${search.body ? '（含正文）' : '（名称·描述·标题）'}`)
          : h('p', { className: 'annot-muted' }, `${(skills || []).length} 个 skill${skipped.length ? `，${skipped.length} 个根目录读不到` : ''}`),
        skipped.length
          ? h(
              'ul',
              { className: 'annot-muted', style: { paddingLeft: 16, margin: '4px 0 8px' } },
              skipped.map((entry, index) => h('li', { key: index }, `读不到 ${entry.root}：${entry.reason}`)),
            )
          : null,
        h(
          'ul',
          { className: 'annot-list' },
          shown.map((item) =>
            h(
              'li',
              { key: item.file },
              h(
                'button',
                {
                  className: current && current.skill && current.skill.file === item.file ? 'on' : '',
                  onClick: () => onOpen(item),
                  title: item.file,
                },
                item.name,
                item.score === null ? null : h('span', { className: 'annot-muted', style: { marginLeft: 6 } }, String(item.score)),
                item.description
                  ? h('span', { className: 'annot-muted', style: { display: 'block', fontSize: 11, lineHeight: 1.35 } }, String(item.description).slice(0, 60))
                  : null,
                (item.hits || []).map((hit, index) =>
                  h(
                    'span',
                    { key: index, className: 'annot-muted', style: { display: 'block', fontSize: 11, lineHeight: 1.35 } },
                    `${hit.field}${hit.line === undefined ? '' : ':' + hit.line} ${String(hit.text).slice(0, 52)}`,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    function AnnotPage() {
      const state = useAnnot();
      const svgRef = React.useRef(null);
      const current = state.current;
      const doc = current && current.doc ? current.doc : null;

      if (state.status.loading) {
        return h(
          'div',
          { className: 'annot-root' },
          h(StyleOnce),
          h('div', { className: 'annot-busy', style: { padding: 16 } }, h('i', { className: 'annot-spin' }), '读取 skill 列表…'),
        );
      }

      if (!state.status.installed) {
        return h(
          'div',
          { className: 'annot-root' },
          h(StyleOnce),
          h(
            'div',
            { style: { padding: 16 } },
            h('h1', { style: { fontSize: 14, margin: '0 0 8px' } }, 'annot 还没装好'),
            h('p', { className: 'annot-muted' }, '面板需要一个能运行的 annot 命令行。装好后重新打开本页即可，或在插件 config 里把 cli 指到一个可执行路径：'),
            h('pre', { className: 'annot-raw' }, 'annot --help\n# config:\n#   cli: "/abs/path/to/annot"\n#   cliNodeArgs: ["/abs/path/to/src/cli.ts"]'),
            state.status.statusError ? h('p', { className: 'annot-error' }, state.status.statusError) : null,
            state.error ? h('p', { className: 'annot-error' }, state.error) : null,
          ),
        );
      }

      const generated = doc && doc.source && doc.source.generated_at ? new Date(doc.source.generated_at) : null;
      const generatedLabel =
        generated && !Number.isNaN(generated.getTime())
          ? `${String(generated.getHours()).padStart(2, '0')}:${String(generated.getMinutes()).padStart(2, '0')}`
          : null;

      return h(
        'div',
        { className: 'annot-root' },
        h(StyleOnce),
        h(
          'div',
          { className: 'annot-bar' },
          h('h1', null, doc ? doc.skill : 'annot'),
          doc ? h('span', { className: 'annot-pill' }, h('b', null, doc.nodes.length), ' 节点') : null,
          doc ? h('span', { className: 'annot-pill' }, h('b', null, doc.edges.length), ' 边') : null,
          doc
            ? h(
                'span',
                { className: `annot-pill${doc.stats.lowConfidence ? ' warn' : ''}` },
                h('b', null, doc.stats.lowConfidence),
                ' 待确认',
              )
            : null,
          // Freshness has to be on screen: the graph is a projection of a file
          // the user may be editing in another window, and a hash prefix is the
          // only way to say "this is what I read" without a refresh cycle.
          doc && doc.source
            ? h('span', { className: 'annot-pill', title: `源文件 sha256 ${doc.source.sha}\n生成于 ${doc.source.generated_at}` }, 'sha ', doc.source.sha.slice(0, 10))
            : null,
          generatedLabel ? h('span', { className: 'annot-pill', title: doc.source.generated_at }, '读于 ', generatedLabel) : null,
          h('span', { style: { flex: 1 } }),
          h(
            'button',
            {
              className: 'annot-pill',
              style: { cursor: 'pointer' },
              title: '重新扫描 skill 列表并重读当前这一个',
              onClick: () => state.refresh(),
            },
            '刷新',
          ),
          h(
            'button',
            {
              className: `annot-pill${state.auditting ? ' warn' : ''}`,
              style: { cursor: state.auditting ? 'progress' : 'pointer' },
              disabled: state.auditting,
              onClick: () => state.loadAudit(),
            },
            state.auditting ? '审计中…' : '运行整库审计',
          ),
        ),
        h(
          'div',
          { className: 'annot-tabs' },
          h('button', { className: state.tab === 'graph' ? 'on' : '', 'aria-pressed': state.tab === 'graph' ? 'true' : 'false', onClick: () => state.setTab('graph') }, '流程图'),
          h('button', { className: state.tab === 'audit' ? 'on' : '', 'aria-pressed': state.tab === 'audit' ? 'true' : 'false', onClick: () => state.setTab('audit') }, '审计'),
        ),
        state.error ? h('p', { className: 'annot-error', style: { padding: '8px 14px', margin: 0 } }, state.error) : null,
        state.tab === 'audit'
          ? h(
              'div',
              { className: 'annot-canvas' },
              h(AuditTable, {
                audit: state.audit,
                auditting: state.auditting,
                onOpen: (skill) => state.openSkill(skill),
              }),
            )
          : h(
              'div',
              { className: 'annot-body' },
              h(
                'div',
                { className: 'annot-canvas' },
                doc && current.layout
                  ? h(Graph, {
                      layout: current.layout,
                      doc,
                      selected: state.selected,
                      onSelect: state.setSelected,
                      svgRef,
                    })
                  : current && current.loading
                    ? h('div', { className: 'annot-busy' }, h('i', { className: 'annot-spin' }), '计算图谱…')
                    : h('p', { className: 'annot-muted' }, '右边的列表里搜一个 skill，点它出图。'),
              ),
              h(
                'div',
                { className: 'annot-side' },
                h(SearchPanel, {
                  skills: state.skills,
                  scan: state.scan,
                  query: state.query,
                  search: state.search,
                  searching: state.searching,
                  onSearch: state.runSearch,
                  onOpen: state.openSkill,
                  current,
                }),
                h(Detail, { doc, nodeId: state.selected }),
              ),
            ),
      );
    }

    /**
     * The shell passes the row's own props (`size`, `active`); ignoring them
     * makes the icon the wrong size in the collapsed rail. `data-dsh-panel-entry`
     * is what the other panels set so skins can identify a row.
     */
    function PanelRowIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 16;
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          'aria-hidden': true,
          'data-dsh-panel-entry': PANEL_ID,
          style: { display: 'block' },
        },
        h('rect', { x: 1, y: 2, width: 6, height: 4, rx: 1, fill: 'currentColor', opacity: 0.9 }),
        h('rect', { x: 9, y: 2, width: 6, height: 4, rx: 1, fill: 'currentColor', opacity: 0.55 }),
        h('rect', { x: 1, y: 9, width: 14, height: 4, rx: 1, fill: 'currentColor', opacity: 0.75 }),
      );
    }

    const PANEL_ID = 'annot';

    /**
     * Tell the Host this bundle ran.
     *
     * Only the page can answer "did the browser half arrive", and only a person
     * who can see the page can answer "is the row there". Without this beacon
     * both questions are answered by guessing at slot names in a comment.
     *
     * Fire-and-forget on purpose: a failed beacon must never break the panel.
     */
    function report(observation) {
      try {
        fetch(API.report, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...observation, at: new Date().toISOString() }),
        }).catch(() => undefined);
      } catch {
        // A page with no fetch is a page that will not show the panel either.
      }
    }

    function apply(ctx) {
      report({ event: 'apply-enter', hasSlots: Boolean(ctx && ctx.slots) });
      // Registration failing must leave a trace. Without this the panel simply
      // never appears, which is indistinguishable from "the bundle is not
      // installed" and is the single most expensive state to debug.
      const disposers = [];
      try {
        const slots = ctx.slots;
        if (!slots) throw new Error('the client context has no `slots` service');
        ctx.effect(
          () => () => {
            for (const dispose of disposers.splice(0)) dispose();
          },
          'annot: ui',
        );
        // `inject`'s callback fires only once the seat exists. Reporting the
        // moment it fires is what tells "no such seat" apart from "seat exists,
        // row not visible where the user looked".
        disposers.push(
          slots.inject('sidebar.panellist', () => {
            report({ event: 'seat-available', seat: 'sidebar.panellist' });
            return slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                // 60 rather than 40: 40 is taken by another installed bundle, and
                // two panels with the same order sort unpredictably.
                order: 60,
                label: () => 'Annot',
              },
              PanelRowIcon,
            );
          }),
        );
        disposers.push(
          slots.inject('main', () => {
            report({ event: 'seat-available', seat: 'main' });
            return slots.register(
              {
                name: 'main',
                key: PANEL_ID,
              },
              AnnotPage,
            );
          }),
        );
        report({ event: 'registered' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report({ event: 'register-failed', message });
        console.warn('[annot] panel registration failed; the Annot row will not appear', error);
      }
    }

    return { inject: ['slots'], apply };
  },
});
