// Skills 管理 — 前端逻辑
const state = {
  agents: [],
  skills: [],
  categories: [],
  grouped: {},
  agentFilter: 'all',
  categoryFilter: 'all',
  searchQuery: '',
  // 安装流程
  installMode: 'git',
  previewToken: null,
  previewCandidates: [],
  selectedSkills: new Set(),
  selectedTargets: new Set(),
  // 删除目标
  deleteTarget: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

// ---------- 加载与渲染 ----------
async function loadSkills() {
  setStatus('扫描中…');
  try {
    const data = await api('/api/skills');
    applySkillsResponse(data);
    setStatus(`共 ${data.skills.length} 个 skill`);
  } catch (e) {
    setStatus(`加载失败：${e.message}`, true);
  }
}

// 用统一的扫描响应更新状态并重渲染（供加载 / 增删 agent / 安装后共用）。
function applySkillsResponse(data) {
  if (!data) return;
  Object.assign(state, {
    agents: data.agents || [],
    skills: data.skills || [],
    categories: data.categories || [],
    grouped: data.grouped || {},
  });
  renderTabs();
  renderChips();
  renderGrid();
}

function setStatus(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function showModalError(id, msg) {
  const el = $(`#${id}`);
  el.textContent = msg;
  el.hidden = false;
}
function hideModalError(id) {
  const el = $(`#${id}`);
  el.hidden = true;
}
function showModalSuccess(id, msg) {
  const el = $(`#${id}`);
  el.textContent = msg;
  el.hidden = false;
}
function hideModalSuccess(id) {
  const el = $(`#${id}`);
  el.hidden = true;
}

function agentLabel(key) {
  const a = state.agents.find((x) => x.key === key);
  return a ? a.label : key;
}

function renderTabs() {
  const el = $('#agent-tabs');
  const present = new Set(
    state.agents.filter((a) => a.present).map((a) => a.key)
  );
  const tabs = [{ key: 'all', label: '全部', custom: false }, ...state.agents];
  el.innerHTML = tabs
    .map((t) => {
      const key = t.key;
      const count = key === 'all' ? state.skills.length : (state.grouped[key] || []).length;
      const active = state.agentFilter === key ? 'active' : '';
      const muted = key !== 'all' && !present.has(key) ? ' (未检测到)' : '';
      const remove = t.custom
        ? `<span class="tab-remove" data-remove="${key}" title="移除该 agent">✕</span>`
        : '';
      return `<div class="tab ${active}" data-agent="${key}" role="button"><span class="tab-label">${escapeHtml(t.label)}${muted}</span><span class="count">${count}</span>${remove}</div>`;
    })
    .join('');
  el.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', (e) => {
      if (e.target.closest('.tab-remove')) return;
      state.agentFilter = b.dataset.agent;
      renderTabs();
      renderGrid();
    })
  );
  el.querySelectorAll('.tab-remove').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      removeAgent(b.dataset.remove);
    })
  );
}

function renderChips() {
  const el = $('#category-chips');
  const cats = ['all', ...state.categories];
  el.innerHTML = cats
    .map((c) => {
      const label = c === 'all' ? '全部类别' : c;
      const active = state.categoryFilter === c ? 'active' : '';
      return `<button class="chip ${active}" data-cat="${c}">${label}</button>`;
    })
    .join('');
  el.querySelectorAll('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      state.categoryFilter = b.dataset.cat;
      renderChips();
      renderGrid();
    })
  );
}

// q 是否为 str 的子序列（字符按顺序出现，可跳字），用于「slw → story-long-write」这类模糊匹配。
function isSubsequence(q, str) {
  let i = 0;
  for (let j = 0; j < str.length && i < q.length; j++) {
    if (str[j] === q[i]) i++;
  }
  return i === q.length;
}

// 模糊打分：名称子串 > 名称子序列 > 描述 > 分类。返回 0 表示不匹配。
function fuzzyScore(query, skill) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const name = skill.name.toLowerCase();
  const desc = (skill.description || '').toLowerCase();
  const cat = (skill.category || '').toLowerCase();
  if (name.includes(q)) return 100;
  if (isSubsequence(q, name)) return 80;
  if (desc.includes(q)) return 50;
  if (cat.includes(q)) return 40;
  return 0;
}

