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
      list: 'api/annot/list',
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
    const STYLE = `
      .annot-root { display:flex; flex-direction:column; height:100%; min-height:0; font:13px/1.5 inherit; color: var(--dsw-alias-label-primary); }
      .annot-bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:10px 14px; border-bottom:1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
      .annot-bar h1 { font-size:14px; margin:0; font-weight:650; }
      .annot-pill { font-size:11.5px; padding:1px 8px; border-radius:999px; border:1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); white-space:nowrap; }
      .annot-pill b { color: var(--dsw-alias-label-primary); font-weight:650; }
      .annot-pill.warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
      .annot-body { display:grid; grid-template-columns: minmax(0,1fr) 320px; flex:1; min-height:0; }
      .annot-canvas { overflow:auto; padding:14px; }
      .annot-side { border-left:1px solid var(--dsw-alias-border-l1); overflow:auto; padding:12px 14px 32px; background: var(--dsw-alias-bg-base); }
      .annot-side h2 { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color: var(--dsw-alias-label-tertiary); margin:14px 0 6px; font-weight:650; }
      .annot-side h2:first-child { margin-top:0; }
      .annot-kv { display:grid; grid-template-columns:64px 1fr; gap:4px 10px; margin:0; font-size:12.5px; }
      .annot-kv dt { color: var(--dsw-alias-label-tertiary); }
      .annot-kv dd { margin:0; word-break:break-word; }
      .annot-raw { white-space:pre-wrap; background: color-mix(in oklab, var(--dsw-alias-bg-base), var(--dsw-alias-label-primary) 4%); border:1px solid var(--dsw-alias-border-l1); border-radius:8px; padding:8px; font:11.5px/1.55 ui-monospace,Consolas,monospace; max-height:240px; overflow:auto; margin:0; }
      .annot-list { list-style:none; margin:0; padding:0; }
      .annot-list li { margin:0; }
      .annot-list button { all:unset; display:block; width:100%; box-sizing:border-box; padding:5px 8px; border-radius:6px; cursor:pointer; font:12.5px/1.4 inherit; }
      .annot-list button:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .annot-list button.on { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
      .annot-muted { color: var(--dsw-alias-label-tertiary); font-size:12px; margin:6px 0; }
      .annot-error { color: var(--dsw-alias-state-error-primary); font-size:12.5px; white-space:pre-wrap; }
      .annot-tag { display:inline-block; font-size:11px; padding:0 7px; border-radius:999px; border:1px solid var(--dsw-alias-border-l1); margin:0 4px 4px 0; }
      .annot-tag.warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
      .annot-tag.bad { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
      .annot-tag.ok { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
      .annot-node { cursor:pointer; }
      .annot-node rect { transition: filter .12s ease, stroke-width .12s ease; }
      .annot-node:hover rect { filter: drop-shadow(0 2px 8px rgba(15,23,42,.18)); stroke-width:2.4; }
      .annot-node.sel rect { stroke-width:3; }
      .annot-node text { pointer-events:none; }
      .annot-tabs { display:flex; gap:6px; padding:0 14px; border-bottom:1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
      .annot-tabs button { all:unset; cursor:pointer; padding:7px 10px; font:12.5px inherit; color: var(--dsw-alias-label-secondary); border-bottom:2px solid transparent; }
      .annot-tabs button.on { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-button-primary-fill); }
      .annot-table { width:100%; border-collapse:collapse; font-size:12.5px; }
      .annot-table th, .annot-table td { text-align:left; padding:5px 8px; border-bottom:1px solid var(--dsw-alias-border-l1); }
      .annot-table th { color: var(--dsw-alias-label-tertiary); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
      .annot-table td.num { text-align:right; font-variant-numeric: tabular-nums; }
    `;

    function StyleOnce() {
      React.useEffect(() => {
        const id = 'annot-dsh-style';
        if (document.getElementById(id)) return undefined;
        const el = document.createElement('style');
        el.id = id;
        el.textContent = STYLE;
        document.head.appendChild(el);
        return () => el.remove();
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
          svg.appendChild(
            el('path', {
              d: edge.d,
              fill: 'none',
              stroke: edge.kind === 'branch' ? '#f97316' : '#cbd5e1',
              'stroke-width': edge.kind === 'branch' ? 1.6 : 1.7,
              'stroke-dasharray': edge.kind === 'branch' ? '5 4' : null,
              'marker-end': `url(#${edge.kind === 'branch' ? 'arrow-branch' : 'arrow-seq'})`,
            }),
          );
        }

        for (const node of layout.nodes) {
          const group = el('g', {
            class: `annot-node${selected === node.id ? ' sel' : ''}`,
            'data-id': node.id,
            transform: `translate(${node.x} ${node.y})`,
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

          const open = node.branches.filter((branch) => !branch.to).length;
          if (open > 0) {
            group.appendChild(el('circle', { cx: node.w - 14, cy: 13, r: 7, fill: '#fef3c7' }));
            const badge = el('text', { x: node.w - 14, y: 16.5, 'font-size': 9.5, fill: '#92400e', 'text-anchor': 'middle', 'font-weight': 700 });
            badge.textContent = String(open);
            group.appendChild(badge);
          }

          group.addEventListener('click', () => onSelect(node.id));
          svg.appendChild(group);
        }
      }, [layout, selected, onSelect, svgRef]);

      return h('svg', { ref: svgRef, role: 'img', 'aria-label': doc ? `${doc.skill} 的流程图` : '流程图' });
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
      const [audit, setAudit] = React.useState(null);
      const [current, setCurrent] = React.useState(null);
      const [selected, setSelected] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [tab, setTab] = React.useState('graph');

      const loadList = React.useCallback(async () => {
        setError(null);
        try {
          const payload = await request(API.list);
          setSkills(payload.skills || []);
          setStatus({ loading: false, installed: true });
        } catch (failure) {
          setStatus({ loading: false, installed: failure.status !== 503 });
          setError(failure.message);
        }
      }, []);

      const loadAudit = React.useCallback(async () => {
        setError(null);
        try {
          const payload = await request(API.audit);
          setAudit(payload);
        } catch (failure) {
          setError(failure.message);
        }
      }, []);

      const openSkill = React.useCallback(async (skill) => {
        setError(null);
        setCurrent({ loading: true, skill });
        try {
          const payload = await request(`${API.flow}?path=${encodeURIComponent(skill.file)}`);
          setCurrent({ ...payload, skill });
          setSelected(payload.layout && payload.layout.nodes.length ? payload.layout.nodes[0].id : null);
          setTab('graph');
        } catch (failure) {
          setCurrent({ skill, error: failure.message });
          setError(failure.message);
        }
      }, []);

      React.useEffect(() => {
        request(API.status)
          .then((payload) => setStatus({ loading: false, installed: Boolean(payload.installed) }))
          .catch(() => setStatus({ loading: false, installed: false }));
        loadList();
      }, [loadList]);

      return { status, skills, audit, current, selected, setSelected, error, tab, setTab, loadList, loadAudit, openSkill };
    }

    function Detail({ doc, nodeId }) {
      if (!doc || !nodeId) return h('p', { className: 'annot-muted' }, '点一个方块查看它的原文与锚点。');
      const node = doc.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return h('p', { className: 'annot-muted' }, '节点已不在当前图里。');
      const flags = node.flags.map((flag) =>
        h('span', { key: flag, className: `annot-tag ${flag === 'stale' || flag === 'broken' ? 'bad' : 'warn'}` }, flag),
      );
      return h(
        'div',
        null,
        h('h2', null, '节点'),
        h(
          'dl',
          { className: 'annot-kv' },
          h('dt', null, 'id'),
          h('dd', null, h('code', null, node.id)),
          h('dt', null, '类型'),
          h('dd', null, TYPE_LABEL[node.type] || node.type),
          h('dt', null, '置信度'),
          h('dd', null, `${Math.round(node.confidence * 100)}%（${node.source || 'extractor'}）`),
          h('dt', null, '锚点'),
          h('dd', null, h('code', null, `${doc.source.file}:${node.anchor.start}–${node.anchor.end}`)),
          h('dt', null, '行哈希'),
          h('dd', null, h('code', null, node.anchor.sha.slice(0, 12))),
          h('dt', null, '小节'),
          h('dd', null, (node.anchor.heading || []).join(' › ') || '(前言)'),
          flags.length ? h('dt', null, '标记') : null,
          flags.length ? h('dd', null, flags) : null,
        ),
        h('h2', null, '分支'),
        node.branches.length === 0
          ? h('p', { className: 'annot-muted' }, '无')
          : h(
              'ul',
              { className: 'annot-list' },
              node.branches.map((branch, index) =>
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

    function AuditTable({ audit }) {
      if (!audit) return h('p', { className: 'annot-muted' }, '尚未运行整库审计。');
      return h(
        'div',
        null,
        h(
          'p',
          { className: 'annot-muted' },
          `${audit.total} 个 skill，${audit.clean} 个零瑕疵。分数越高说明抽取器读得越差。`,
        ),
        h(
          'table',
          { className: 'annot-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              ['score', 'nodes', 'low', 'unres', 'skill'].map((label) => h('th', { key: label }, label)),
            ),
          ),
          h(
            'tbody',
            null,
            (audit.audits || []).map((row) =>
              h(
                'tr',
                { key: row.skill },
                h('td', { className: 'num' }, row.score.toFixed(1)),
                h('td', { className: 'num' }, String(row.nodes)),
                h('td', { className: 'num' }, String(row.lowConfidence)),
                h('td', { className: 'num' }, String(row.unresolvedBranches)),
                h('td', null, row.skill),
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

      if (state.status.loading) return h('div', { className: 'annot-root' }, h(StyleOnce), h('p', { className: 'annot-muted', style: { padding: 16 } }, '读取 skill 列表…'));

      if (!state.status.installed) {
        return h(
          'div',
          { className: 'annot-root' },
          h(StyleOnce),
          h(
            'div',
            { style: { padding: 16 } },
            h('h1', { style: { fontSize: 14, margin: '0 0 8px' } }, 'annot 还没装好'),
            h('p', { className: 'annot-muted' }, '面板需要一个能运行 `annot` 的命令行。装好后刷新本页即可，或在插件 config 里把 `cli` 指到一个可执行路径：'),
            h('pre', { className: 'annot-raw' }, 'annot --help\n# config:\n#   cli: "/abs/path/to/annot"\n#   cliNodeArgs: ["/abs/path/to/src/cli.ts"]'),
            state.error ? h('p', { className: 'annot-error' }, state.error) : null,
          ),
        );
      }

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
          h('span', { style: { flex: 1 } }),
          h(
            'button',
            { className: 'annot-pill', style: { cursor: 'pointer' }, onClick: () => state.loadAudit() },
            '运行整库审计',
          ),
        ),
        h(
          'div',
          { className: 'annot-tabs' },
          h('button', { className: state.tab === 'graph' ? 'on' : '', onClick: () => state.setTab('graph') }, '流程图'),
          h('button', { className: state.tab === 'audit' ? 'on' : '', onClick: () => state.setTab('audit') }, '审计'),
        ),
        state.error ? h('p', { className: 'annot-error', style: { padding: '8px 14px', margin: 0 } }, state.error) : null,
        state.tab === 'audit'
          ? h('div', { className: 'annot-canvas' }, h(AuditTable, { audit: state.audit }))
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
                  : h('p', { className: 'annot-muted' }, current && current.loading ? '计算图谱…' : '从左侧选一个 skill。'),
              ),
              h(
                'div',
                { className: 'annot-side' },
                h('h2', null, 'skill'),
                h(
                  'ul',
                  { className: 'annot-list' },
                  state.skills.map((skill) =>
                    h(
                      'li',
                      { key: skill.file },
                      h(
                        'button',
                        {
                          className: current && current.skill && current.skill.file === skill.file ? 'on' : '',
                          onClick: () => state.openSkill(skill),
                          title: skill.file,
                        },
                        skill.name,
                      ),
                    ),
                  ),
                ),
                h(Detail, { doc, nodeId: state.selected }),
              ),
            ),
      );
    }

    function PanelRowIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true },
        h('rect', { x: 1, y: 2, width: 6, height: 4, rx: 1, fill: 'currentColor', opacity: 0.9 }),
        h('rect', { x: 9, y: 2, width: 6, height: 4, rx: 1, fill: 'currentColor', opacity: 0.55 }),
        h('rect', { x: 1, y: 9, width: 14, height: 4, rx: 1, fill: 'currentColor', opacity: 0.75 }),
      );
    }

    const PANEL_ID = 'annot';

    function apply(ctx) {
      const disposers = [];
      const slots = ctx.slots;
      disposers.push(
        slots.inject('sidebar.panellist', () =>
          slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 40,
              label: () => 'Annot',
            },
            PanelRowIcon,
          ),
        ),
      );
      disposers.push(
        slots.inject('main', () =>
          slots.register(
            {
              name: 'main',
              key: PANEL_ID,
            },
            AnnotPage,
          ),
        ),
      );
      ctx.effect(
        () => () => {
          for (const dispose of disposers.splice(0)) dispose();
        },
        'annot: ui',
      );
    }

    return { inject: ['slots'], apply };
  },
});
