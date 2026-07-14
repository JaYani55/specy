const fs = require('fs');
let t = fs.readFileSync('wrangler.jsonc', 'utf8');
const lines = t.split(/\r?\n/);
const out = [];
let inVars = false;
let varsDepth = 0;
let lastPropLine = -1;

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const s = l.replace(/\/\/.*$/g, '').trim();

  if (!inVars) {
    if (l.includes('"vars"') && l.includes('{')) {
      inVars = true;
      varsDepth = 1;
    }
    out.push(l);
    continue;
  }

  const ob = (s.match(/{/g) || []).length;
  const cb = (s.match(/}/g) || []).length;
  varsDepth += ob - cb;

  const cm = l.match(/\/\/\s*([\w-]+)\s*$/);
  const isPluginVar = cm && (cm[1] === 'pluradash');

  if (isPluginVar) {
    continue;
  }

  if (s && !s.startsWith('//') && s !== '{' && s !== '}') {
    lastPropLine = out.length;
  }
  out.push(l);

  if (varsDepth <= 0) inVars = false;
}

// Fix trailing comma on last property
if (lastPropLine >= 0) {
  const ll = out[lastPropLine];
  const ls = ll.replace(/\/\/.*$/g, '').trim();
  if (ls && !ls.endsWith(',') && !ls.endsWith('{') && !ls.endsWith('}')) {
    if (/\/\/.*$/.test(ll)) {
      out[lastPropLine] = ll.replace(/(\/\/.*$)/, ',$1');
    } else {
      out[lastPropLine] = ll + ',';
    }
  }
}

fs.writeFileSync('wrangler.jsonc', out.join('\n'));
console.log('Fixed vars section');