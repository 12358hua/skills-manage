import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { parseFrontmatter } from './frontmatter.js';
import { readLock, writeLock, setLockEntry } from './lockfile.js';
import { primaryDirForAgent } from './scanner.js';

// 内存中暂存 git 预览克隆，供「预览 → 确认安装」两步使用。
const pending = new Map();

function normalizeRepo(input) {
  let repo = String(input || '').trim();
  if (!repo) return null;
  repo = repo.replace(/\/+$/, ''); // 去掉末尾斜杠

  // SSH 形式：git@github.com:owner/repo.git
  if (/^git@github\.com:/.test(repo)) return repo;

  // GitHub 网页地址 → 克隆地址。
  // 支持 https://github.com/owner/repo[/tree|blob/<branch>/<path>]
  const gh = repo.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)/);
  if (gh) {
    const owner = gh[1];
    const name = gh[2].replace(/\.git$/, '');
    return `https://github.com/${owner}/${name}.git`;
  }

  // 其他 https 地址：保持原样（git 能处理常规 .git 地址）
  if (/^https?:\/\//.test(repo)) return repo;

  // owner/repo
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) return `https://github.com/${repo}.git`;

  return repo;
}

// 递归找 SKILL.md，返回每个 skill 的目录（相对 repo 根）。跳过 .git / node_modules，深度上限 4。
function findSkillDirs(root, maxDepth = 4) {
  const results = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasSkillMd = entries.some((e) => e.isFile() && e.name === 'SKILL.md');
    if (hasSkillMd && dir !== root) {
      results.push(dir);
      return; // 已是一个 skill 目录，不再深入
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === '.git' || e.name === 'node_modules') continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  }
  // 根目录自身也含 SKILL.md 时单独处理
  try {
    if (fs.existsSync(path.join(root, 'SKILL.md'))) results.push(root);
  } catch {}
  walk(root, 0);
  return results;
}

// 预览：克隆到临时目录并扫描候选 skill。
export async function previewGit(repoInput) {
  const repo = normalizeRepo(repoInput);
  if (!repo) return { error: '无效的仓库地址' };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-install-'));
  try {
    await runGit(['clone', '--depth', '1', repo, tmp]);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return { error: `克隆失败: ${e.message || e}` };
  }

  const dirs = findSkillDirs(tmp);
  const candidates = dirs.map((dir) => {
    let name = path.basename(dir);
    let description = '';
    try {
      const fm = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
      name = fm.name || name;
      description = fm.description || '';
    } catch {}
    return { name, description, relDir: path.relative(tmp, dir) };
  });

  const token = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  pending.set(token, { root: tmp, repo, candidates });

  return { token, repo, candidates };
}

// 确认安装：把选中的 skill 目录复制到目标 agent 的 skills 目录。
export async function installGit({ token, selected = [], targets = [], config }) {
  const p = pending.get(token);
  if (!p) return { error: '预览已过期，请重新输入仓库地址' };

  if (!Array.isArray(selected) || selected.length === 0) {
    return { error: '未选择要安装的 skill' };
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    return { error: '未选择安装到的 agent' };
  }

  const installed = [];
  const lock = readLock();
  const byName = new Map(p.candidates.map((c) => [c.name, c]));

  for (const name of selected) {
    const cand = byName.get(name);
    if (!cand) continue;
    const srcDir = path.join(p.root, cand.relDir);

    for (const agent of targets) {
      const destBase = primaryDirForAgent(agent, config);
      const destDir = path.join(destBase, cand.name);
      try {
        fs.mkdirSync(destBase, { recursive: true });
        fs.rmSync(destDir, { recursive: true, force: true });
        fs.cpSync(srcDir, destDir, {
          recursive: true,
          filter: (src) => !path.basename(src).startsWith('.git'),
        });
        installed.push({ name: cand.name, agent, path: destDir });
      } catch (e) {
        installed.push({ name: cand.name, agent, path: destDir, error: String(e.message || e) });
      }
    }

    setLockEntry(lock, cand.name, {
      source: p.repo.replace(/\.git$/, '').replace(/^https:\/\/github\.com\//, ''),
      sourceType: 'github',
      sourceUrl: p.repo,
      skillPath: cand.relDir === '.' ? 'SKILL.md' : `${cand.relDir}/SKILL.md`,
      installedAt: new Date().toISOString(),
    });
  }

  writeLock(lock);
  pending.delete(token);
  fs.rmSync(p.root, { recursive: true, force: true });
  return { installed };
}

// 去掉颜色 / 光标 / 清屏等 ANSI 控制序列，让输出干净可读。
function stripAnsi(s) {
  return String(s)
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '');
}

// 从输出里挑一句最关键的报错行（fatal > error > failed）。
function extractErrorSummary(out, err) {
  const lines = (err || out)
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[│└├■◒◐◓◑─\s]+/, ''))
    .filter(Boolean);
  const pick = (re) => lines.filter((l) => re.test(l)).pop();
  return pick(/fatal:/i) || pick(/error:/i) || pick(/failed/i) || null;
}

// 让已知的交互式安装命令自动变为非交互（补 --yes）。
// 例如 `npx skills add eze-is/web-access` → `npx --yes skills add eze-is/web-access --yes`
function augmentCommand(cmd) {
  const c = String(cmd || '').trim();
  if (!c) return cmd;
  const m = c.match(/^npx(\s+--yes|\s+-y)?\s+skills\s+add\s+(\S+)\s*(.*)$/i);
  if (!m) return cmd;
  const npxHasYes = Boolean(m[1]);
  const name = m[2];
  const rest = (m[3] || '').trim();
  const skillsHasYes = /(?:^|\s)(--yes|-y)(?:\s|$)/.test(rest);
  const parts = ['npx'];
  if (!npxHasYes) parts.push('--yes');
  parts.push('skills', 'add', name);
  if (rest) parts.push(rest);
  if (!skillsHasYes) parts.push('--yes');
  return parts.join(' ');
}

// 检测输出里是否出现交互式选择界面（工具在网页后台无 TTY，无法驱动）。
const INTERACTIVE_MARKERS = /(which agents|move, space select|space select|enter confirm|↑↓|arrow keys)/i;

// 自定义 shell 命令安装：执行后返回清洗过的输出，由调用方重新扫描。
export function runCommand(command) {
  return new Promise((resolve) => {
    const actual = augmentCommand(command);
    const child = spawn(actual, { shell: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: '命令执行超时（120s）已终止', stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), executedCommand: actual });
    }, 120000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(e.message || e), stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), executedCommand: actual });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = stripAnsi(stdout);
      const err = stripAnsi(stderr);
      const interactive = INTERACTIVE_MARKERS.test(out + err);
      let error = code === 0 ? null : extractErrorSummary(out, err) || `退出码 ${code}`;
      if (code !== 0 && interactive) {
        error = '命令是交互式界面，工具无法在网页中驱动。请加 --yes 参数，或用「Git 仓库地址」安装。';
      }
      resolve({ ok: code === 0, code, stdout: out, stderr: err, error, interactive, executedCommand: actual });
    });
  });
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message));
      else resolve(stdout);
    });
  });
}
