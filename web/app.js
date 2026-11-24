const $ = (id) => document.getElementById(id);
const state = { skills: [], totalSkills: 0, selected: null, doc: null, auditLoaded: false, standards: null, standardsLoaded: false, evaluationMetrics: [], searchTimer: 0, drawerReturnFocus: null, appView: 'library', libraryReport: null, reportFilter: 'fail', snapshots: [], snapshotDiff: null, systemSkills: [], selectedSource: 'user', skillRequestSeq: 0, selectedNodeId: null, dialogTask: null };
const NODE_TYPE_LABEL = { stage: '关键动作', decision: '判断', gate: '门禁', artifact: '产物', external: '外部调用', note: '说明' };
const NOTE_ROLE_LABEL = { principle: '原则', rationale: '理由', definition: '定义', trigger: '触发', context: '背景', risk: '风险', example: '示例', reference: '参考' };
const ASSOCIATION_LABEL = { supports: '支持动作', constrains: '约束门禁', informs: '辅助判断', 'explains-output': '解释产物' };
const SCOPE_LABEL = { node: '已关联', skill: '全局说明', unbound: '孤立说明' };
const TASK_TITLE = { rewrite: '自然语言修改任务', evaluate: 'AI 评估与优化任务', analyze: 'AI 语义分析任务', repair: 'Skill 规范修复任务' };
const ROOT_REASON_LABEL = { unreadable: '不可读', 'not a directory': '不是目录' };

function nodeTypeLabel(type, node = null) {
  const base = NODE_TYPE_LABEL[type] || '说明';
  if (type === 'note' && node?.noteRole && NOTE_ROLE_LABEL[node.noteRole]) return `${base} · ${NOTE_ROLE_LABEL[node.noteRole]}`;
  return base;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(result?.error || `请求失败（${response.status}）`);
    // The graph endpoint answers 409 when a Skill has no analysis yet, and the
    // page shows a different thing for that: not a failure, a missing step.
    error.status = response.status;
    error.body = result;
    throw error;
  }
  return result;
}

function setError(message) {
  $('global-error').textContent = message;
  $('global-error').hidden = !message;
}

function updateRoots(status) {
  state.evaluationMetrics = Array.isArray(status.evaluationMetrics) ? status.evaluationMetrics : [];
  state.totalSkills = Number(status.skills) || 0;
  const skippedByRoot = new Map(status.skipped.map((item) => [item.root, item.reason]));
  const activePaths = new Set(status.roots.map((root) => root.path));
  const availableRoots = Array.isArray(status.defaultRoots) ? status.defaultRoots : status.roots;
  const readableCount = status.roots.filter((root) => !skippedByRoot.has(root.path)).length;
  $('root-count').textContent = `${readableCount} / ${status.roots.length} 可读`;
  $('root-list').replaceChildren(...availableRoots.map((root) => {
    const item = document.createElement('li');
    item.className = 'root-item';
    const option = document.createElement('label');
    option.className = 'root-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'skill-root';
    checkbox.value = root.path;
    checkbox.checked = activePaths.has(root.path);
    const copy = document.createElement('span');
    copy.className = 'root-option-copy';
    const label = document.createElement('span');
    label.className = 'root-label';
    label.textContent = root.label;
    const path = document.createElement('span');
    path.className = 'root-path';
    path.textContent = root.path;
    const statusLabel = document.createElement('span');
    statusLabel.className = `root-availability${skippedByRoot.has(root.path) ? ' skipped' : ''}`;
    statusLabel.textContent = skippedByRoot.has(root.path) ? (ROOT_REASON_LABEL[skippedByRoot.get(root.path)] ?? '不可用') : '可读';
    copy.append(label, path);
    option.title = root.path;
    option.append(checkbox, copy, statusLabel);
    item.append(option);
    return item;
  }));
  const defaultPaths = new Set(availableRoots.map((root) => root.path));
  $('custom-roots').value = status.roots.filter((root) => !defaultPaths.has(root.path)).map((root) => root.path).join('\n');
  $('skill-count').textContent = `${state.totalSkills} 个`;
  if ($('skill-search').value.trim() === '') $('result-summary').textContent = '全部 Skill';
  const skipped = $('skipped-list');
  skipped.replaceChildren();
  for (const item of status.skipped) {
    const note = document.createElement('p');
    note.textContent = `${item.root}：${ROOT_REASON_LABEL[item.reason] ?? item.reason}`;
    skipped.append(note);
  }
  $('skipped-count').textContent = String(status.skipped.length);
  $('skipped-summary').hidden = status.skipped.length === 0;
}

function displaySkills(skills, emptyMessage, resultLabel = '全部 Skill') {
  state.skills = skills;
  $('result-summary').textContent = resultLabel;
  $('skill-count').textContent = resultLabel === '全部 Skill'
    ? `${state.totalSkills} 个`
    : `${skills.length} / ${state.totalSkills}`;
  const list = $('skill-list');
  list.replaceChildren(...skills.map(skillButton));
  $('skill-state').textContent = skills.length ? '' : emptyMessage;
  $('skill-state').hidden = skills.length > 0;
  list.hidden = skills.length === 0;
  for (const button of list.querySelectorAll('[data-skill]')) {
    button.setAttribute('aria-current', String(button.dataset.skill === state.selected && state.selectedSource === 'user'));
  }
}

function displaySystemSkills(skills) {
  state.systemSkills = skills;
  const ordered = [...skills].sort((a, b) => (a.role === 'primary' ? -1 : 0) - (b.role === 'primary' ? -1 : 0) || a.name.localeCompare(b.name));
  const items = ordered.map((skill) => {
    const item = skillButton(skill, 'system');
    const button = item.querySelector('button');
    if (button) {
      button.classList.add('system-skill-card');
      if (skill.role === 'primary') button.classList.add('primary');
      const badge = document.createElement('span');
      badge.className = 'system-skill-badge';
      badge.textContent = skill.role === 'primary' ? '核心' : '辅助';
      button.append(badge);
      button.setAttribute('aria-current', String(skill.name === state.selected && state.selectedSource === 'system'));
    }
    return item;
  });
  $('system-skill-count').textContent = `${skills.length} 个内置`;
  $('system-skill-list').replaceChildren(...items);
}
async function submitRoots(body) {
  const save = $('save-roots');
  const reset = $('reset-roots');
  const errorNote = $('root-form-error');
  errorNote.hidden = true;
  save.disabled = true;
  reset.disabled = true;
  try {
    await request('/api/roots', { method: 'PUT', body });
    state.auditLoaded = false;
    $('skill-search').value = '';
    $('search-body').checked = false;
    await loadLibrary();
  } catch (error) {
    errorNote.textContent = error.message;
    errorNote.hidden = false;
  } finally {
    save.disabled = false;
    reset.disabled = false;
  }
}

function skillButton(skill, source = 'user') {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.skill = skill.name;
  button.dataset.source = source;
  button.title = skill.file;
  button.setAttribute('aria-current', 'false');
  const mark = document.createElement('span');
  mark.className = 'skill-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = skill.name.slice(0, 1).toUpperCase();
  const copy = document.createElement('span');
  copy.className = 'skill-copy';
  const name = document.createElement('span');
  name.className = 'skill-name';
  name.textContent = skill.name;
  const summary = document.createElement('span');
  summary.className = 'skill-summary';
  summary.textContent = skill.description || skill.file;
  copy.append(name, summary);
  button.append(mark, copy);
  button.addEventListener('click', () => openSkill(skill.name, source));
  item.append(button);
  return item;
}

async function loadLibrary() {
  setError('');
  $('skill-state').hidden = false;
  $('skill-state').textContent = '正在扫描配置目录…';
  $('skill-list').hidden = true;
  try {
    const [status, result, system] = await Promise.all([
      request('/api/status'),
      request('/api/skills'),
      request('/api/system-skills'),
    ]);
    updateRoots(status);
    displaySystemSkills(system.skills ?? []);
    displaySkills(result.skills, result.skills.length ? '' : '当前目录没有可读取的 Skill。');
    if (state.appView === 'library') {
      const selectedPool = state.selectedSource === 'system' ? (system.skills ?? []) : result.skills;
      if (state.selected && selectedPool.some((skill) => skill.name === state.selected)) await openSkill(state.selected, state.selectedSource);
      else if (result.skills.length) await openSkill(result.skills[0].name, 'user');
      else if ((system.skills ?? []).length) await openSkill(system.skills[0].name, 'system');
      else showWelcome();
    }
  } catch (error) {
    displaySkills([], '扫描未完成。', '扫描结果');
    showWelcome();
    setError(error.message);
  }
}
function showWelcome() {
  $('welcome').hidden = false;
  $('skill-view').hidden = true;
}

