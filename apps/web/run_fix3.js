const fs = require('fs');
const file = 'F:/enterprise-erp/apps/web/src/components/core/ListEngine.tsx';
let txt = fs.readFileSync(file, 'utf8');

const prefix = "ine.tsx\n";
const prefix2 = "ine.tsx\r\n";
const prefix3 = "ine.tsx";

if (txt.startsWith(prefix)) {
  txt = txt.substring(prefix.length);
} else if (txt.startsWith(prefix2)) {
  txt = txt.substring(prefix2.length);
} else if (txt.startsWith(prefix3)) {
  txt = txt.substring(prefix3.length);
  txt = txt.trimStart();
}
fs.writeFileSync(file, txt, 'utf8');
