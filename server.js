import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, scanAll, findSkill, readSkillMarkdown } from './src/scanner.js';
import { previewGit, installGit, runCommand } from './src/install.js';
import { removeSkill } from './src/remove.js';
import { readCustomAgents, writeCustomAgents } from './src/agents-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let config = loadConfig();
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/vendor/marked.js', (req, res) => {
  const candidates = [
    path.join(__dirname, 'node_modules', 'marked', 'marked.min.js'),
    path.join(__dirname, 'node_modules', 'marked', 'lib', 'marked.umd.js'),
    path.join(__dirname, 'node_modules', 'marked', 'marked.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return res.sendFile(c);
  }
  res.status(404).send('marked not found');
});

// 统一扫描响应体，供列表 / 增删 agent / 安装后共用。
function skillsResponse(cfg) {
  const { agents, skills } = scanAll(cfg);
  const categories = [...new Set(skills.map((s) => s.category))].sort();
  const grouped = {};
  for (const s of skills) (grouped[s.agent] ||= []).push(s);
  return { agents, skills, categories, grouped };
}

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9一-龥]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  );
}
function uniqueKey(label, existing) {
  const base = slugify(label);
  let key = base;
  let n = 2;
  while (existing[key]) key = `${base}-${n++}`;
  return key;
}

app.get('/api/agents', (req, res) => {
  res.json(skillsResponse(config).agents);
});

// 添加自定义 agent（持久化到 custom-agents.json）
app.post('/api/agents', (req, res) => {
  const label = String(req.body?.label || '').trim();
  const agentPath = String(req.body?.path || '').trim();
  if (!label || !agentPath) return res.status(400).json({ error: '名称和路径不能为空' });
  const custom = readCustomAgents();
  const key = uniqueKey(label, { ...config.agents, ...custom });
  custom[key] = { label, path: agentPath };
  if (!writeCustomAgents(custom)) return res.status(500).json({ error: '写入 custom-agents.json 失败' });
  config = loadConfig();
  res.json({ key, ...skillsResponse(config) });
});

// 删除自定义 agent
app.delete('/api/agents/:key', (req, res) => {
  const custom = readCustomAgents();
  if (!custom[req.params.key]) {
    return res.status(404).json({ error: '该 agent 不存在或不是自定义 agent' });
  }
  delete custom[req.params.key];
  writeCustomAgents(custom);
  config = loadConfig();
  res.json(skillsResponse(config));
});

app.get('/api/skills', (req, res) => {
  res.json(skillsResponse(config));
});

app.get('/api/skills/:agent/:name', (req, res) => {
  const { skills } = scanAll(config);
  const skill = findSkill(skills, req.params.agent, req.params.name);
  if (!skill) return res.status(404).json({ error: 'skill 不存在' });
  const detail = readSkillMarkdown(skill);
  res.json({ ...skill, ...detail });
});

app.post('/api/skills/install/preview', async (req, res) => {
  try {
    const result = await previewGit(req.body?.repo);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/skills/install', async (req, res) => {
  const { mode, token, selected, targets, command } = req.body || {};
  try {
    if (mode === 'command') {
      const result = await runCommand(command);
      if (result.ok) Object.assign(result, skillsResponse(config));
      return res.json(result);
    }
    const result = await installGit({ token, selected, targets, config });
    if (result.error) return res.status(400).json(result);
    return res.json({ ...result, ...skillsResponse(config) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete('/api/skills/:agent/:name', (req, res) => {
  const { skills } = scanAll(config);
  const skill = findSkill(skills, req.params.agent, req.params.name);
  if (!skill) return res.status(404).json({ error: 'skill 不存在' });
  const result = removeSkill(skill, { deleteShared: Boolean(req.body?.deleteShared) });
  res.json({ ...result, skill });
});

const port = Number(process.env.PORT) || config.port || 3456;
app.listen(port, () => {
  console.log(`\n  skills 管理工具已启动:  http://localhost:${port}\n`);
});