async function openSkill(name, source = 'user') {
  const requestId = ++state.skillRequestSeq;
  const visible = state.appView === 'library';
  state.selected = name;
  state.selectedSource = source;
  state.doc = null;
  setError('');
  $('welcome').hidden = visible;
  $('skill-view').hidden = !visible;
  $('graph-view').hidden = false;
  $('standards-view').hidden = true;
  $('audit-view').hidden = true;
  state.standards = null;
  state.standardsLoaded = false;
  $('standards-badge').textContent = '待查';
  state.selectedNodeId = null;
  selectNode(null);
  $('node-detail').innerHTML = '<p class="empty-detail">正在载入动作图…</p>';
  $('drawer-summary').textContent = '正在载入';
  // The drawer opens when a card is picked, not when a Skill is opened: with no
  // card selected it would take a third of the canvas to say "pick a card".
  closeNodeDrawer({ restoreFocus: false });
  setActiveTab('graph');
  for (const button of document.querySelectorAll('#skill-list [data-skill], #system-skill-list [data-skill]')) {
    button.setAttribute('aria-current', String(button.dataset.skill === name && button.dataset.source === state.selectedSource));
  }
  $('skill-title').textContent = name;
  $('graph-loading').hidden = false;
  $('graph-loading').textContent = '正在从 Skill 原文生成动作图…';
  $('graph-frame').hidden = true;
  $('graph-error').hidden = true;
  try {
    const sourceQuery = source === 'system' ? '&source=system' : '';
    const result = await request(`/api/flow?name=${encodeURIComponent(name)}${sourceQuery}`);
    if (requestId !== state.skillRequestSeq) return;
    state.doc = result.doc;
    showFlow(result.doc);
    if (source === 'system') $('graph-status').textContent = 'annot 系统 Skill · ' + $('graph-status').textContent;
    const frame = $('graph-frame');
    frame.onload = () => { $('graph-loading').hidden = true; };
    frame.onerror = () => showGraphError('动作图加载失败。请刷新后重试。');
    frame.src = `/api/graph?name=${encodeURIComponent(name)}${sourceQuery}&embed=1`;
    frame.hidden = false;
    $('open-graph').onclick = () => window.open(`/api/graph?name=${encodeURIComponent(name)}${sourceQuery}`, '_blank', 'noopener,noreferrer');
  } catch (error) {
    if (requestId !== state.skillRequestSeq) return;
    if (error.status === 409 && error.body?.analyze) {
      showNoAnalysis(name, error.body);
      return;
    }
    showGraphError(error.message);
  }
}

/**
 * A Skill with no analysis has no graph, and a Skill whose analysis describes
 * an older revision has no graph either: the anchors in it point at bytes that
 * no longer exist, so drawing it would be a confident lie. Both are the same
 * missing step with the same way out, so they share one card; only the reason
 * and the two hashes differ, because "the file changed after I analysed it" is
 * something the reader has to be able to confirm at a glance.
 */
function showNoAnalysis(name, body) {
  const stale = body.reason === 'stale-analysis';
  state.doc = null;
  state.selectedNodeId = null;
  $('graph-loading').hidden = true;
  $('graph-frame').hidden = true;
  $('graph-status').textContent = stale ? '语义分析已过期 · 不生成图' : '没有语义分析 · 不生成图';
  $('graph-meta').textContent = '动作图只由 AI 语义分析生成，关键词规则不会冒充分析结果。';
  $('graph-count').textContent = '0';
  const target = $('graph-error');
  target.hidden = false;
  target.className = 'graph-empty';
  target.replaceChildren();
  const title = document.createElement('h3');
  title.textContent = stale ? '这个 Skill 的分析结果已经过期' : '这个 Skill 还没有语义分析';
  const copy = document.createElement('p');
  copy.textContent = stale
    ? `分析写的是 ${String(body.proposalSha || '').slice(0, 12)} 这一版，当前文件是 ${String(body.currentSha || '').slice(0, 12)}；两者对不上，旧锚点可能指向已经不存在的行，所以不画。重新生成分析会覆盖同一份结果文件。`
    : '动作图的节点、顺序和泳道都由 AI 读懂原文后给出；没有分析时网页不画图，也不退回关键词草案。';
  const path = document.createElement('code');
  path.textContent = body.analysisPath || '.annot/analyses/<skill>.analysis.json';
  const actions = document.createElement('div');
  actions.className = 'graph-empty-actions';
  const analyzeButton = document.createElement('button');
  analyzeButton.type = 'button';
  analyzeButton.className = 'button primary';
  analyzeButton.textContent = '生成 AI 分析任务';
  analyzeButton.addEventListener('click', () => void showAnalysisTask(name));
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'button secondary';
  copyButton.textContent = '复制分析任务';
  copyButton.addEventListener('click', () => void copyAnalysisTask(name, copyButton));
  actions.append(analyzeButton, copyButton);
  const hint = document.createElement('p');
  hint.className = 'graph-empty-path';
  hint.textContent = 'AI 结果写到：';
  hint.append(path);
  target.append(title, copy, actions, hint);
  selectNode(null);
}

function showFlow(doc) {
  const actionCount = doc.stats.byType.stage;
  const noteCount = doc.stats.byType.note ?? 0;
  $('skill-description').textContent = doc.description || 'SOURCE → FLOW';
  $('source-sha').textContent = doc.source.sha.slice(0, 12);
  $('source-sha').title = doc.source.sha;
  $('graph-count').textContent = String(actionCount);
  const orphanRate = doc.stats.noteCoverage ? Math.round(doc.stats.noteCoverage.orphanTextRate * 100) : 0;
  const associatedCount = doc.stats.noteCoverage?.associated ?? 0;
  $('graph-meta').textContent = `${actionCount} 个关键动作，${noteCount} 条说明（${associatedCount} 条已关联，${orphanRate}% 孤立），${doc.edges.length} 条连接，${doc.source.lines} 行原文`;
  const method = doc.source.method === 'ai' ? 'AI 语义分析' : '规则草案';
  $('graph-status').textContent = `${method} · ${doc.edges.some((edge) => edge.kind === 'branch') ? '含条件分支' : '执行关系'}`;
  // A reload keeps the card the reader was looking at, as long as it survived.
  selectNode(doc.nodes.find((node) => node.id === state.selectedNodeId) ?? null);
  $('audit-count').textContent = String(state.skills.length);
}

function openNodeDrawer({ focus = false } = {}) {
  if (document.activeElement instanceof HTMLElement) state.drawerReturnFocus = document.activeElement;
  $('node-drawer').hidden = false;
  $('node-drawer').setAttribute('aria-hidden', 'false');
  document.body.classList.add('panel-open');
  $('toggle-node-panel').setAttribute('aria-expanded', 'true');
  if (focus) $('drawer-title').focus();
}

function closeNodeDrawer({ restoreFocus = true } = {}) {
  $('node-drawer').hidden = true;
  $('node-drawer').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('panel-open');
  $('toggle-node-panel').setAttribute('aria-expanded', 'false');
  if (restoreFocus && state.drawerReturnFocus instanceof HTMLElement) state.drawerReturnFocus.focus();
}

function selectedNode() {
  return state.doc?.nodes.find((node) => node.id === state.selectedNodeId) ?? null;
}

/* The drawer is driven by the graph, not by its own list: the card the reader
   clicked is the only subject, so the detail, the rewrite form and the
   evaluation form always describe the same card.
 *
 * The three parts used to be stacked in one scroll: the anchored source alone
 * can be 300px, so "设计 Skill 评估" sat below the fold on a long card and the
 * feature read as if it existed only on the standards page. They are tabs now,
 * fixed under the header, so the evaluation entry is always one click away. */
/* The drawer is one reading order, not a tab strip: facts, the anchored source,
 * then the bounded rewrite. Their subjects are the same card, so splitting them
 * behind tabs only hid the rewrite behind a click and, on a fresh card, landed
 * the reader on the tab they had chosen for the previous one.
 *
 * Evaluation is a property of the whole Skill and lives beside the graph tabs.
 */
