// Names a module uses but never declares, imports or defines (scopes ignored: a name declared anywhere counts):
// what a rebuilt file still needs to import. Usage: node freevars.mjs FILE...
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const acorn = require('acorn');
const GLOBALS = new Set(Object.getOwnPropertyNames(globalThis).concat(['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'HTMLInputElement', 'HTMLCanvasElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Image', 'ImageData', 'OffscreenCanvas', 'createImageBitmap', 'ImageBitmap', 'Blob', 'File', 'FileReader', 'URL', 'URLSearchParams', 'WebSocket', 'Worker', 'self', 'getComputedStyle', 'matchMedia', 'devicePixelRatio', 'screen', 'history', 'alert', 'confirm', 'prompt', 'fetch', 'Response', 'Request', 'Headers', 'AbortController', 'AbortSignal', 'Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'TouchEvent', 'DOMParser', 'XMLSerializer', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'AudioContext', 'MediaStream', 'RTCPeerConnection', 'RTCSessionDescription', 'RTCIceCandidate', 'indexedDB', 'crypto', 'caches', 'TextEncoder', 'TextDecoder', 'process', 'Buffer', 'console', 'structuredClone', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'arguments', 'undefined', 'NaN', 'Infinity', 'globalThis', 'import', 'webkitAudioContext', 'speechSynthesis', 'Notification', 'visualViewport', 'innerWidth', 'innerHeight', 'scrollX', 'scrollY', 'GPUBufferUsage', 'WebGL2RenderingContext', 'WebGLRenderingContext']));
for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, 'utf8');
  let ast; try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); } catch (e) { console.log(file, 'PARSE ERROR', e.message); continue; }
  const declared = new Set(); const used = new Map();
  const pat = (p) => { if (!p) return; if (p.type === 'Identifier') declared.add(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach((q) => pat(q.type === 'RestElement' ? q.argument : q.value)); else if (p.type === 'ArrayPattern') p.elements.forEach(pat); else if (p.type === 'AssignmentPattern') pat(p.left); else if (p.type === 'RestElement') pat(p.argument); };
  const walk = (n, parent, key) => {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': declared.add(n.local.name); return;
      case 'VariableDeclarator': pat(n.id); break;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': if (n.id) declared.add(n.id.name); n.params.forEach(pat); break;
      case 'ClassDeclaration': case 'ClassExpression': if (n.id) declared.add(n.id.name); break;
      case 'CatchClause': pat(n.param); break;
      case 'Identifier': {
        if (parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) || (parent.type === 'Property' && key === 'key' && !parent.computed) || (parent.type === 'MethodDefinition' && key === 'key') || (parent.type === 'PropertyDefinition' && key === 'key') || parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement' || parent.type === 'ExportSpecifier')) return;
        if (!used.has(n.name)) used.set(n.name, n.start);
        return;
      }
    }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach((c) => walk(c, n, k)); else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, n, k); }
  };
  walk(ast, null, null);
  const free = [...used.keys()].filter((x) => !declared.has(x) && !GLOBALS.has(x));
  const line = (pos) => src.slice(0, pos).split('\n').length;
  console.log(file.split('/').pop(), free.length ? free.map((x) => `${x}@${line(used.get(x))}`).join(' ') : 'ok');
}
