const fs = require('fs');
const filePath = 'F:/enterprise-erp/apps/web/src/components/core/DynamicView.tsx';
let content = fs.readFileSync(filePath, 'utf-8');

// Use precise match to replace that trailing block
const oldStr = /          <\/aside>\s+<\/div>\s+\) : null\}/;
if (oldStr.test(content)) {
  content = content.replace(oldStr, '          </aside>\n        </div>\n      </Sheet>');
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('Fixed ending');
} else {
  console.log('Not found');
}