function selectNode(node) {
  const detail = $('node-detail');
  state.selectedNodeId = node?.id ?? null;
  renderDrawerSummary();
  if (!node) {
    $('drawer-title').textContent = '选中卡片';
    detail.innerHTML = '<p class="empty-detail">在左侧动作图里点一张卡片，这里显示它的类型、来源行、原文，以及针对这一步的自然语言修改。整份 Skill 的评估在动作图右上角。</p>';
    return;
  }
  $('drawer-title').textContent = node.label;
  const parts = [...nodeDetailParts(node)];
  parts.push(taskPanelMarkup('rewrite', node.id));
  detail.replaceChildren();
  for (const part of parts) {
    if (typeof part === 'string') detail.insertAdjacentHTML('beforeend', part);
    else detail.append(part);
  }
  detail.scrollTop = 0;
}

function renderDrawerSummary() {
  const node = selectedNode();
  $('drawer-summary').textContent = node
    ? `${nodeTypeLabel(node.type, node)} · L${node.anchor.start}–${node.anchor.end}`
    : state.doc ? `${state.doc.nodes.length} 张卡片 · 未选中` : '等待动作图';
}

/* The embedded graph is a separate document, so ask it to select a card when
   the reader arrives from the standards list instead of from the canvas. */
function revealInGraph(nodeId) {
  const frame = $('graph-frame');
  if (frame.hidden || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ type: 'annot-select-node', id: nodeId }, '*');
}

function nodeDetailParts(node) {
  // The drawer header already carries the card's label, so the detail starts
  // with where the card came from rather than repeating the title.
  const parts = [nodeFacts(node)];
  if (node.type === 'note') parts.push(associationList(node));
  parts.push(sectionTitle('锚定原文'), sourceBlock(node.raw));
  if (node.branches.length) parts.push(sectionTitle('分支'), branchList(node.branches));
  return parts;
}

function associationList(node) {
  const associations = (state.doc?.associations ?? []).filter((association) => association.from === node.id);
  const list = document.createElement('ul');
  list.className = 'association-list';
  if (node.associationScope === 'skill') {
    const item = document.createElement('li');
    item.textContent = '全局说明 · 作用于整个 Skill';
    list.append(item);
    return list;
  }
  if (associations.length === 0) {
    const item = document.createElement('li');
    item.className = 'orphan';
    item.textContent = '孤立说明 · 没有找到可证实的动作、门禁、判断或产物目标';
    list.append(item);
    return list;
  }
  for (const association of associations) {
    const target = state.doc?.nodes.find((candidate) => candidate.id === association.to);
    const item = document.createElement('li');
    const confidence = Math.round(association.confidence * 100);
    item.textContent = `${ASSOCIATION_LABEL[association.relation] || association.relation} → ${target?.label ?? association.to} · L${target?.anchor.start ?? '?'} · ${association.evidence} · ${confidence}%`;
    list.append(item);
  }
  return list;
}

function sectionTitle(text) {
  const title = document.createElement('h3');
  title.textContent = text;
  return title;
}

function nodeFacts(node) {
  const facts = document.createElement('dl');
  appendFact(facts, '类型', nodeTypeLabel(node.type, node));
  appendFact(facts, '来源行', `L${node.anchor.start}–${node.anchor.end}`);
  appendFact(facts, '小节', node.anchor.heading.join(' › ') || '前言');
  if (node.type === 'note') appendFact(facts, '作用范围', SCOPE_LABEL[node.associationScope] || '未分析');
  appendFact(facts, '行哈希', node.anchor.sha.slice(0, 12));
  return facts;
}

function sourceBlock(raw) {
  const original = document.createElement('pre');
  original.textContent = raw;
  return original;
}

function branchList(branches) {
  const list = document.createElement('ul');
  list.className = 'branch-list';
  for (const branch of branches) {
    const item = document.createElement('li');
    item.textContent = `${branch.when}${branch.to ? ' → ' + branch.to : ' · 未落地'}`;
    list.append(item);
  }
  return list;
}

function taskPanelMarkup(mode, nodeId = '') {
  const rewrite = mode === 'rewrite';
  const title = rewrite ? '用自然语言修改此卡片' : '设计 Skill 评估';
  const help = rewrite
    ? '修改由 Codex 或 DSH 宿主执行。网页只生成精确任务，不直接写 Skill 文件。'
    : 'AI 会先理解 Skill 的真实行为，再设计触发、行为、反例和成本场景；没有真实运行结果时，效果仍是“未测”。';
  const placeholder = rewrite
    ? '例如：把这一步改成先检查未提交改动，发现问题就停下来询问'
    : '可选补充业务目标、已知风险或特别关注的场景';
  const action = rewrite ? '生成修改任务' : '生成 AI 评估任务';
  const copyLabel = rewrite ? '复制修改任务' : '复制 AI 评估任务';
  const metricPicker = rewrite ? '' : evaluationMetricPicker();
  return `
    <section class="node-task" aria-labelledby="${mode}-task-title">
      <h3 id="${mode}-task-title">${title}</h3>
      <form class="task-form" data-brief-form data-mode="${mode}" data-node="${escapeHtml(nodeId)}">
        ${metricPicker}
        <label for="${mode}-intent">${rewrite ? '修改意图' : '自然语言补充（可选）'}</label>
        <textarea id="${mode}-intent" name="intent" rows="4" maxlength="8000" placeholder="${placeholder}"></textarea>
        <p id="${mode}-task-help" class="task-help">${help}</p>
        <div class="task-actions">
          <button class="button primary" type="submit">${action}</button>
          ${rewrite ? '<button class="button secondary" type="button" data-copy-context>复制基础上下文</button>' : ''}
        </div>
        <p class="task-status" role="status"></p>
      </form>
      <div class="brief-output" data-brief-output hidden>
        <div class="brief-output-heading">
          <strong>${rewrite ? '修改任务已生成' : 'AI 评估任务已生成 · 效果未测'}</strong>
          <button class="text-button" type="button" data-copy-brief data-copy-label="${copyLabel}">${copyLabel}</button>
        </div>
        <pre data-brief-text tabindex="0"></pre>
      </div>
    </section>`;
}

function evaluationMetricPicker() {
  const options = state.evaluationMetrics.map((metric) => `
    <label class="metric-option">
      <input type="checkbox" name="metric" value="${escapeHtml(metric.id)}">
      <span><strong>${escapeHtml(metric.label)}</strong><small>${escapeHtml(metric.description)}</small></span>
    </label>`).join('');
  return `<fieldset class="metric-picker">
    <legend class="metric-picker-head">
      <span>评估方向 <small>可选，可多选</small></span>
      <button class="text-button metric-select-all" type="button" data-toggle-all-metrics aria-pressed="false">全选</button>
    </legend>
    <div class="metric-grid">${options}</div>
  </fieldset>`;
}

function toggleAllMetrics(button) {
  const form = button.closest('[data-brief-form]');
  if (!(form instanceof HTMLFormElement)) return;
  const inputs = [...form.querySelectorAll('input[name="metric"]')];
  const selectAll = !inputs.every((input) => input.checked);
  for (const input of inputs) input.checked = selectAll;
  syncMetricToggle(form);
}

function syncMetricToggle(form) {
  const inputs = [...form.querySelectorAll('input[name="metric"]')];
  const button = form.querySelector('[data-toggle-all-metrics]');
  if (!(button instanceof HTMLButtonElement)) return;
  const all = inputs.length > 0 && inputs.every((input) => input.checked);
  button.textContent = all ? '清空' : '全选';
  button.setAttribute('aria-pressed', String(all));
}

function focusTaskPanel(mode) {
  openNodeDrawer();
  if (mode === 'rewrite' && !selectedNode()) {
    // A rewrite names one card; without one there is nothing to anchor it to.
    const hint = $('node-detail').querySelector('.empty-detail');
    if (hint) hint.textContent = '先在左侧动作图里点一张卡片，再描述这一步要改成什么。';
    $('node-detail').scrollIntoView({ block: 'start' });
    return;
  }
  window.requestAnimationFrame(() => {
    const field = document.getElementById(`${mode}-intent`);
    if (!(field instanceof HTMLTextAreaElement)) return;
    field.scrollIntoView({ block: 'center' });
    field.focus();
  });
}

/**
 * Design an evaluation for the whole Skill.
 *
 * It used to open the card drawer's third tab, which meant the entry for a
 * whole-Skill task lived in a strip whose subject was "this card" — and with no
 * card selected there was no card to anchor it to. `mode: evaluate` reads the
 * whole source, so the only inputs are the metric checkboxes and a free-text
 * goal; both live in a dialog, not in the drawer.
 */
