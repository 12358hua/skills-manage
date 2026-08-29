import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { categorize } from './categorize.js';
import { readLock, getLockEntry } from './lockfile.js';
import { readCustomAgents } from './agents-store.js';

const home = os.homedir();

// 把 config 里的 "~/x" / "<cwd>/x" 展开成绝对路径。
function expandDir(dir, cwd) {
  if (dir.startsWith('~/')) return path.join(home, dir.slice(2));
  if (dir.startsWith('<cwd>')) return path.join(cwd, dir.slice(5).replace(/^[/\\]/, ''));
  return dir;
}

// 读取 config.json（可选），失败则用内置默认。
export function loadConfig() {
  const defaultConfig = {
    port: 3456,
    agents: {
      'claude-code': { label: 'Claude Code', dirs: ['~/.claude/skills', '<cwd>/.claude/skills'] },
      codex: { label: 'Codex', dirs: ['~/.codex/skills', '~/.codex'] },
      workbuddy: { label: 'WorkBuddy', dirs: ['~/.workbuddy/skills'] },
    },
    categories: [],
  };
  let config = { ...defaultConfig, agents: { ...defaultConfig.agents } };
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf8');
    const user = JSON.parse(raw);
    config = {
      ...defaultConfig,
      ...user,
      agents: { ...defaultConfig.agents, ...(user.agents || {}) },
      categories: user.categories || defaultConfig.categories,
    };
  } catch {
    config = { ...defaultConfig, agents: { ...defaultConfig.agents } };
  }

  // 合并界面添加的自定义 agent（持久化在 custom-agents.json）
  const custom = readCustomAgents();
  for (const [key, c] of Object.entries(custom)) {
    if (!config.agents[key]) {
      config.agents[key] = { label: c.label || key, dirs: [c.path], custom: true };
    }
  }
  return config;
}

// 返回所有 agent 的探测结果：每个 agent 的 dirs 是否存在。
export function detectAgents(config) {
  const cwd = process.cwd();
  const result = [];
  for (const [key, def] of Object.entries(config.agents)) {
    const dirs = (def.dirs || []).map((d) => expandDir(d, cwd));
    const existing = dirs.filter((d) => fs.existsSync(d));
    result.push({
      key,
      label: def.label || key,
      dirs,
      detected: existing,
      present: existing.length > 0,
      custom: Boolean(def.custom),
    });
  }
  return result;
}

// 某个 agent 的「主安装目录」= 其第一个候选目录（展开后，不存在则创建）。
export function primaryDirForAgent(agentKey, config) {
  const def = config.agents?.[agentKey];
  if (def && Array.isArray(def.dirs) && def.dirs.length) {
    return expandDir(def.dirs[0], process.cwd());
  }
  return path.join(home, '.claude', 'skills');
}

// 扫描某个目录下的所有 skill（子目录含 SKILL.md）。
function scanDir(dir, agentKey, lock) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = [];
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    let isSymlink = false;
    try {
      isSymlink = ent.isSymbolicLink();
    } catch {
      /* ignore */
    }

    const skillMd = path.join(full, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    let body = '';
    try {
      body = fs.readFileSync(skillMd, 'utf8');
    } catch {
      /* ignore */
    }

    const fm = parseFrontmatter(body);
    const name = fm.name || ent.name;
    let realPath = full;
    if (isSymlink) {
      try {
        realPath = fs.realpathSync(full);
      } catch {
        realPath = full;
      }
    }

    const lockEntry = getLockEntry(lock, name);
    const skill = {
      id: `${agentKey}:${name}`,
      name,
      agent: agentKey,
      description: fm.description || '',
      path: full,
      realPath,
      isSymlink,
      category: null,
      source: lockEntry?.source || lockEntry?.sourceUrl || null,
      sourceUrl: lockEntry?.sourceUrl || null,
    };
    skills.push(skill);
  }

  return skills;
}

// 全量扫描：返回 { agents, skills }。skills 已按 agent 分组、带分类。
export function scanAll(config) {
  const agents = detectAgents(config);
  const lock = readLock();
  const skills = [];

  for (const agent of agents) {
    for (const dir of agent.detected) {
      const found = scanDir(dir, agent.key, lock);
      for (const s of found) {
        s.agentLabel = agent.label;
        s.category = categorize(s.name, s.description, config.categories);
        skills.push(s);
      }
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { agents, skills };
}

// 读取单个 skill 的完整 SKILL.md 正文（用于查看用法）。
export function readSkillMarkdown(skill) {
  if (!skill) return { name: '', description: '', markdown: '' };
  const skillMd = path.join(skill.path, 'SKILL.md');
  try {
    const raw = fs.readFileSync(skillMd, 'utf8');
    const fm = parseFrontmatter(raw);
    return { name: fm.name || skill.name, description: fm.description, markdown: fm.body || raw, metadata: fm.metadata };
  } catch (e) {
    return { name: skill.name, description: skill.description, markdown: '', error: String(e.message || e) };
  }
}

// 在扫描结果中按 agent + name 查找。
export function findSkill(skills, agent, name) {
  return skills.find((s) => s.agent === agent && s.name === name);
}