function visibleSkills() {
  return state.skills
    .filter((s) => {
      if (state.agentFilter !== 'all' && s.agent !== state.agentFilter) return false;
      if (state.categoryFilter !== 'all' && s.category !== state.categoryFilter) return false;
      return true;
    })
    .map((s) => ({ s, score: fuzzyScore(state.searchQuery, s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
    .map((x) => x.s);
}

function renderGrid() {
  const grid = $('#grid');
  const list = visibleSkills();
  const empty = $('#empty');
  empty.hidden = list.length !== 0;
  empty.textContent = state.searchQuery
    ? `没有匹配「${state.searchQuery}」的 skill`
    : '没有找到 skill。';

  grid.innerHTML = list
    .map((s) => {
      const linkBadge = s.isSymlink
        ? `<span class="badge link" title="软链接 → ${escapeHtml(s.realPath)}">软链接</span>`
        : '';
      return `
      <div class="card">
        <div class="card-head">
          <span class="card-name">${escapeHtml(s.name)}</span>
          <span class="badge agent">${escapeHtml(s.agentLabel || s.agent)}</span>
        </div>
        <div class="badges">
          <span class="badge">${escapeHtml(s.category)}</span>
          ${linkBadge}
        </div>
        <div class="card-desc">${escapeHtml(s.description || '（无描述）')}</div>
        <div class="card-foot">
          <button class="btn btn-primary" data-action="view" data-agent="${s.agent}" data-name="${escapeHtml(s.name)}">查看用法</button>
          <button class="btn btn-danger" data-action="delete" data-agent="${s.agent}" data-name="${escapeHtml(s.name)}">删除</button>
        </div>
      </div>`;
    })
    .join('');

  grid.querySelectorAll('[data-action="view"]').forEach((b) =>
    b.addEventListener('click', () => viewSkill(b.dataset.agent, b.dataset.name))
  );
  grid.querySelectorAll('[data-action="delete"]').forEach((b) =>
    b.addEventListener('click', () => openDelete(b.dataset.agent, b.dataset.name))
  );
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- 查看用法 ----------
async function viewSkill(agent, name) {
  try {
    const d = await api(`/api/skills/${encodeURIComponent(agent)}/${encodeURIComponent(name)}`);
    $('#detail-name').textContent = d.name;
    const badges = [
      `<span class="badge agent">${escapeHtml(d.agentLabel || d.agent)}</span>`,
      `<span class="badge">${escapeHtml(d.category)}</span>`,
      d.isSymlink ? `<span class="badge link">软链接 → ${escapeHtml(d.realPath)}</span>` : '',
      d.sourceUrl ? `<span class="badge">来源：${escapeHtml(d.sourceUrl)}</span>` : '',
    ];
    $('#detail-meta').innerHTML = badges.join('');
    const body = $('#detail-body');
    const md = d.markdown || d.description || '（无正文）';
    body.innerHTML = renderMarkdown(md);
    openOverlay('modal-detail');
  } catch (e) {
    alert(`加载失败：${e.message}`);
  }
}

function renderMarkdown(md) {
  if (typeof marked !== 'undefined') {
    try {
      return marked.parse(md);
    } catch {}
  }
  return `<pre>${escapeHtml(md)}</pre>`;
}

// ---------- 删除 ----------
function openDelete(agent, name) {
  const s = state.skills.find((x) => x.agent === agent && x.name === name);
  if (!s) return;
  state.deleteTarget = s;
  $('#delete-text').textContent = `确定删除「${s.name}」？\n路径：${s.path}`;
  $('#delete-shared-wrap').hidden = !s.isSymlink;
  $('#delete-shared').checked = false;
  openOverlay('modal-delete');
}

async function confirmDelete() {
  const s = state.deleteTarget;
  if (!s) return;
  const deleteShared = $('#delete-shared').checked;
  try {
    const r = await api(`/api/skills/${encodeURIComponent(s.agent)}/${encodeURIComponent(s.name)}`, {
      method: 'DELETE',
      body: JSON.stringify({ deleteShared }),
    });
    closeOverlay('modal-delete');
    setStatus(`已删除 ${s.name}${r.errors?.length ? '（有部分错误）' : ''}`);
    await loadSkills();
  } catch (e) {
    alert(`删除失败：${e.message}`);
  }
}

// ---------- 自定义 agent ----------
function openAgentModal() {
  $('#agent-label').value = '';
  $('#agent-path').value = '';
  hideModalError('agent-error');
  openOverlay('modal-agent');
  $('#agent-label').focus();
}

async function addAgent() {
  const label = $('#agent-label').value.trim();
  const p = $('#agent-path').value.trim();
  if (!label || !p) return showModalError('agent-error', '请填写名称和路径');
  hideModalError('agent-error');
  try {
    const r = await api('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ label, path: p }),
    });
    closeOverlay('modal-agent');
    applySkillsResponse(r);
    setStatus(`已添加 agent「${r.key}」`);
  } catch (e) {
    showModalError('agent-error', `添加失败：${e.message}`);
  }
}

async function removeAgent(key) {
  if (!confirm(`确定移除 agent「${key}」？（不会删除磁盘上的文件）`)) return;
  try {
    const r = await api(`/api/agents/${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (state.agentFilter === key) state.agentFilter = 'all';
    applySkillsResponse(r);
    setStatus(`已移除 agent「${key}」`);
  } catch (e) {
    alert(`移除失败：${e.message}`);
  }
}

// ---------- 安装 ----------
function openInstall() {
  state.installMode = 'git';
  state.previewToken = null;
  state.previewCandidates = [];
  state.selectedSkills = new Set();
  state.selectedTargets = new Set();
  $('#in-repo').value = '';
  $('#in-command').value = '';
  $('#preview-area').hidden = true;
  $('#command-output').hidden = true;
  hideModalError('git-error');
  hideModalError('command-error');
  hideModalSuccess('git-success');
  hideModalSuccess('command-success');
  setInstallMode('git');
  openOverlay('modal-install');
}

function setInstallMode(mode) {
  state.installMode = mode;
  $('#pane-git').hidden = mode !== 'git';
  $('#pane-command').hidden = mode !== 'command';
  $$('#modal-install .seg-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
}

async function previewRepo() {
  const repo = $('#in-repo').value.trim();
  if (!repo) return showModalError('git-error', '请输入仓库地址');
  hideModalError('git-error');
  $('#preview-area').hidden = true;
  setStatus('正在克隆并扫描仓库…');
  try {
    const r = await api('/api/skills/install/preview', {
      method: 'POST',
      body: JSON.stringify({ repo }),
    });
    if (r.error) throw new Error(r.error);
    state.previewToken = r.token;
    state.previewCandidates = r.candidates || [];
    state.selectedSkills = new Set(state.previewCandidates.map((c) => c.name));
    renderPreview();
    setStatus(`发现 ${state.previewCandidates.length} 个 skill`);
  } catch (e) {
    showModalError('git-error', `扫描失败：${e.message}`);
    setStatus('预览失败', true);
  }
}

function renderPreview() {
  const area = $('#preview-area');
  area.hidden = false;
  const agents = state.agents.filter((a) => a.present);
  const cands = state.previewCandidates;

  if (state.selectedTargets.size === 0) {
    // 默认勾选所有「已检测到」的 agent
    agents.forEach((a) => state.selectedTargets.add(a.key));
  }

  area.innerHTML = `
    <p class="field-label">选择要安装的 skill：</p>
    <div class="preview-list">
      ${cands
        .map(
          (c) => `
        <label class="preview-item">
          <input type="checkbox" data-skill="${escapeHtml(c.name)}" ${state.selectedSkills.has(c.name) ? 'checked' : ''} />
          <span>
            <span class="name">${escapeHtml(c.name)}</span>
            <div class="desc">${escapeHtml(c.description || '')}</div>
          </span>
        </label>`
        )
        .join('')}
    </div>
    <p class="field-label">安装到：</p>
    <div class="agent-picks">
      ${state.agents
        .map(
          (a) => `
        <button class="agent-pick ${state.selectedTargets.has(a.key) ? 'active' : ''}" data-target="${a.key}" ${a.present ? '' : 'disabled'}>
          ${escapeHtml(a.label)}${a.present ? '' : ' (未检测到)'}
        </button>`
        )
        .join('')}
    </div>
    <button id="btn-confirm-install" class="btn btn-primary">确认安装</button>
  `;

  area.querySelectorAll('[data-skill]').forEach((cb) =>
    cb.addEventListener('change', () => {
      const n = cb.dataset.skill;
      cb.checked ? state.selectedSkills.add(n) : state.selectedSkills.delete(n);
    })
  );
  area.querySelectorAll('.agent-pick').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.target;
      if (state.selectedTargets.has(k)) state.selectedTargets.delete(k);
      else state.selectedTargets.add(k);
      renderPreview();
    })
  );
  $('#btn-confirm-install').addEventListener('click', confirmInstall);
}

async function confirmInstall() {
  const selected = [...state.selectedSkills];
  const targets = [...state.selectedTargets];
  if (selected.length === 0) return showModalError('git-error', '请至少选择一个 skill');
  if (targets.length === 0) return showModalError('git-error', '请至少选择一个安装目标');
  hideModalError('git-error');
  setStatus('安装中…');
  try {
    const r = await api('/api/skills/install', {
      method: 'POST',
      body: JSON.stringify({ mode: 'git', token: state.previewToken, selected, targets }),
    });
    if (r.error) throw new Error(r.error);
    const installed = (r.installed || []).map((i) => i.name).join(', ');
    $('#preview-area').hidden = true;
    showModalSuccess('git-success', `✓ 安装成功：${installed || '无'}`);
    setStatus(`已安装：${installed || '无'}`);
    await loadSkills();
  } catch (e) {
    showModalError('git-error', `安装失败：${e.message}`);
    setStatus('安装失败', true);
  }
}

async function runCommandInstall() {
  const command = $('#in-command').value.trim();
  if (!command) return showModalError('command-error', '请输入命令');
  hideModalError('command-error');
  setStatus('执行命令中…');
  const out = $('#command-output');
  out.hidden = false;
  out.textContent = '…';
  try {
    const r = await api('/api/skills/install', {
      method: 'POST',
      body: JSON.stringify({ mode: 'command', command }),
    });
    const execNote = r.executedCommand && r.executedCommand !== command ? `实际执行: ${r.executedCommand}\n\n` : '';
    out.textContent = execNote + ([r.stdout, r.stderr].filter(Boolean).join('\n') || `退出码 ${r.code}`);
    if (r.ok) {
      hideModalError('command-error');
      showModalSuccess('command-success', '✓ 命令执行成功，已重新扫描');
      setStatus('命令执行成功，已重新扫描');
      await loadSkills();
    } else {
      showModalError('command-error', `命令执行失败：${r.error || `退出码 ${r.code}`}`);
      setStatus('命令执行失败', true);
    }
  } catch (e) {
    out.textContent = String(e.message);
    showModalError('command-error', `执行失败：${e.message}`);
    setStatus('执行失败', true);
  }
}

// ---------- 弹窗通用 ----------
function openOverlay(id) {
  $(`#${id}`).hidden = false;
}
function closeOverlay(id) {
  $(`#${id}`).hidden = true;
}

// ---------- 事件绑定 ----------
$('#btn-refresh').addEventListener('click', loadSkills);
$('#btn-install').addEventListener('click', openInstall);
$('#btn-add-agent').addEventListener('click', openAgentModal);
$('#btn-agent-confirm').addEventListener('click', addAgent);
$('#btn-delete-confirm').addEventListener('click', confirmDelete);
$('#btn-preview').addEventListener('click', previewRepo);
$('#btn-run-command').addEventListener('click', runCommandInstall);

$('#search-input').addEventListener('input', (e) => {
  state.searchQuery = e.target.value.trim();
  $('#search-clear').hidden = state.searchQuery === '';
  renderGrid();
});
$('#search-clear').addEventListener('click', () => {
  state.searchQuery = '';
  $('#search-input').value = '';
  $('#search-clear').hidden = true;
  renderGrid();
  $('#search-input').focus();
});

$$('#modal-install .seg-btn').forEach((b) =>
  b.addEventListener('click', () => setInstallMode(b.dataset.mode))
);

$$('[data-close]').forEach((b) =>
  b.addEventListener('click', () => closeOverlay(b.dataset.close))
);

loadSkills();