async function showEvaluationTask(skill = state.selected) {
  if (!skill) {
    setError('先选择一个 Skill，再设计评估。');
    return;
  }
  const form = document.createElement('form');
  // `task-form` is what carries the grid gap; without it the label sat flush
  // against the textarea.
  form.className = 'node-task task-form evaluate-task';
  form.dataset.briefForm = '';
  form.dataset.mode = 'evaluate';
  form.innerHTML = `
    ${evaluationMetricPicker()}
    <label for="evaluate-skill-intent">自然语言补充（可选）</label>
    <textarea id="evaluate-skill-intent" name="intent" rows="3" maxlength="8000" placeholder="可选补充业务目标、已知风险或特别关注的场景"></textarea>
    <p class="task-help">AI 会先理解 Skill 的真实行为，再设计触发、行为、反例和成本场景；没有真实运行结果时，效果仍是“未测”。</p>
    <div class="task-actions">
      <button class="button primary" type="submit">生成 AI 评估任务</button>
    </div>
    <p class="task-status" role="status"></p>`;

  const dialog = document.createElement('dialog');
  dialog.className = 'brief-dialog evaluate-dialog';
  dialog.setAttribute('aria-labelledby', 'evaluate-dialog-title');
  const heading = document.createElement('div');
  heading.className = 'brief-dialog-heading';
  heading.innerHTML = `<div><p class="section-eyebrow">Evaluation</p><h2 id="evaluate-dialog-title">设计 Skill 评估 · ${escapeHtml(skill)}</h2><p>选择评估方向，或直接描述要验证的行为。结果交回宿主执行，网页不运行 Skill。</p></div>`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button';
  close.textContent = '关闭';
  close.addEventListener('click', () => dialog.close());
  heading.append(close);
  const body = document.createElement('div');
  body.className = 'evaluate-dialog-body';
  body.append(form);
  dialog.append(heading, body);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  if (dialog instanceof HTMLDialogElement) dialog.showModal();
  form.querySelector('textarea')?.focus();
}

/**
 * The drawer and the evaluation dialog share the form shape, so they share the
 * submit handler: one payload builder, one `/api/brief` call, one dialog.
 */
async function submitTaskForm(form) {
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector('.task-status');
  if (!(button instanceof HTMLButtonElement) || !status) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '正在生成…';
  status.textContent = '整理源文件范围与验收条件…';
  try {
    const metrics = [...form.querySelectorAll('input[name="metric"]:checked')].map((input) => input.value);
    const payload = {
      name: state.selected,
      source: state.selectedSource,
      node: form.dataset.node || undefined,
      mode: form.dataset.mode,
      intent: form.elements.intent.value,
      metrics: form.dataset.mode === 'evaluate' ? metrics : undefined,
    };
    const result = await request('/api/brief', { method: 'POST', body: payload });
    showBrief(form, result.brief, payload);
    status.textContent = '已生成。复制或保存为任务文件，交给宿主执行。';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function showAnalysisTask(skill = state.selected) {
  openNodeDrawer();
  const detail = $('node-detail');
  detail.replaceChildren();
  const section = document.createElement('section');
  section.className = 'node-task';
  section.innerHTML = `
    <h3>AI 语义分析</h3>
    <p class="task-help">网页不自行猜测语义。先生成包含源码锚点和 JSON 契约的分析任务，再交给 Codex 或 DSH 执行。</p>
    <p class="task-status" role="status">正在读取当前 Skill 并生成分析任务…</p>
    <div class="brief-output" data-brief-output hidden>
      <div class="brief-output-heading">
        <strong>AI 分析任务已生成</strong>
        <button class="text-button" type="button" data-copy-brief data-copy-label="复制 AI 分析任务">复制 AI 分析任务</button>
      </div>
      <pre data-brief-text tabindex="0"></pre>
    </div>`;
  detail.append(section);
  try {
    const payload = { name: skill, source: state.selectedSource, mode: 'analyze', intent: '' };
    const result = await request('/api/brief', { method: 'POST', body: payload });
    const status = section.querySelector('.task-status');
    if (status) status.textContent = '已生成。宿主 AI 把 JSON 写回上面的路径后，点「刷新此 Skill」重建图。';
    showBrief(section, result.brief, payload);
  } catch (error) {
    const status = section.querySelector('.task-status');
    if (status) status.textContent = error.message;
  }
}

async function generateRepairTask(checks = [], button = null, skill = state.selected, intent = '') {
  const label = button instanceof HTMLButtonElement ? button.textContent : '';
  if (button instanceof HTMLButtonElement) {
    button.disabled = true;
    button.textContent = '正在生成…';
  }
  setError('');
  try {
    const payload = { name: skill, source: 'user', mode: 'repair', checks, intent };
    const result = await request('/api/brief', { method: 'POST', body: payload });
    const scope = checks.length ? `选定 ${checks.length} 项` : `${result.targets.length} 项`;
    const note = result.note ? ` · 含 ${result.note.length} 字补充说明` : '';
    openTaskDialog(
      'Skill 规范修复任务',
      `${result.skill} · ${scope} · 源哈希 ${String(result.source_sha).slice(0, 12)}${note}。保存为任务文件后按提示运行；修完用 annot review 复核。`,
      result.brief,
      payload,
    );
  } catch (error) {
    setError(error.message);
  } finally {
    if (button instanceof HTMLButtonElement) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}

/**
 * Compose a repair task from a dialog instead of firing one straight off.
 *
 * The clipboard is where the reason for a repair usually already lives — an
 * issue, a review note, a chat message — so the form takes one pasted block and
 * quotes it into the task verbatim. Reading the clipboard needs a permission
 * the browser may refuse; the textarea still accepts a plain paste, so the
 * button only ever fills what the reader could type by hand.
 */
function showRepairTask(checks = [], skill = state.selected) {
  if (!skill) {
    setError('先选择一个 Skill，再生成修复任务。');
    return;
  }
  const scope = checks.length ? `选定 ${checks.length} 项检查` : '全部未通过项';
  const form = document.createElement('form');
  form.className = 'node-task task-form repair-task';
  form.dataset.repairForm = '';
  form.innerHTML = `
    <label for="repair-skill-intent">补充说明（可选）<span class="label-hint">粘贴评审意见或这次只想先修的重点</span></label>
    <div class="intent-field">
      <textarea id="repair-skill-intent" name="intent" rows="5" maxlength="8000" placeholder="例如：先只修 description 的触发词，正文结构这次不动"></textarea>
      <button class="button secondary paste-button" type="button" data-paste-intent>从剪贴板粘贴</button>
    </div>
    <p class="task-help">这段说明会原样引用进任务，只影响先修哪几项与取舍，不会扩大可改动的范围。</p>
    <div class="task-actions">
      <button class="button primary" type="submit">生成修复任务 · ${escapeHtml(scope)}</button>
    </div>
    <p class="task-status" role="status"></p>`;

  const dialog = document.createElement('dialog');
  dialog.className = 'brief-dialog evaluate-dialog';
  dialog.setAttribute('aria-labelledby', 'repair-dialog-title');
  const heading = document.createElement('div');
  heading.className = 'brief-dialog-heading';
  heading.innerHTML = `<div><p class="section-eyebrow">Repair</p><h2 id="repair-dialog-title">生成 Skill 修复任务 · ${escapeHtml(skill)}</h2><p>${escapeHtml(scope)}。任务由宿主执行，网页不修改 Skill 文件。</p></div>`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button';
  close.textContent = '关闭';
  close.addEventListener('click', () => dialog.close());
  heading.append(close);
  const body = document.createElement('div');
  body.className = 'evaluate-dialog-body';
  body.append(form);
  dialog.append(heading, body);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  if (dialog instanceof HTMLDialogElement) dialog.showModal();

  const submit = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const field = form.elements.intent;
    const intent = field instanceof HTMLTextAreaElement ? field.value.trim() : '';
    dialog.close();
    void generateRepairTask(checks, submit, skill, intent);
  });
  form.querySelector('textarea')?.focus();
}

/** Fill the intent field from the clipboard, or say why it could not. */
async function pasteIntoIntent(button) {
  const field = button.closest('form')?.querySelector('textarea[name="intent"]');
  const status = button.closest('form')?.querySelector('.task-status');
  if (!(field instanceof HTMLTextAreaElement)) return;
  const label = button.textContent;
  button.disabled = true;
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      if (status) status.textContent = '剪贴板是空的。';
      return;
    }
    field.value = text.slice(0, Number(field.maxLength) > 0 ? Number(field.maxLength) : 8000);
    field.focus();
    if (status) status.textContent = '已粘贴剪贴板内容。';
  } catch {
    // Browsers gate clipboard reads behind a permission prompt that can be
    // denied silently; the textarea still takes a normal Ctrl+V.
    if (status) status.textContent = '浏览器未允许读取剪贴板，请直接在输入框里按 Ctrl+V 粘贴。';
    field.focus();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function showBrief(panel, brief, taskRequest = null) {
  const output = panel.querySelector('[data-brief-output]');
  const text = panel.querySelector('[data-brief-text]');
  if (!(output instanceof HTMLElement) || !(text instanceof HTMLElement)) return;
  text.textContent = brief;
  output.hidden = false;
  output.scrollIntoView({ block: 'nearest' });

  const mode = panel.querySelector('[data-brief-form]')?.dataset.mode ?? (panel.textContent.includes('AI 语义分析') ? 'analyze' : '');
  const title = TASK_TITLE[mode] ?? 'AI 语义分析任务';
  openTaskDialog(title, '完整任务已生成。复制后交给 Codex、DSH 或 ZCode 宿主执行；网页仍不直接修改 Skill。', brief, taskRequest);
}

function openTaskDialog(title, meta, brief, request = null) {
  $('brief-dialog-title').textContent = title;
  $('brief-dialog-meta').textContent = meta;
  $('brief-dialog-text').textContent = brief;
  state.dialogTask = request;
  const save = $('save-brief-dialog');
  save.hidden = !request;
  save.disabled = false;
  save.textContent = '保存为任务文件';
  $('brief-dialog-command').hidden = true;
  $('brief-dialog-command').replaceChildren();
  const dialog = $('brief-dialog');
  if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
}

/**
 * Write the task the dialog is showing to `.annot/tasks/` and hand back the one
 * command that runs it.
 *
 * Copy-to-clipboard was the only exit, and a 40KB task pasted into a terminal is
 * where quoting goes wrong. The page still never starts a process: it writes one
 * Markdown file and shows the command for the user to run.
 */
async function saveTaskFile() {
  const payload = state.dialogTask;
  const button = $('save-brief-dialog');
  if (!payload) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '正在写入…';
  try {
    const result = await request('/api/tasks', { method: 'POST', body: payload });
    button.textContent = '已保存';
    const line = document.createElement('pre');
    line.className = 'task-command';
    line.textContent = result.command;
    const note = document.createElement('p');
    note.className = 'task-command-note';
    note.textContent = result.claudeFound
      ? `任务已写入 ${result.file}。在终端运行上面的命令即可交给 Claude Code；网页不执行它。`
      : `任务已写入 ${result.file}，但 PATH 里没有 claude 命令。先安装 Claude Code，或直接把上面这段贴给任意宿主 Agent。`;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'button secondary';
    copy.textContent = '复制命令';
    copy.addEventListener('click', () => void copyText(result.command, copy, '复制命令'));
    const box = $('brief-dialog-command');
    box.replaceChildren(note, line, copy);
    box.hidden = false;
  } catch (error) {
    button.textContent = error.message;
    window.setTimeout(() => { button.disabled = false; button.textContent = label; }, 2200);
  }
}

/** Copy without opening the drawer: the empty canvas is already the task view. */
async function copyAnalysisTask(skill, button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '正在生成…';
  try {
    const result = await request('/api/brief', {
      method: 'POST',
      body: { name: skill, source: state.selectedSource, mode: 'analyze', intent: '' },
    });
    await navigator.clipboard.writeText(result.brief);
    button.textContent = '已复制到剪贴板';
  } catch (error) {
    button.textContent = error.message;
  } finally {
    window.setTimeout(() => { button.disabled = false; button.textContent = label; }, 1800);
  }
}

async function copyBrief(button) {
  const text = button.closest('dialog, .node-task')?.querySelector('[data-brief-text]')?.textContent ?? '';
  await copyText(text, button, button.dataset.copyLabel || '复制任务');
}


function appendFact(list, label, value) {
  const term = document.createElement('dt');
  term.textContent = label;
  const detail = document.createElement('dd');
  detail.textContent = value;
  list.append(term, detail);
}

async function copyContext(nodeId, button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '正在准备上下文…';
  try {
    const context = await request(`/api/context?name=${encodeURIComponent(state.selected)}&node=${encodeURIComponent(nodeId)}`);
    await copyText(formatContext(context), button, label);
  } catch (error) {
    button.textContent = error.message;
    window.setTimeout(() => { button.disabled = false; button.textContent = label; }, 1800);
  }
}

async function copyText(text, button, label = button.textContent) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = '已复制到剪贴板';
  } catch (error) {
    button.textContent = error.message === 'navigator.clipboard.writeText is not a function' ? '浏览器未开放剪贴板权限' : error.message;
  } finally {
    window.setTimeout(() => { button.disabled = false; button.textContent = label; }, 1800);
  }
}

