import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => readFileSync(resolve(root, p), 'utf8');

const template = read('src/template.html');
const css = read('src/style.css');
let js = read('src/game.js');
const net = read('src/net.js');
const peer = read('src/peerjs.min.js');

if (!template.includes('/*__STYLE__*/') || !template.includes('/*__GAME__*/') || !template.includes('/*__PEER__*/')) {
  throw new Error('template.html is missing a style/game/peer placeholder');
}
if (!js.includes('/*__NET__*/')) {
  throw new Error('game.js is missing /*__NET__*/ placeholder');
}

js = js.replace('/*__NET__*/', () => net);
const html = template
  .replace('/*__STYLE__*/', () => css)
  .replace('/*__PEER__*/', () => peer)
  .replace('/*__GAME__*/', () => js);

const out = resolve(root, 'index.html');
writeFileSync(out, html, 'utf8');
const kb = (statSync(out).size / 1024).toFixed(1);
console.log(`built index.html (${kb} KB)`);
