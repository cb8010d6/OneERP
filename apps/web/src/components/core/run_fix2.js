const fs = require('fs');
const file = 'F:/enterprise-erp/apps/web/src/components/core/ListEngine.tsx';
let txt = fs.readFileSync(file, 'utf8');

if (txt.startsWith('ine.tsx\n')) {
  txt = txt.substring('ine.tsx\n'.length);
}
if (txt.startsWith('ine.tsx\r\n')) {
  txt = txt.substring('ine.tsx\r\n'.length);
}
fs.writeFileSync(file, txt, 'utf8');