function formatContext(context) {
  return `# 目标：${context.skill} / ${context.target.id}\n\n小节：${context.target.heading.join(' › ') || '(前言)'}\n类型：${nodeTypeLabel(context.target.type)}　锚点：${context.target.start}–${context.target.end}\n\n## 原文（请在此基础上改）\n\`\`\`\n${context.original}\n\`\`\`\n\n## 约束\n${context.rules.map((rule) => `- ${rule}`).join('\n')}`;
}

function showGraphError(message) {
  $('graph-loading').hidden = true;
  $('graph-frame').hidden = true;
  const target = $('graph-error');
  // `showNoAnalysis` turns this box into an invitation; an actual failure has to
  // turn it back into an alert, or the next error renders inside a polite card.
  target.className = 'graph-error';
  target.textContent = message;
  target.hidden = false;
}

function setActiveTab(tab) {
  for (const name of ['graph', 'standards', 'audit']) {
    const active = tab === name;
    $(`${name}-tab`).classList.toggle('active', active);
    $(`${name}-tab`).setAttribute('aria-pressed', String(active));
    $(`${name}-view`).hidden = !active;
  }
}

async function showStandards() {
  setActiveTab('standards');
  if (state.standardsLoaded && state.standards?.skill === state.selected) return;
  $('standards-loading').hidden = false;
  $('standards-groups').replaceChildren();
  setReadinessSummary('查', '正在检查当前 Skill…', 'neutral');
  try {
    const sourceQuery = state.selectedSource === 'system' ? '&source=system' : '';
    state.standards = await request(`/api/review?name=${encodeURIComponent(state.selected)}${sourceQuery}`);
    renderStandards(state.standards);
    state.standardsLoaded = true;
  } catch (error) {
    $('standards-loading').hidden = false;
    $('standards-loading').textContent = error.message;
    setReadinessSummary('!', '检查失败', 'blocked');
    $('standards-badge').textContent = '失败';
  }
}

function renderStandards(report) {
  $('standards-loading').hidden = true;
  const labels = { ready: ['通过', '静态规范没有阻断或建议项。'], review: ['建议复核', '没有阻断项，但有需要人工判断的建议。'], blocked: ['存在阻断项', '先修复阻断项，再进行行为评估。'] };
  const [title, note] = labels[report.readiness];
  setReadinessSummary(title, `${report.summary.pass} 通过 · ${report.summary.warn} 建议 · ${report.summary.fail} 阻断`, report.readiness);
  $('standards-badge').textContent = report.readiness === 'ready' ? '通过' : report.readiness === 'blocked' ? `${report.summary.fail} 阻断` : `建议 ${report.summary.warn}`;
  const fixable = repairCandidates(report);
  // The panel used to offer only an evaluation task, so a skill with a blocker
  // had no button that produced a fix. There is exactly one Skill-wide repair
  // entry, the bar under the sheet: it names the scope, so the reader knows it
  // is not a rewrite of the whole file. Per-check repair lives beside each
  // failing finding; an extra copy in the header and the aside just made the
  // same task look like three different ones.
  $('standards-repair-bar').hidden = fixable.length === 0;
  $('standards-repair-note').textContent = fixable.length
    ? `将修 ${fixable.length} 项：${fixable.map((check) => check.title).join('、')}。任务带行号、当前原文和每项验收条件，网页不写文件。`
    : '没有未通过项。';
  $('standards-repair').textContent = `生成修复任务（${fixable.length}）`;
  $('standards-groups').replaceChildren(...report.groups.map(standardGroup));
  renderEvaluation(report.evaluation);
}

function repairCandidates(report) {
  return (report.checks ?? []).filter((check) => check.status !== 'pass');
}

function setReadinessSummary(title, detail, status) {
  const card = $('standards-summary');
  card.className = `readiness-card ${status}`;
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = detail;
  card.replaceChildren(strong, span);
}

