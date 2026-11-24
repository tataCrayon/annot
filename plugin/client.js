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
      context: 'api/annot/context',
      audit: 'api/annot/audit',
      workbench: 'api/annot/workbench/open',
    };

    const NODE_COLORS = {
      stage: { fill: '#eef2ff', stroke: '#6366f1', text: '#1e1b4b' },
      decision: { fill: '#fff7ed', stroke: '#f97316', text: '#431407' },
      gate: { fill: '#fef2f2', stroke: '#dc2626', text: '#450a0a' },
      artifact: { fill: '#ecfdf5', stroke: '#059669', text: '#022c22' },
      external: { fill: '#f0f9ff', stroke: '#0284c7', text: '#082f49' },
      note: { fill: '#f7f7f8', stroke: '#77727f', text: '#2d2a32' },
    };
    /** Type to its CSS custom property; every colour lives in the token block. */
    const TYPE_VAR = {
      stage: '--annot-stage',
      decision: '--annot-decision',
      gate: '--annot-gate',
      artifact: '--annot-artifact',
      external: '--annot-external',
      note: '--annot-note',
    };
    const TYPE_LABEL = { stage: '关键动作', decision: '判断', gate: '门禁', artifact: '产物', external: '外部调用', note: '说明' };
    const NOTE_ROLE_LABEL = { principle: '原则', rationale: '理由', definition: '定义', trigger: '触发', context: '背景', risk: '风险', example: '示例', reference: '参考' };
    const ASSOCIATION_LABEL = { supports: '支持动作', constrains: '约束门禁', informs: '辅助判断', 'explains-output': '解释产物' };
    const SCOPE_LABEL = { node: '已关联', skill: '全局说明', unbound: '孤立说明' };
    /* Orthogonal to the type: who performs the step. */
    const LANE_LABEL = { reader: '你', tool: '工具', model: '模型', output: '产物' };
    /** Node flags are machine names; a reviewer reads the consequence. */
    const FLAG_LABEL = {
      'low-confidence': '置信度偏低',
      'unresolved-branch': '分支未落地',
      'empty-label': '标签为空',
      'empty-body': '正文为空',
      stale: '源文件已改，锚点可疑',
      broken: '锚点找不到原文',
    };

    async function request(url, options = {}) {
      const response = await fetch(url, { ...options, headers: { accept: 'application/json', ...(options.headers || {}) } });
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
      .annot-root {
        /* Node type inks are fixed so the graph reads the same in light and
           dark; the plate, ink and accent follow the host theme. */
        --annot-stage: #3b36a8; --annot-decision: #9a5b06; --annot-gate: #a8201a;
        --annot-artifact: #14603f; --annot-external: #12557a; --annot-note: #655f70;
        display:flex; flex-direction:column; height:100%; min-height:0; font-size:13px; line-height:1.5; color: var(--dsw-alias-label-primary);
      }
      .annot-bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:10px 14px; border-bottom:1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
      .annot-bar h1 { font-size:14px; margin:0; font-weight:650; }
      .annot-pill { font-size:11.5px; padding:1px 8px; border-radius:999px; border:1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); white-space:nowrap; }
      .annot-pill:disabled { cursor: wait; opacity: .65; }
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
      .annot-node:focus-visible rect.annot-card { stroke-width:3; }
      .annot-node rect.annot-card { transition: stroke-width .12s ease; }
      .annot-node:hover rect.annot-card { stroke-width:1.5; }
      .annot-node:active rect.annot-card { stroke-width:2.5; }
      .annot-node.sel rect.annot-card { stroke-width:2; }
      .annot-assoc { fill:none; stroke:var(--dsw-alias-label-tertiary); stroke-width:1.1; stroke-dasharray:2 4; opacity:.72; }
      .annot-assoc-title { fill:var(--dsw-alias-label-tertiary); font-size:9.5px; }
      .annot-node text { pointer-events:none; }
      .annot-mono { font-family: ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
      .annot-stepnum { fill: var(--dsw-alias-label-tertiary); font-family: ui-monospace, Consolas, monospace; font-size:11px; font-variant-numeric: tabular-nums; }
      .annot-steprule { stroke: var(--dsw-alias-border-l1); stroke-width:1; }
      .annot-phase { fill: var(--dsw-alias-bg-elevated); stroke: var(--dsw-alias-border-secondary); stroke-width:1; }
      .annot-phase-weak { fill: none; stroke-dasharray: 3 4; }
      .annot-phase-label { fill: var(--dsw-alias-label-secondary); font-size:11px; letter-spacing:.02em; }
      .annot-phase-weak + .annot-phase-label { fill: var(--dsw-alias-label-tertiary); }
      .annot-column-label { fill: var(--dsw-alias-label-primary); font-size:11.5px; font-weight:500; letter-spacing:.02em; }
      .annot-column-note { fill: var(--dsw-alias-label-tertiary); font-size:10.5px; }
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

        // Action numbers in the left gutter. Notes and supporting facts still
        // get bands for readability, but numbering them as workflow steps made
        // background prose look executable.
        const actionBands = new Map();
        for (const node of layout.nodes) {
          if (node.type === 'stage' && !actionBands.has(node.band)) {
            actionBands.set(node.band, actionBands.size + 1);
          }
        }
        for (const band of layout.bands || []) {
          svg.appendChild(el('line', { class: 'annot-steprule', x1: 26, y1: band.y - 7, x2: layout.width - 26, y2: band.y - 7 }));
          const actionOrder = actionBands.get(band.index);
          if (actionOrder === undefined) continue;
          const num = el('text', { class: 'annot-stepnum', x: 26, y: band.y + 4 });
          num.textContent = String(actionOrder).padStart(2, '0');
          svg.appendChild(num);
        }

        for (const id of ['arrow-seq', 'arrow-branch', 'arrow-assoc']) {
          const marker = el('marker', { id, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
          marker.appendChild(el('path', { d: 'M 0 0 L 8 4 L 0 8 z', fill: id === 'arrow-branch' ? 'var(--dsw-alias-state-warn-primary)' : id === 'arrow-assoc' ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)' }));
          svg.appendChild(marker);
        }

        // The chapter bands the author declared, drawn behind the edges and the
        // cards. The artifact draws these; without them the panel is one long
        // undifferentiated ladder and the two pictures stop being one picture.
        for (const run of layout.phaseRuns || []) {
          svg.appendChild(el('rect', {
            class: run.strong ? 'annot-phase' : 'annot-phase annot-phase-weak',
            x: 20,
            y: run.y,
            width: layout.width - 40,
            height: run.h,
            fill: run.strong ? 'var(--dsw-alias-bg-elevated)' : 'none',
            stroke: 'var(--dsw-alias-border-secondary)',
            'stroke-width': 1,
          }));
          const label = el('text', { class: 'annot-phase-label', x: 30, y: run.y + 15 });
          label.textContent = `${run.label} · ${run.nodes}`;
          svg.appendChild(label);
        }

        // The column headers and rails: the panel says which lane is the main
        // path and which two are its gates and artifacts, or the three columns
        // read as three unrelated lists.
        for (const column of layout.columns || []) {
          svg.appendChild(el('line', {
            class: 'annot-rail',
            x1: column.x + column.w + 13,
            y1: 34,
            x2: column.x + column.w + 13,
            y2: layout.height - 26,
            stroke: 'var(--dsw-alias-border-secondary)',
            'stroke-width': 1,
            'stroke-dasharray': '2 5',
          }));
        }
        if ((layout.columnHeaders || []).length) {
          svg.appendChild(el('line', {
            x1: 26, y1: 30, x2: layout.width - 26, y2: 30,
            stroke: 'var(--dsw-alias-label-primary)', 'stroke-width': 1,
          }));
          for (const head of layout.columnHeaders) {
            const title = el('text', { class: 'annot-column-label', x: head.x, y: 20 });
            title.textContent = `${head.label}  ${head.count}`;
            svg.appendChild(title);
            const note = el('text', { class: 'annot-column-note', x: head.x, y: 36 });
            note.textContent = head.used ? head.note : '本文件没有这一类';
            svg.appendChild(note);
          }
        }

        for (const edge of layout.edges) {
          const isBranch = edge.kind === 'branch';
          const attrs = {
            d: edge.d,
            fill: 'none',
            stroke: isBranch ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-primary)',
            'stroke-width': 1.2,
            'marker-end': `url(#${isBranch ? 'arrow-branch' : 'arrow-seq'})`,
          };
          // `setAttribute(key, 'null')` is not the same as omitting the attribute:
          // it sets a literal string the parser then drops. Only add when real.
          if (isBranch) attrs['stroke-dasharray'] = '4 3';
          svg.appendChild(el('path', attrs));
        }

        // A note hangs off the card it explains: one hairline from the owner's
        // left edge to the note's left edge. Without it the step-in reads as an
        // indentation for no reason; with it the note is visibly attached to
        // exactly one card. The note still names its relation in its header, so
        // the relation itself is never left to the line.
        const placed = new Map();
        for (const node of layout.nodes) placed.set(node.id, node);
        for (const node of layout.nodes) {
          if (!node.explains) continue;
          const owner = placed.get(node.explains);
          if (!owner) continue;
          const fromY = owner.y + owner.h;
          const toY = node.y - 1;
          if (toY <= fromY) continue;
          const x = node.x + 7;
          svg.appendChild(el('path', {
            class: 'annot-note-connector',
            d: `M ${x} ${fromY} L ${x} ${toY - 5} L ${node.x + (node.inset || 0) - 1} ${toY - 5}`,
            fill: 'none',
            stroke: 'var(--dsw-alias-label-tertiary)',
            'stroke-width': 1,
            'stroke-dasharray': '2 3',
            opacity: 0.55,
          }));
        }

        for (const association of layout.associations || []) {
          const source = placed.get(association.from);
          // An attached note is already drawn under its owner; a page-wide
          // dashed line would say the same thing twice and cut through cards.
          if (source && source.home === 'attached') continue;
          svg.appendChild(el('path', {
            class: 'annot-assoc',
            d: association.d,
            'marker-end': 'url(#arrow-assoc)',
          }));
        }

        for (const node of layout.nodes) {
          // A note's box is its owner's column; only the plate steps in, so
          // every card in a column still starts at one x.
          const inset = node.inset || 0;
          const plateW = node.w - inset;
          const group = el('g', {
            class: `annot-node${selected === node.id ? ' sel' : ''}${node.home === 'attached' ? ' note-attached' : ''}`,
            'data-id': node.id,
            transform: `translate(${node.x + inset} ${node.y})`,
            // The graph is the primary reading surface; keyboard access is not
            // optional decoration. tabindex + role + Enter/Space mirror a button.
            tabindex: '0',
            role: 'button',
            'aria-label': `${node.label}，${TYPE_LABEL[node.type] || node.type}，第 ${node.anchor.start} 到 ${node.anchor.end} 行`,
          });

          // `h` reserves the fork row below the plate, so the visible card is
          // `cardH`. The fallback keeps an older layout payload (no fork row)
          // drawing the same rectangle it always did instead of a gap.
          const cardH = typeof node.cardH === 'number' ? node.cardH : node.h;
          const rows = Array.isArray(node.rows) ? node.rows : [];
          const arms = Array.isArray(node.arms) ? node.arms : [];
          const subLines = Array.isArray(node.subLines) ? node.subLines : [];

          // The plate: host-background card, ink hairline, and a 3px top rule
          // carrying the type. Six pastel fills made every node look equally
          // urgent, which is the opposite of what a flow is for.
          const clipId = `annot-card-clip-${node.id}`;
          const clip = el('clipPath', { id: clipId });
          clip.appendChild(el('rect', { x: 0, y: 0, width: plateW, height: cardH, rx: 14, ry: 14 }));
          group.appendChild(clip);
          group.appendChild(el('rect', { class: 'annot-card', x: 0, y: 0, width: plateW, height: cardH, rx: 14, ry: 14, fill: 'var(--dsw-alias-bg-base)', stroke: 'var(--dsw-alias-label-primary)', 'stroke-width': 1 }));
          group.appendChild(el('rect', { x: 0, y: 0, width: plateW, height: 3, 'clip-path': `url(#${clipId})`, fill: `var(${TYPE_VAR[node.type] || '--annot-stage'})` }));

          // A note's header names its relation to the card it hangs under, so
          // "说明 · 约束门禁" answers "why is this rule here" without a legend.
          const typeWord = el('text', { x: 12, y: 17, 'font-size': 10.5, fill: `var(${TYPE_VAR[node.type] || '--annot-stage'})` });
          typeWord.textContent = node.type === 'note'
            ? node.home === 'attached'
              ? `说明 · ${ASSOCIATION_LABEL[node.relation] || '依附'}`
              : node.home === 'global' ? '说明 · 全局' : node.home === 'loose' ? '说明 · 孤立' : (NOTE_ROLE_LABEL[node.noteRole] ? `说明 · ${NOTE_ROLE_LABEL[node.noteRole]}` : '说明')
            : TYPE_LABEL[node.type] || node.type;
          group.appendChild(typeWord);

          // The layout already wrapped the label, so the panel cannot disagree
          // with the card height the layout promised.
          const lines = Array.isArray(node.lines) && node.lines.length ? node.lines : [node.label];
          lines.forEach((line, index) => {
            const text = el('text', { x: 12, y: 34 + index * 19, 'font-size': 13, fill: 'var(--dsw-alias-label-primary)' });
            text.textContent = line;
            group.appendChild(text);
          });

          // The second line the author already separated: the expectation, the
          // artifact, the target. Smaller and darker than a label line so the
          // two ranks read as title-then-detail rather than two sentences.
          const subTop = 34 + lines.length * 19 + 1;
          subLines.forEach((line, index) => {
            const text = el('text', { x: 12, y: subTop + index * 17, 'font-size': 11.5, fill: 'var(--dsw-alias-label-secondary)' });
            text.textContent = line;
            group.appendChild(text);
          });

          // A table's rows, so "八项必填" is the rule and not a title. The
          // artifact draws these; the panel must draw the same card or the two
          // pictures stop being one picture.
          rows.forEach((row, index) => {
            const text = el('text', { x: 12, y: subTop + subLines.length * 17 - 1 + index * 15, 'font-size': 11, fill: 'var(--dsw-alias-label-secondary)' });
            text.textContent = row;
            group.appendChild(text);
          });

          // Who performs the step. The type rule above says what kind of thing
          // this is; the lane says whether the reader, a command or the model
          // does it. Both are on the card because the two questions differ.
          if (node.lane) {
            const laneWord = el('text', { x: node.w - 12, y: 17, 'font-size': 10.5, 'text-anchor': 'end', fill: 'var(--dsw-alias-label-tertiary)' });
            laneWord.textContent = LANE_LABEL[node.lane] || node.lane;
            group.appendChild(laneWord);
          }

          // Two different "look at this" signals, both documented:
          //   count  = branches this node declares whose other end is unknown
          //   dot    = the extractor itself is under 60% sure of this node
          // The count sits in the footer, opposite the line range: the top-right
          // corner belongs to the lane word.
          const branches = Array.isArray(node.branches) ? node.branches : [];
          const open = branches.filter((branch) => !branch.to).length;
          const outgoing = (layout.associations || []).filter((association) => association.from === node.id);
          const noteStatus = node.type === 'note'
            ? node.associationScope === 'unbound' ? '孤立说明' : node.associationScope === 'skill' ? '全局说明' : outgoing.length ? ASSOCIATION_LABEL[outgoing[0].relation] : ''
            : '';
          const lowConfidence = (node.flags || []).indexOf('low-confidence') !== -1;
          const rightStatus = [noteStatus, open > 0 ? `${open} 未落地` : '', lowConfidence ? '低置信' : ''].filter(Boolean).join(' · ');
          const meta = el('text', { class: 'annot-mono', x: 12, y: cardH - 10, 'font-size': 10.5, fill: 'var(--dsw-alias-label-tertiary)' });
          const metaText = `L${node.anchor.start}-${node.anchor.end} · ${Math.round(node.confidence * 100)}%`;
          meta.textContent = metaText.length > 11 ? `${metaText.slice(0, 10)}…` : metaText;
          group.appendChild(meta);
          if (rightStatus) {
            const badge = el('text', { class: 'annot-mono', x: node.w - 12, y: cardH - 10, 'font-size': 10.5, 'text-anchor': 'end', fill: node.associationScope === 'unbound' ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-tertiary)' });
            badge.textContent = rightStatus.length > 8 ? `${rightStatus.slice(0, 7)}…` : rightStatus;
            group.appendChild(badge);
          }
          if (lowConfidence && !rightStatus) {
            group.appendChild(el('circle', { cx: node.w - 13, cy: cardH - 14, r: 3.2, fill: 'var(--dsw-alias-state-warn-primary)', 'data-role': 'low-confidence' }));
          }

          // An unresolved fork, drawn as arms under the plate: the source says
          // "hold / amend / replace" and none of the three lands anywhere, so
          // the picture has to show three outcomes rather than a straight line.
          if (arms.length) {
            let armX = 6;
            arms.forEach((arm) => {
              group.appendChild(el('rect', { class: 'annot-arm', x: armX, y: cardH + 6, width: arm.w, height: 18, fill: 'var(--dsw-alias-bg-elevated)', stroke: 'var(--dsw-alias-state-warn-primary)', 'stroke-width': 1 }));
              const label = el('text', { x: armX + arm.w / 2, y: cardH + 19, 'font-size': 11, 'text-anchor': 'middle', fill: 'var(--dsw-alias-state-warn-primary)' });
              label.textContent = arm.label;
              group.appendChild(label);
              armX += arm.w + 8;
            });
            const note = el('text', { class: 'annot-mono', x: node.w - 12, y: cardH + 19, 'font-size': 10.5, 'text-anchor': 'end', fill: 'var(--dsw-alias-state-warn-primary)' });
            note.textContent = `未落地 ${arms.length}`;
            group.appendChild(note);
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

      return h('div', null, h(Legend), h('svg', { ref: svgRef, role: 'img', 'aria-label': doc ? `${doc.skill} 的动作图` : '动作图' }));
    }

    /** The artifact has a legend; the panel promises the same reading without one. */
    function Legend() {
      return h(
        'div',
        { className: 'annot-legend' },
        Object.entries(TYPE_LABEL).map(([type, label]) =>
          h('span', { key: type }, h('i', { style: { background: (NODE_COLORS[type] || NODE_COLORS.stage).stroke } }), label),
        ),
        h('span', { key: 'association' }, h('i', { style: { width: 14, height: 0, borderTop: '1px dashed #94a3b8', borderRadius: 0, background: 'transparent' } }), '说明关联'),
        h('span', null, h('i', { style: { background: '#f59e0b', borderRadius: '50%' } }), '置信度低'),
      );
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
      /** The edit context for the selected node, fetched on demand. */
      const [edit, setEdit] = React.useState(null);
      const [editPending, setEditPending] = React.useState(false);
      const [workbenchOpening, setWorkbenchOpening] = React.useState(false);
      const [workbenchMessage, setWorkbenchMessage] = React.useState('');

      // Every request that can be superseded carries a ticket. A response whose
      // ticket is no longer the latest is dropped, which is the only way a slow
      // first answer cannot overwrite a fast second one — the classic
      // "I cleared the box and the old results came back" bug.
      const tickets = React.useRef({ list: 0, search: 0, flow: 0, audit: 0, edit: 0 });
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

      /**
       * Ask the CLI for the exact lines behind the selected node.
       *
       * This is the whole "edit by natural language" handoff: the panel does not
       * hold a model and must not pretend to. It hands the user a bounded slice
       * plus the constraints, so their own agent can rewrite exactly those lines
       * and `annot check` can prove nothing else moved.
       */
      const loadEdit = React.useCallback(async () => {
        if (!current || !current.skill || !selected) return;
        const ticket = stamp('edit');
        setEditPending(true);
        setEdit(null);
        try {
          const payload = await request(`${API.context}?path=${encodeURIComponent(current.skill.file)}&node=${encodeURIComponent(selected)}`);
          if (stale('edit', ticket)) return;
          setEdit(payload);
        } catch (failure) {
          if (stale('edit', ticket)) return;
          setEdit({ error: failure.message });
        } finally {
          if (!stale('edit', ticket)) setEditPending(false);
        }
      }, [current, selected]);

      const openWorkbench = React.useCallback(async () => {
        setWorkbenchOpening(true);
        setWorkbenchMessage('');
        try {
          const payload = await request(API.workbench, { method: 'POST' });
          setWorkbenchMessage(payload.opened ? '已在浏览器打开工作台。' : `工作台地址：${payload.url}`);
        } catch (failure) {
          setWorkbenchMessage(failure.message);
        } finally {
          setWorkbenchOpening(false);
        }
      }, []);

      React.useEffect(() => {
        // Changing node invalidates the slice; leaving the previous node's lines
        // on screen while a new request is in flight is how a user copies the
        // wrong text into their editor.
        setEdit(null);
      }, [selected]);

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
        edit,
        editPending,
        loadEdit,
        workbenchOpening,
        workbenchMessage,
        openWorkbench,
      };
    }

    function Detail({ doc, nodeId }) {
      if (!doc) return h('p', { className: 'annot-muted' }, '从右边的列表里搜一个 skill，点它出图。');
      if (!nodeId) return h('p', { className: 'annot-muted' }, '点一个方块查看它的原文与锚点。');
      const node = doc.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return h('p', { className: 'annot-muted' }, '卡片已不在当前动作图里。');
      const branches = Array.isArray(node.branches) ? node.branches : [];
      const stageNodes = Array.isArray(doc.nodes) ? doc.nodes.filter((candidate) => candidate.type === 'stage') : [];
      const rank = stageNodes.findIndex((candidate) => candidate.id === node.id);
      const related = (doc.associations || []).filter((association) => association.from === node.id);
      const associationDetail = related.length
        ? h('ul', { className: 'annot-list' }, related.map((association, index) => {
            const target = doc.nodes.find((candidate) => candidate.id === association.to);
            const confidence = Math.round((association.confidence || 0) * 100);
            return h('li', { key: index, style: { padding: '2px 0' } }, `${ASSOCIATION_LABEL[association.relation] || association.relation} → ${target ? target.label : association.to} · L${target ? target.anchor.start : '?'} · ${association.evidence} · ${confidence}%`);
          }))
        : node.associationScope === 'skill'
          ? h('p', { className: 'annot-muted' }, '作用于整个 Skill')
          : h('p', { className: 'annot-muted' }, '孤立说明：没有可证实的目标');
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
        h('h2', null, rank >= 0 ? `关键动作 ${rank + 1}` : node.type === 'note' && NOTE_ROLE_LABEL[node.noteRole] ? `${TYPE_LABEL.note} · ${NOTE_ROLE_LABEL[node.noteRole]}` : TYPE_LABEL[node.type] || '卡片'),
        h(
          'dl',
          { className: 'annot-kv' },
          h('dt', null, '类型'),
          h('dd', null, node.type === 'note' && NOTE_ROLE_LABEL[node.noteRole] ? `${TYPE_LABEL.note} · ${NOTE_ROLE_LABEL[node.noteRole]}` : TYPE_LABEL[node.type] || node.type),
          node.type === 'note' ? h('dt', null, '作用范围') : null,
          node.type === 'note' ? h('dd', null, SCOPE_LABEL[node.associationScope] || '未分析') : null,
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
        node.type === 'note' ? h('h2', null, '关联目标') : null,
        node.type === 'note' ? associationDetail : null,
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

    /**
     * The natural-language edit handoff.
     *
     * The panel cannot rewrite a skill itself, and pretending to would need a
     * model, a key and a second opinion. What it can do is give the user's own
     * agent the exact bytes and the constraints — which is the part the agent
     * cannot derive — and make copying it one click.
     */
    function EditPanel({ edit, pending, onLoad }) {
      if (pending) return h('div', { className: 'annot-busy' }, h('i', { className: 'annot-spin' }), '取这一段的行号与约束…');
      if (!edit) {
        return h(
          'div',
          null,
          h('h2', null, '自然语言改'),
          h('p', { className: 'annot-muted' }, '给出这张卡片的精确行范围与改写约束，交给你的 agent 去改。'),
          h('button', { className: 'annot-pill', style: { cursor: 'pointer' }, onClick: onLoad }, '生成改写上下文'),
        );
      }
      if (edit.error) return h('p', { className: 'annot-error' }, edit.error);

      const lines = [
        `# 目标：${edit.skill} / ${edit.target.id}`,
        `# 锚点：${edit.target.start}–${edit.target.end}（${edit.target.type}）`,
        '',
        edit.original,
        '',
        '# 约束',
        ...edit.rules.map((rule) => `- ${rule}`),
      ].join('\n');

      return h(
        'div',
        null,
        h('h2', null, '自然语言改'),
        h(
          'p',
          { className: 'annot-muted' },
          `只改第 ${edit.target.start}–${edit.target.end} 行。复制下面这段给你的 agent，改完运行 annot check 验证锚点。`,
        ),
        h('pre', { className: 'annot-raw', style: { maxHeight: 240, overflow: 'auto' } }, lines),
        h(
          'button',
          {
            className: 'annot-pill',
            style: { cursor: 'pointer' },
            onClick: () => {
              // Clipboard availability is not something to bet the panel on: a
              // failure falls back to the visible <pre>, which is selectable.
              try {
                navigator.clipboard.writeText(lines).catch(() => undefined);
              } catch {
                undefined;
              }
            },
          },
          '复制',
        ),
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
                ['分数', '卡片', '低置信', '未绑定', '空标签', '孤立%', 'skill'].map((label) => h('th', { key: label }, label)),
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

      // Report once per mount. `reports` gaining a `panel-mounted` row is the
      // difference between "registered into a seat" and "a human actually
      // reached the page", and the Host cannot see the latter any other way.
      React.useEffect(() => {
        mountCount += 1;
        report({ event: 'panel-mounted', count: mountCount });
      }, []);

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
          doc ? h('span', { className: 'annot-pill' }, h('b', null, doc.stats.byType.stage), ' 关键动作') : null,
          doc ? h('span', { className: 'annot-pill' }, h('b', null, doc.stats.byType.note ?? 0), ' 说明') : null,
          doc ? h('span', { className: 'annot-pill' }, h('b', null, doc.edges.length), ' 连接') : null,
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
          state.workbenchMessage
            ? h('span', { className: 'annot-pill', title: state.workbenchMessage, style: { maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' } }, state.workbenchMessage)
            : null,
          h('span', { style: { flex: 1 } }),
          h(
            'button',
            {
              className: 'annot-pill',
              style: { cursor: state.workbenchOpening ? 'progress' : 'pointer' },
              disabled: state.workbenchOpening,
              title: '启动或复用独立网页工作台，并在默认浏览器中打开',
              onClick: () => state.openWorkbench(),
            },
            state.workbenchOpening ? '打开中…' : '浏览器打开',
          ),
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
          h('button', { className: state.tab === 'graph' ? 'on' : '', 'aria-pressed': state.tab === 'graph' ? 'true' : 'false', onClick: () => state.setTab('graph') }, '动作图'),
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
                state.selected && doc
                  ? h(EditPanel, { edit: state.edit, pending: state.editPending, onLoad: state.loadEdit })
                  : null,
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

    /** Where the panel was mounted, so the page can tell the Host without a probe. */
    let mountCount = 0;

    const PANEL_ID = 'annot';

    /**
     * What the page's own DOM says about the panel list.
     *
     * Registration succeeding and a row being drawn are two different claims,
     * and only the second one is visible to a person. The sidebar draws its
     * panel list inside `<nav aria-label="全局面板">` and only when it has at
     * least one entry — so "no nav at all" means the shell never saw any
     * registrant, while "nav present, row absent" means it saw the list and
     * filtered ours out (the shell hides rows the user unpinned into a More
     * menu). Those have different causes and different fixes, and this is the
     * only way to tell them apart from the Host side.
     *
     * Every selector here is a read: nothing is clicked, focused or scrolled,
     * because this runs inside someone's live session.
     */
    function domFacts() {
      try {
        const navs = Array.from(document.querySelectorAll('nav'));
        const panelNav = navs.find((node) => /全局面板|Global panels|全パネル/.test(node.getAttribute('aria-label') || ''));
        return {
          navCount: navs.length,
          // The stock sidebar root marks its scroll viewport. If this is absent
          // while a sidebar is clearly on screen, another bundle replaced the
          // shell — and a replacement is free to not draw `sidebar.panellist`
          // at all, which no registration on our side can fix.
          stockShell: Boolean(document.querySelector('[data-sidebar-scrollport]')),
          panelNav: Boolean(panelNav),
          panelButtons: panelNav ? panelNav.querySelectorAll('button').length : 0,
          // Our icon only exists inside a drawn row, so this is the direct
          // answer to "is the row on screen".
          ourIcons: document.querySelectorAll('[data-dsh-panel-entry="' + PANEL_ID + '"]').length,
          text: String((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 240),
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }

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
        report({ event: 'registered', dom: domFacts() });
        // The DOM is not settled at `apply` time, so look once more after the
        // shell has had a chance to render the list. This is a single delayed
        // read, not a poll: a failed answer must not turn into a busy loop.
        // `typeof` rather than a bare call: a host that does not expose timers
        // must not make a successful registration look like a failure.
        if (typeof setTimeout === 'function') {
          setTimeout(() => report({ event: 'dom-after-mount', dom: domFacts() }), 1500);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report({ event: 'register-failed', message });
        console.warn('[annot] panel registration failed; the Annot row will not appear', error);
      }
    }

    return { inject: ['slots'], apply };
  },
});
