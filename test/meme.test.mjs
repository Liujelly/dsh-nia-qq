import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveMeme } from '../lib/meme.js';
import { Sessions } from '../lib/sessions.js';

test('dsh-meme candidates resolve only indexed files in enabled packs, honoring text mode', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-meme-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const pkg = path.join(home, '.dsh/profiles/desktop/node_modules/dsh-meme');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name:'dsh-meme', exports:{ './package.json':'./package.json' } }));
  const addPack = (parent, id) => {
    const root = path.join(parent,id); fs.mkdirSync(path.join(root,'memes'), { recursive:true });
    fs.writeFileSync(path.join(root,'manifest.json'), JSON.stringify({name:id}));
    fs.writeFileSync(path.join(root,'memes/a.png'), 'image');
    fs.writeFileSync(path.join(root,'memes/unindexed.png'), 'image');
    const db = new DatabaseSync(path.join(root,'index.db'));
    db.exec('CREATE TABLE memes (path TEXT, caption TEXT, file_name TEXT)'); db.prepare('INSERT INTO memes VALUES (?, ?, ?)').run('memes/a.png', '开心', 'a.png'); db.close();
    return root;
  };
  const main = addPack(path.join(pkg,'memes'),'dafeiyu-001');
  addPack(path.join(home,'.dsh/meme-packs'),'other');
  assert.equal(await resolveMeme('memes/a.png','',{home}), fs.realpathSync(path.join(main,'memes/a.png')));
  assert.equal(await resolveMeme('','',{home,caption:'开心'}), fs.realpathSync(path.join(main,'memes/a.png')));
  await assert.rejects(resolveMeme('../secret','',{home}), /路径无效/);
  await assert.rejects(resolveMeme('memes/unindexed.png','',{home}), /未在启用/);
  await assert.rejects(resolveMeme('other/memes/a.png','',{home}), /未在启用/);
  fs.writeFileSync(path.join(home,'.dsh/dsh-expression.json'), JSON.stringify({enabledPacks:['dafeiyu-001','other']}));
  await assert.rejects(resolveMeme('memes/a.png','',{home}), /多个图库/);
  assert.match(await resolveMeme('other/memes/a.png','',{home}), /other/);
  fs.writeFileSync(path.join(home,'.dsh/dsh-expression.json'), JSON.stringify({sendMode:'text'}));
  await assert.rejects(resolveMeme('memes/a.png','',{home}), /纯文字/);
});

test('QQ session exposes scoped meme sender and avoids web-only delivery instruction', () => {
  const tools = new Map(), sections = new Map();
  const register = map => item => { map.set(item.name,item); return () => map.delete(item.name); };
  const agent = {session:{id:'s',header:{}},ctx:{tools:{register:register(tools)},systemPrompt:{section:register(sections)}}};
  const sessions = new Sessions({}, {}, () => ({}));
  sessions.mount(agent, {type:'private',id:'1',account:'2'}, {});
  assert.ok(tools.has('nia_qq_meme'));
  assert.match(sections.get('nia-qq:guidance').text, /send_meme/);
  assert.match(sections.get('nia-qq:guidance').text, /nia_qq_meme/);
});