function standardGroup(group) {
  const section = document.createElement('section');
  section.className = 'standard-group';
  const heading = document.createElement('header');
  const copy = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = group.title;
  const note = document.createElement('p');
  note.textContent = group.note;
  copy.append(title, note);
  const counts = statusCounts(group.checks);
  const badge = document.createElement('span');
  badge.className = 'group-count';
  badge.textContent = `${counts.pass} 通过 · ${counts.warn} 建议 · ${counts.fail} 阻断`;
  heading.append(copy, badge);
  const list = document.createElement('ul');
  list.className = 'standard-checks';
  list.replaceChildren(...group.checks.map(standardCheck));
  section.append(heading, list);
  return section;
}

function standardCheck(check) {
  const item = document.createElement('li');
  item.className = `standard-check ${check.status}`;
  item.dataset.check = check.id;
  const marker = document.createElement('span');
  marker.className = 'check-marker';
  marker.textContent = check.status === 'pass' ? '通过' : check.status === 'warn' ? '建议' : '需修';
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = check.title;
  const detail = document.createElement('p');
  detail.textContent = check.detail;
  copy.append(title, detail);
  if (check.evidence) {
    const evidence = document.createElement('code');
    evidence.textContent = check.evidence;
    copy.append(evidence);
  }
  if (check.status !== 'pass' && Array.isArray(check.lines) && check.lines.length) {
    const where = document.createElement('code');
    where.className = 'check-lines';
    where.textContent = `L${check.lines.map((line) => line.start === line.end ? line.start : `${line.start}–${line.end}`).join('、L')}`;
    copy.append(where);
  }
  const actions = document.createElement('div');
  actions.className = 'standard-check-actions';
  if (check.status !== 'pass') {
    // Per-item repair: the finding itself becomes the request, so a reader does
    // not have to re-describe the problem in the rewrite box to get a fix.
    const repair = document.createElement('button');
    repair.type = 'button';
    repair.className = 'standard-evidence-button repair';
    repair.dataset.repairCheck = check.id;
    repair.textContent = '生成这一项的修复任务';
    actions.append(repair);
  }
  if (Array.isArray(check.nodeTargets) && check.nodeTargets.length) {
    const locate = document.createElement('button');
    locate.type = 'button';
    locate.className = 'standard-evidence-button';
    locate.dataset.standardNode = check.nodeTargets[0].id;
    locate.textContent = `定位 ${check.nodeTargets.length} 条孤立说明`;
    actions.append(locate);
  }
  if (actions.childElementCount) copy.append(actions);
  item.append(marker, copy);
  return item;
}

function openStandardEvidence(nodeId) {
  const node = state.doc?.nodes.find((item) => item.id === nodeId);
  if (!node) {
    setError('说明节点已经变化，请刷新此 Skill 后重试。');
    return;
  }
  setActiveTab('graph');
  selectNode(node);
  openNodeDrawer({ focus: true });
  revealInGraph(node.id);
}

function statusCounts(checks) {
  return checks.reduce((counts, check) => ({ ...counts, [check.status]: counts[check.status] + 1 }), { pass: 0, warn: 0, fail: 0 });
}

function renderEvaluation(method) {
  $('evaluation-boundary').textContent = method.boundary;
  $('evaluation-stages').replaceChildren(...method.stages.map((stage, index) => {
    const item = document.createElement('li');
    const number = document.createElement('span');
    number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = stage.title;
    const question = document.createElement('p');
    question.textContent = stage.question;
    const text = document.createElement('small');
    text.textContent = `${stage.method} 证据：${stage.evidence}`;
    copy.append(title, question, text);
    item.append(number, copy);
    return item;
  }));
  $('evaluation-tools').replaceChildren(...method.tools.map((tool) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = tool.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = tool.name;
    const fit = document.createElement('span');
    fit.textContent = tool.fit;
    item.append(link, fit);
    return item;
  }));
  $('evaluation-sources').replaceChildren(...method.sources.map((source) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = source.title;
    item.append(link);
    return item;
  }));
}

async function showAudit() {
  setActiveTab('audit');
  if (state.auditLoaded) return;
  $('audit-state').textContent = '正在检查全部已发现的 Skill…';
  try {
    const result = await request('/api/audit');
    $('audit-count').textContent = String(result.audits.length);
    $('audit-state').hidden = result.audits.length > 0;
    $('audit-state').textContent = result.audits.length ? '' : '当前扫描范围没有 Skill。';
    $('audit-rows').replaceChildren(...result.audits.map(auditRow));
    state.auditLoaded = true;
  } catch (error) {
    $('audit-state').hidden = false;
    $('audit-state').textContent = error.message;
  }
}

function auditRow(audit) {
  const row = document.createElement('tr');
  const orphan = `${audit.orphanNotes}/${audit.noteCount} · ${Math.round(audit.orphanTextRate * 100)}%`;
  const values = [audit.skill, audit.score.toFixed(1), audit.nodes, audit.lowConfidence, audit.unresolvedBranches, orphan, audit.file];
  values.forEach((value, index) => {
    const cell = document.createElement('td');
    if (index === 0) {
      const link = document.createElement('button');
      link.type = 'button';
      link.textContent = value;
      link.addEventListener('click', () => openSkill(audit.skill));
      cell.append(link);
    } else if (index === 1) {
      const score = document.createElement('span');
      score.className = `score-chip${audit.score >= 10 ? ' warn' : ''}`;
      score.textContent = value;
      cell.append(score);
    } else {
      cell.textContent = value;
      if (index === 6) cell.title = value;
    }
    row.append(cell);
  });
  return row;
}

async function searchSkills() {
  const query = $('skill-search').value.trim();
  if (!query) {
    const result = await request('/api/skills');
    displaySkills(result.skills, result.skills.length ? '' : '当前目录没有可读取的 Skill。', '全部 Skill');
    return;
  }
  const body = $('search-body').checked ? '&body=1' : '';
  const result = await request(`/api/search?q=${encodeURIComponent(query)}${body}`);
  const descriptions = new Map(state.skills.map((skill) => [skill.name, skill]));
  displaySkills(result.matches.map((match) => ({ ...descriptions.get(match.name), ...match })), '没有匹配的 Skill。', '搜索结果');
}

function setAppView(view) {
  state.appView = ['library', 'report', 'versions'].includes(view) ? view : 'library';
  document.body.dataset.appView = state.appView;
  if (location.hash !== '#' + state.appView) history.replaceState(null, '', '#' + state.appView);
  $('main-content').scrollTop = 0;
  window.scrollTo(0, 0);
  for (const button of document.querySelectorAll('.workspace-choice')) {
    const active = button.dataset.appView === state.appView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const libraryView = state.appView === 'library';
  $('welcome').hidden = !libraryView || Boolean(state.selected);
  $('skill-view').hidden = !libraryView || !state.selected;
  $('report-workspace').hidden = state.appView !== 'report';
  $('versions-workspace').hidden = state.appView !== 'versions';
  closeNodeDrawer({ restoreFocus: false });
  if (state.appView === 'report') void loadLibraryReport().catch((error) => setError(error.message));
  if (state.appView === 'versions') void loadSnapshots().catch((error) => setError(error.message));
}

async function loadLibraryReport() {
  $('report-loading').hidden = false;
  $('report-loading').textContent = '正在汇总全部 Skill…';
  try {
    const report = await request('/api/library-report');
    state.libraryReport = report;
    renderLibraryReport(report);
  } catch (error) {
    $('report-loading').textContent = error.message;
    $('report-loading').hidden = false;
    throw error;
  }
}

function renderLibraryReport(report) {
  $('report-loading').hidden = true;
  $('report-stamp').textContent = new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false });
  $('report-issue-total').textContent = `${report.summary.issues} 个问题`;
  $('report-skill-count').textContent = String(report.summary.skills);
  $('report-review-count').textContent = String(report.summary.review);
  $('report-blocked-count').textContent = String(report.summary.blocked);
  $('report-orphan-count').textContent = String(report.summary.orphanNotes);
  $('report-unmeasured-count').textContent = `${report.summary.unmeasuredSkills} 个 Skill 等待对照运行`;
  $('report-boundary').textContent = report.boundary;
  $('report-fail-count').textContent = String(report.summary.fail);
  $('report-warn-count').textContent = String(report.summary.warn);
  renderReportIssues();
  const skills = report.skills.map((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `report-skill-card ${item.readiness}`;
    const heading = document.createElement('span');
    heading.className = 'report-skill-name';
    heading.textContent = item.skill;
    const status = document.createElement('span');
    status.className = 'report-skill-status';
    status.textContent = item.readiness === 'blocked' ? '阻断' : item.readiness === 'review' ? '需复核' : '静态通过';
    const detail = document.createElement('small');
    detail.textContent = `${item.issues.length} 个问题 · ${item.audit.nodes} 张卡片 · ${item.audit.orphanNotes} 条孤立说明`;
    button.append(heading, status, detail);
    button.title = item.file;
    button.addEventListener('click', () => void openReportSkill(item.skill, 'graph'));
    return button;
  });
  $('report-skill-list').replaceChildren(...skills);
  $('report-skill-summary').textContent = `${report.skills.length} 个 Skill`;
}

