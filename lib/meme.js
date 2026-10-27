import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// Resolve only indexed images in enabled dsh-meme libraries. Never treat a
// model-supplied relative path as an arbitrary filesystem path.
export async function resolveMeme(candidate, library = '', options = {}) {
  const home = options.home || os.homedir();
  const requireFromProfile = createRequire(path.join(home, '.dsh', 'profiles', 'desktop', 'package.json'));
  let pkg;
  try { pkg = requireFromProfile.resolve('dsh-meme/package.json'); }
  catch { throw new Error('未找到 dsh-meme，请确认插件已安装'); }
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(path.join(home, '.dsh', 'dsh-expression.json'), 'utf8')); } catch {}
  if (settings.sendMode === 'text') throw new Error('dsh-meme 设置为纯文字，不能发送表情图片');
  const isPack = dir => { try { return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'index.db')); } catch { return false; } };
  const packs = [], ids = new Set();
  const add = (dir, source) => {
    const id = path.basename(dir);
    if (!isPack(dir) || ids.has(id)) return;
    let name = id;
    try { name = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).name || id; } catch {}
    ids.add(id); packs.push({ id, name, path: dir, source });
  };
  const scan = (parent, source) => {
    if (!fs.existsSync(parent)) return;
    add(parent, source);
    for (const name of fs.readdirSync(parent)) {
      const dir = path.join(parent, name);
      if (!isPack(dir)) continue;
      add(dir, source);
      for (const child of fs.readdirSync(dir)) add(path.join(dir, child), source);
    }
  };
  scan(path.join(path.dirname(pkg), 'memes'), 'bundled');
  scan(settings.packsDir || path.join(home, '.dsh', 'meme-packs'), 'user');
  const selected = settings.packId && settings.packId !== '_custom' && packs.find(p => p.id === settings.packId);
  const root = selected?.path || (settings.memeRoot && isPack(settings.memeRoot) ? settings.memeRoot : path.join(path.dirname(pkg), 'memes', 'dafeiyu-001'));
  const active = packs.find(p => path.resolve(p.path) === path.resolve(root));
  const activeId = active?.id || '_custom';
  if (!active) packs.push({ id: activeId, name: activeId, path: root });
  const enabled = Array.isArray(settings.enabledPacks) ? settings.enabledPacks.map(String) : [activeId];
  let raw = String(candidate || '').trim().replaceAll('\\', '/');
  const caption = String(options.caption || '').trim();
  if (!raw && !caption) throw new Error('请提供 send_meme 返回的表情描述或路径');
  if (raw && (path.posix.isAbsolute(raw) || /^[a-z]:/i.test(raw) || raw.split('/').some(x => x === '..' || !x))) throw new Error('表情路径无效，请使用 send_meme 返回的路径');
  const slash = raw.indexOf('/');
  const prefix = slash > 0 ? raw.slice(0, slash) : '';
  const prefixed = packs.find(p => p.id === prefix);
  let choices = packs.filter(p => enabled.includes(p.id));
  if (prefixed) { choices = choices.filter(p => p.id === prefix); raw = raw.slice(slash + 1); }
  else if (library) choices = choices.filter(p => p.id === library || p.name === library);
  const matches = [];
  for (const pack of choices) {
    const db = new DatabaseSync(path.join(pack.path, 'index.db'), { readOnly: true });
    try {
      const rows = raw ? db.prepare('SELECT path FROM memes WHERE path = ?').all(raw)
        : db.prepare("SELECT path FROM memes WHERE substr(coalesce(nullif(caption, ''), file_name, ''), 1, 80) = ?").all(caption);
      for (const row of rows) {
        const file = path.resolve(pack.path, row.path);
        if (!file.startsWith(path.resolve(pack.path) + path.sep)) throw new Error('表情文件超出图库目录');
        const realRoot = fs.realpathSync(pack.path), realFile = fs.realpathSync(file);
        if (!realFile.startsWith(realRoot + path.sep)) throw new Error('表情文件超出图库目录');
        matches.push(realFile);
      }
    } finally { db.close(); }
  }
  if (!matches.length) throw new Error('未在启用的图库中找到该图片，请重新调用 send_meme');
  if (raw && matches.length > 1) throw new Error('多个图库有相同路径，请提供候选中的 library');
  // A stable choice also keeps retries with the same requestId idempotent.
  return matches.sort()[0];
}
