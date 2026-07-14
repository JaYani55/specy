const fs = require('fs');
let t = fs.readFileSync('wrangler.jsonc', 'utf8');

// Fix the vars section: remove extra blank lines between R2_PUBLIC_URL and AI_GATEWAY_BASE_URL
// and fix indentation of AI_GATEWAY_BASE_URL
t = t.replace(
  /"R2_PUBLIC_URL":\s+"",\s*\n\s*\n\s*\n"AI_GATEWAY_BASE_URL"/,
  '"R2_PUBLIC_URL":    "",\n    "AI_GATEWAY_BASE_URL"'
);

fs.writeFileSync('wrangler.jsonc', t);
console.log('Fixed vars section');