function renderReportIssues() {
  const report = state.libraryReport;
  if (!report) return;
  const issues = state.reportFilter === 'all' ? report.issues : report.issues.filter((issue) => issue.severity === state.reportFilter);
  for (const button of document.querySelectorAll('[data-report-filter]')) {
    const active = button.dataset.reportFilter === state.reportFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  $('report-issue-summary').textContent = `${issues.length} 条`;
  const rows = issues.slice(0, 120).map((issue, index) => {
    const item = document.createElement('li');
    item.className = `report-issue ${issue.severity}`;
    const number = document.createElement('span');
    number.className = 'report-issue-index';
    number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = issue.title;
    const detail = document.createElement('p');
    detail.textContent = issue.detail;
    const meta = document.createElement('span');
    meta.textContent = `${issue.skill} · ${issue.kind === 'standard' ? '静态规范' : '抽取结构'} · ${issue.severity === 'fail' ? '阻断' : '建议'}`;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'text-button';
    action.textContent = issue.check ? `生成「${issue.title}」修复任务` : '打开 Skill';
    action.addEventListener('click', () => {
      if (issue.check) showRepairTask([issue.check], issue.skill);
      else void openReportSkill(issue.skill, 'standards');
    });
    copy.append(meta, heading, detail, action);
    item.append(number, copy);
    return item;
  });
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'report-issue-empty';
    empty.textContent = state.reportFilter === 'fail' ? '当前没有静态阻断问题。可切换到“建议复核”继续处理。' : '当前筛选没有结果。';
    rows.push(empty);
  }
  $('report-issue-list').replaceChildren(...rows);
}

async function openReportSkill(name, tab) {
  setAppView('library');
  await openSkill(name);
  if (tab === 'standards') await showStandards();
}

function libraryReportMarkdown(report) {
  const esc = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const rows = report.skills.map((skill) =>
    `| ${esc(skill.skill)} | ${skill.readiness === 'blocked' ? '阻断' : skill.readiness === 'review' ? '需复核' : '静态通过'} | ${skill.issues.length} | ${skill.audit.nodes} | ${skill.audit.orphanNotes} |`,
  );
  const issues = report.issues.map((issue) =>
    `- **${issue.severity === 'fail' ? '阻断' : '建议'} · ${esc(issue.skill)} · ${esc(issue.title)}**：${esc(issue.detail)}`,
  );
  return [
    '# annot Skill 库评估报告', '',
    `生成时间：${report.generatedAt}`,
    `扫描目录：${report.roots.length}`,
    '',
    '## 摘要', '',
    `- Skill：${report.summary.skills}`,
    `- 静态通过：${report.summary.ready}`,
    `- 建议复核：${report.summary.review}`,
    `- 阻断：${report.summary.blocked}`,
    `- 问题：${report.summary.issues}（阻断 ${report.summary.fail} / 建议 ${report.summary.warn}）`,
    `- 孤立说明：${report.summary.orphanNotes}`,
    `- 行为效果：未测（${report.summary.unmeasuredSkills} 个 Skill）`,
    '',
    '## 边界', '', report.boundary, '',
    '## 按修复优先级', '',
    '| Skill | 状态 | 问题数 | 卡片数 | 孤立说明 |',
    '|---|---:|---:|---:|---:|',
    ...rows, '',
    '## 全部问题', '',
    ...issues,
  ].join('\n');
}

function downloadLibraryReport(format = 'markdown') {
  if (!state.libraryReport) return;
  const json = format === 'json';
  const payload = json
    ? JSON.stringify({ exportedAt: new Date().toISOString(), report: state.libraryReport }, null, 2)
    : libraryReportMarkdown(state.libraryReport);
  const extension = json ? 'json' : 'md';
  const type = json ? 'application/json' : 'text/markdown';
  const url = URL.createObjectURL(new Blob([payload], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `annot-library-report-${new Date().toISOString().slice(0, 10)}.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
}
async function loadSnapshots() {
  const result = await request('/api/snapshots');
  state.snapshots = Array.isArray(result.snapshots) ? result.snapshots : [];
  renderSnapshots();
}

function renderSnapshots() {
  const versions = [];
  const byFingerprint = new Map();
  for (const snapshot of state.snapshots) {
    const existing = byFingerprint.get(snapshot.fingerprint);
    if (existing) existing.captures += 1;
    else {
      const version = { ...snapshot, captures: 1 };
      byFingerprint.set(snapshot.fingerprint, version);
      versions.push(version);
    }
  }
  $('snapshot-count').textContent = state.snapshots.length
    ? `${versions.length} 个内容版本 · ${state.snapshots.length} 次记录`
    : '0 个快照';
  $('version-current').textContent = state.snapshots.length ? `${versions.length} 个内容版本` : '尚未创建';
  const rows = versions.map((snapshot) => {
    const item = document.createElement('li');
    const marker = document.createElement('span');
    marker.className = 'version-marker';
    marker.textContent = snapshot.fingerprint.slice(0, 6);
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = snapshot.label;
    const detail = document.createElement('span');
    const captures = snapshot.captures > 1 ? ` · 记录 ${snapshot.captures} 次` : '';
    detail.textContent = `${new Date(snapshot.createdAt).toLocaleString('zh-CN', { hour12: false })} · ${snapshot.skills} 个 Skill${captures}`;
    const id = document.createElement('code');
    id.textContent = snapshot.id;
    copy.append(title, detail, id);
    item.append(marker, copy);
    return item;
  });
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'version-empty';
    empty.textContent = '还没有快照。先创建一个基线，再让宿主执行优化，之后创建第二个快照对比。';
    rows.push(empty);
  }
  $('version-list').replaceChildren(...rows);
  for (const id of ['version-from', 'version-to']) {
    const select = $(id);
    select.replaceChildren(...state.snapshots.map((snapshot) => {
      const option = document.createElement('option');
      option.value = snapshot.id;
      option.textContent = `${snapshot.label} · ${new Date(snapshot.createdAt).toLocaleString('zh-CN', { hour12: false })}`;
      return option;
    }));
  }
  const newest = state.snapshots[0];
  const previous = state.snapshots[1];
  if (newest) $('version-to').value = newest.id;
  if (previous) $('version-from').value = previous.id;
  $('compare-versions').disabled = state.snapshots.length < 2;
  if (state.snapshots.length >= 2) void compareVersions();
  if (state.snapshots.length < 2) {
    $('version-diff').innerHTML = '<p>创建至少两个快照后，可以查看新增、修改和移除的 Skill。</p>';
    $('version-diff-summary').textContent = '需要两个快照';
    $('version-restore-task').disabled = true;
  }
}
async function createCurrentSnapshot(label, button = null) {
  const previousText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = '正在创建…';
  }
  try {
    const result = await request('/api/snapshots', { method: 'POST', body: { label } });
    await loadSnapshots();
    if (button) button.textContent = '快照已创建';
    return result.snapshot;
  } catch (error) {
    setError(error.message);
    throw error;
  } finally {
    if (button) {
      button.disabled = false;
      window.setTimeout(() => { button.textContent = previousText; }, 1200);
    }
  }
}

async function compareVersions() {
  const from = $('version-from').value;
  const to = $('version-to').value;
  if (!from || !to || from === to) {
    setError('请选择两个不同的快照。');
    return;
  }
  try {
    const diff = await request(`/api/snapshots/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    state.snapshotDiff = diff;
    renderSnapshotDiff(diff);
  } catch (error) {
    setError(error.message);
  }
}

function renderSnapshotDiff(diff) {
  const groups = [
    ['修改', diff.changed, 'changed'],
    ['新增', diff.added, 'added'],
    ['移除', diff.removed, 'removed'],
  ];
  const total = diff.changed.length + diff.added.length + diff.removed.length;
  $('version-diff-summary').textContent = `${total} 项变化 · ${diff.unchanged} 项未变`;
  const root = document.createElement('div');
  root.className = 'diff-groups';
  for (const [label, names, className] of groups) {
    const section = document.createElement('section');
    section.className = `diff-group ${className}`;
    const heading = document.createElement('h4');
    heading.textContent = `${label} ${names.length}`;
    const list = document.createElement('ul');
    if (!names.length) {
      const item = document.createElement('li');
      item.textContent = '无';
      list.append(item);
    } else {
      list.append(...names.map((name) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'text-button';
        button.textContent = name;
        button.addEventListener('click', () => void openReportSkill(name, 'graph'));
        item.append(button);
        return item;
      }));
    }
    section.append(heading, list);
    root.append(section);
  }
  $('version-diff').replaceChildren(root);
  $('version-restore-task').disabled = total === 0;
}

