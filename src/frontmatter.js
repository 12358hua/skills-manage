// 解析 SKILL.md 的 YAML frontmatter（name / description / metadata）。
// 不做完整 YAML 解析，只覆盖 skill 实际用到的几种形态：
//   name: story
//   description: "..."（可能带引号）
//   description: |- / | / > / >-（多行块标量，WorkBuddy 等 skill 常用）
//   metadata: {"openclaw": {"source": "..."}}
export function parseFrontmatter(content) {
  const result = { name: '', description: '', metadata: null, body: content, frontmatter: {} };
  if (!content) return result;

  const normalized = content.replace(/^﻿/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return result;

  const [, rawFront, body] = match;
  result.body = body;

  const lines = rawFront.split(/\r?\n/);
  const fields = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*([\s\S]*)$/);
    if (!kv) continue;
    const key = kv[1];
    const rest = kv[2];

    // 多行块标量：key: | / |- / > / >-
    if (/^[|>][+-]?$/.test(rest.trim())) {
      const folded = rest.trim().startsWith('>');
      const blockLines = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === '') {
          blockLines.push('');
          j++;
          continue;
        }
        if (/^[ \t]+/.test(l)) {
          blockLines.push(l.replace(/^[ \t]+/, ''));
          j++;
        } else {
          break;
        }
      }
      fields[key] = folded
        ? blockLines.map((s) => s.trim()).filter(Boolean).join(' ')
        : blockLines.join('\n').replace(/\s+$/, '');
      i = j - 1;
    } else {
      fields[key] = rest.trim();
    }
  }

  result.name = fields.name ?? '';
  result.description = stripQuotes(fields.description ?? '');
  result.metadata = parseValue(fields.metadata ?? null);
  result.frontmatter = fields;
  return result;
}

function stripQuotes(v) {
  if (!v) return v;
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') return v.slice(1, -1);
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1);
  return v;
}

// 值可能是 JSON（对象/数组）或普通字符串，尝试解析，失败则原样返回字符串。
function parseValue(v) {
  if (v == null) return null;
  const trimmed = v.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return stripQuotes(trimmed);
}
