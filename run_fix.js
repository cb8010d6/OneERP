const fs = require('fs');
const filePath = 'F:/enterprise-erp/apps/web/src/components/core/DynamicView.tsx';
let content = fs.readFileSync(filePath, 'utf-8');

if (!content.includes('import { Sheet }')) {
  content = content.replace("import { FormEngine } from './FormEngine';", "import { FormEngine } from './FormEngine';\nimport { Sheet } from '../ui/Sheet';");
}

content = content.replace("type ViewMode = 'list' | 'kanban' | 'form';", "type ViewMode = 'list' | 'kanban';");

if (!content.includes('const [isFormOpen, setIsFormOpen]')) {
  content = content.replace("const [mode, setMode] = useState<ViewMode>('list');", "const [mode, setMode] = useState<ViewMode>('list');\n  const [isFormOpen, setIsFormOpen] = useState(false);");
}

content = content.replace(
  /onRowClick=\{\(row\) => \{\s*setSelected\(row\);\s*setMode\('form'\);\s*\}\}/g,
  `onRowClick={(row) => {\n            setSelected(row);\n            setIsFormOpen(true);\n          }}`
);

content = content.replace(/onCardClick=\{setSelected\}/g, `onCardClick={(row) => { setSelected(row); setIsFormOpen(true); }}`);

content = content.replace(
  /<ViewButton\s+icon=\{<SquarePen className="h-4 w-4" \/>\}\s+active=\{mode === 'form'\}\s+onClick=\{\(\) => \{\s+setMode\('form'\);\s+setSelected\(initialFormValue\);\s+\}\}\s+label="[^"]+"\s+\/>/g,
  `<ViewButton\n            icon={<SquarePen className="h-4 w-4" />}\n            active={isFormOpen}\n            onClick={() => {\n              setSelected(initialFormValue);\n              setIsFormOpen(true);\n            }}\n            label="新建 / 编辑"\n          />`
);

content = content.replace(/if \(mode === 'form'\) \{/g, `if (isFormOpen) {`);
content = content.replace(/if \(mode !== 'form' \|\| !selectedId\) \{/g, `if (!isFormOpen || !selectedId) {`);
content = content.replace(/setMode\('form'\);/g, `setIsFormOpen(true);`);

content = content.replace(
  /\{mode === 'form' \? \(/g,
  `<Sheet\n        open={isFormOpen}\n        onClose={() => setIsFormOpen(false)}\n        title={selected && selected.id ? \`编辑 \${activeTitle}\` : \`新建 \${activeTitle}\`}\n        widthClassName="w-[min(1000px,95vw)]"\n      >`
);

content = content.replace(
  /          <\/aside>\n        <\/div>\n      \) : null\}/g,
  `          </aside>\n        </div>\n      </Sheet>`
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Done!');