function buildRestoreTask() {
  const diff = state.snapshotDiff;
  if (!diff) return '';
  const names = (values) => values.length ? values.map((name) => `- ${name}`).join('\n') : '- 无';
  return [
    '# annot Skill 版本恢复任务', '',
    `目标快照：${diff.to.id}`,
    `目标快照文件：${diff.to.path}`,
    `当前基线：${diff.from.id}`,
    '',
    '## 差异',
    `### 修改 ${diff.changed.length}`,
    names(diff.changed), '',
    `### 新增 ${diff.added.length}`,
    names(diff.added), '',
    `### 移除 ${diff.removed.length}`,
    names(diff.removed), '',
    '## 执行要求',
    '1. 先检查 Git 工作区和未提交修改，不得覆盖无关改动。',
    '2. 读取目标快照 JSON 中对应 Skill 的 content；快照保存完整原文与 sha256。',
    '3. 只恢复上方列出的差异项；对每项先展示当前与目标的差异，再执行恢复。',
    '4. 恢复后用 `annot review` 和 `annot audit` 复查，并创建新的对比快照。',
    '5. 若目标快照与当前文件还有用户新增修改，停止并报告冲突，不要强行覆盖。',
  ].join('\n');
}

async function optimizeLibrary(button) {
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = '正在生成基线…';
  try {
    const result = await request('/api/library-report/task', {
      method: 'POST',
      body: { label: '整库优化前自动快照' },
    });
    state.libraryReport = result.report;
    renderLibraryReport(result.report);
    await loadSnapshots();
    openTaskDialog(
      '整库评估与优化任务',
      `已自动创建快照 ${result.snapshot.id}。评估报告：${result.markdownPath}；机器数据：${result.reportPath}。复制后交给 Codex、DSH 或 ZCode 宿主执行。`,
      result.brief,
    );
  } catch (error) {
    setError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}
function bindEvents() {
  for (const button of document.querySelectorAll('.workspace-choice')) {
    button.addEventListener('click', () => setAppView(button.dataset.appView));
  }
  $('refresh-report').addEventListener('click', () => void loadLibraryReport().catch((error) => setError(error.message)));
  for (const button of document.querySelectorAll('[data-report-filter]')) {
    button.addEventListener('click', () => {
      state.reportFilter = button.dataset.reportFilter;
      renderReportIssues();
    });
  }
  $('download-report').addEventListener('click', downloadLibraryReport);
  $('optimize-library').addEventListener('click', () => void optimizeLibrary($('optimize-library')));
  $('snapshot-from-report').addEventListener('click', () => void createCurrentSnapshot('整库评估基线快照', $('snapshot-from-report')).catch((error) => setError(error.message)));
  $('create-snapshot').addEventListener('click', () => void createCurrentSnapshot($('snapshot-label').value.trim() || '手动快照', $('create-snapshot')).then(() => { $('snapshot-label').value = ''; }).catch((error) => setError(error.message)));
  $('compare-versions').addEventListener('click', () => void compareVersions());
  $('version-restore-task').addEventListener('click', () => {
    const brief = buildRestoreTask();
    if (brief) openTaskDialog('Skill 版本恢复任务', '根据本地快照生成。复制后交给宿主执行，网页不会直接覆盖 Skill。', brief);
  });
  $('refresh').addEventListener('click', () => { state.auditLoaded = false; void loadLibrary(); });
  $('root-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const checked = [...$('root-list').querySelectorAll('input[name="skill-root"]:checked')].map((input) => input.value);
    const custom = $('custom-roots').value.split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
    void submitRoots({ paths: [...checked, ...custom] });
  });
  $('reset-roots').addEventListener('click', () => void submitRoots({ reset: true }));
  $('reload-skill').addEventListener('click', () => void openSkill(state.selected));
  $('toggle-node-panel').addEventListener('click', () => openNodeDrawer({ focus: true }));
  $('analyze-skill').addEventListener('click', () => void showAnalysisTask());
  $('rewrite-skill').addEventListener('click', () => focusTaskPanel('rewrite'));
  // Evaluation is a whole-Skill task: it gets its own dialog, no card required.
  $('evaluate-skill').addEventListener('click', () => void showEvaluationTask());
  $('standards-evaluate').addEventListener('click', () => void showEvaluationTask());
  $('close-node-panel').addEventListener('click', () => closeNodeDrawer());
  $('node-detail').addEventListener('submit', (event) => {
    const form = event.target.closest?.('[data-brief-form]');
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    void submitTaskForm(form);
  });
  $('node-detail').addEventListener('click', (event) => {
    const copyBriefButton = event.target.closest?.('[data-copy-brief]');
    if (copyBriefButton instanceof HTMLButtonElement) void copyBrief(copyBriefButton);
    const copyContextButton = event.target.closest?.('[data-copy-context]');
    if (copyContextButton instanceof HTMLButtonElement && state.selectedNodeId) void copyContext(state.selectedNodeId, copyContextButton);
  });
  // The metric picker lives in the drawer and in the evaluation dialog. The
  // dialog is created per open and is not inside `#node-detail`, so its
  // 全选/清空 button and its checkbox state have to be delegated from document,
  // not from one container: listening on the drawer made the button dead in
  // the dialog and the label stuck on 全选 after every manual tick.
  document.addEventListener('click', (event) => {
    const selectAllMetrics = event.target.closest?.('[data-toggle-all-metrics]');
    if (selectAllMetrics instanceof HTMLButtonElement) toggleAllMetrics(selectAllMetrics);
  });
  document.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.name !== 'metric') return;
    const form = event.target.closest('[data-brief-form]');
    if (form instanceof HTMLFormElement) syncMetricToggle(form);
  });
  $('standards-groups').addEventListener('click', (event) => {
    const repair = event.target.closest?.('[data-repair-check]');
    if (repair instanceof HTMLButtonElement) {
      showRepairTask([repair.dataset.repairCheck]);
      return;
    }
    const button = event.target.closest?.('[data-standard-node]');
    if (button instanceof HTMLButtonElement) openStandardEvidence(button.dataset.standardNode);
  });
  $('standards-repair').addEventListener('click', () => showRepairTask([]));
  // The repair dialog is created per open, so its paste button is delegated.
  document.addEventListener('click', (event) => {
    const paste = event.target.closest?.('[data-paste-intent]');
    if (paste instanceof HTMLButtonElement) void pasteIntoIntent(paste);
  });
  $('close-brief-dialog').addEventListener('click', () => $('brief-dialog').close());
  $('copy-brief-dialog').addEventListener('click', () => void copyText($('brief-dialog-text').textContent, $('copy-brief-dialog'), '复制完整任务'));
  $('save-brief-dialog').addEventListener('click', () => void saveTaskFile());
  $('brief-dialog').addEventListener('click', (event) => {
    const dialog = $('brief-dialog');
    if (event.target === dialog) dialog.close();
  });
  $('graph-tab').addEventListener('click', () => setActiveTab('graph'));
  $('standards-tab').addEventListener('click', () => void showStandards());
  $('audit-tab').addEventListener('click', () => void showAudit());
  $('skill-search').addEventListener('input', () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => void searchSkills().catch((error) => setError(error.message)), 180);
  });
  $('search-body').addEventListener('change', () => void searchSkills().catch((error) => setError(error.message)));
  window.addEventListener('message', (event) => {
    if (event.source !== $('graph-frame').contentWindow) return;
    // Clicking the graph's paper clears the selection in the graph; the drawer
    // has to follow, or it keeps describing a card the canvas no longer marks.
    if (event.data?.type === 'annot-node-cleared') {
      selectNode(null);
      return;
    }
    if (event.data?.type !== 'annot-node-selected') return;
    const node = state.doc?.nodes.find((item) => item.id === event.data.id);
    if (!node) return;
    selectNode(node);
    openNodeDrawer();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('node-drawer').hidden) {
      event.preventDefault();
      closeNodeDrawer();
      return;
    }
    if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      $('skill-search').focus();
    }
  });
}

const initialView = ['report', 'versions'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'library';
state.appView = initialView;
document.body.dataset.appView = initialView;
bindEvents();
void loadLibrary();
if (initialView !== 'library') setAppView(initialView);
