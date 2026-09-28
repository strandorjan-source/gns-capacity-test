// One-time source migration, run on the feature branch and removed after verification.
// Only UI text is changed. Business logic, database enum values and entered text are preserved.
const fs = require('node:fs');
const { parse } = require('/tmp/gns-i18n-tools/node_modules/@babel/parser');
const files = ['app/page.js', 'app/vehicle-components.js', 'app/load-components.js', 'app/loads-board.js', 'app/error.js'];
const keys = new Set();
const plain = value => String(value).replace(/\s+/g, ' ').trim();
const hasWords = value => /[A-Za-zÀ-ž]/.test(value);
const ignored = value => !hasWords(value) || /^(GNS|GNS CAPACITY|GNS Capacity|GNS CARGO AS|CAPACITY CONTROL TOWER|GNS CARGO AS · CAPACITY CONTROL TOWER|OSLO \/ GARDERMOEN|Control Tower)$/.test(plain(value));
const json = JSON.stringify;
function each(node, visitor, parent = null) {
  if (!node || typeof node !== 'object' || !node.type) return;
  visitor(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => each(child, visitor, node));
    else if (value && typeof value === 'object') each(value, visitor, node);
  }
}
function parameterize(source, before, after) {
  if (!source.includes(before)) throw new Error(`Expected JSX not found: ${before}`);
  return source.replace(before, after);
}
for (const filename of files) {
  let source = fs.readFileSync(filename, 'utf8');
  if (source.includes("from './i18n-provider'")) throw new Error(`Already localized: ${filename}`);
  source = source.replace(/\.join\(' kl\. '\)/g, ".join(' · ')");
  if (filename === 'app/page.js') {
    for (const [before, text, parameters] of [
      ['Frigi {modal.row.registration}? Tidligere reservasjon, bruker og lasskommentar bevares i hendelsesloggen.', 'Frigi {registration}? Tidligere reservasjon, bruker og lasskommentar bevares i hendelsesloggen.', 'registration: modal.row.registration'],
      ['Slette linjen for {modal.row.registration}? Den fjernes fra kapasitetstorget og merkes som slettet i Historikk. Admin kan gjenopprette linjen.', 'Slette linjen for {registration}? Den fjernes fra kapasitetstorget og merkes som slettet i Historikk. Admin kan gjenopprette linjen.', 'registration: modal.row.registration'],
      ['Gjenopprett linjen for {modal.row.registration}. Dersom ledigdatoen er passert, blir bilen liggende under Historikk.', 'Gjenopprett linjen for {registration}. Dersom ledigdatoen er passert, blir bilen liggende under Historikk.', 'registration: modal.row.registration'],
    ]) { source = parameterize(source, before, `{_t(${json(text)}, { ${parameters} })}`); keys.add(text); }
  }
  if (filename === 'app/loads-board.js') {
    const text = 'Fjerne lasset fra {pickup} til {delivery}? Det blir borte fra transportørenes oversikt og kan gjenopprettes av admin.';
    source = parameterize(source, 'Fjerne lasset fra {modal.row.pickup} til {modal.row.delivery}? Det blir borte fra transportørenes oversikt og kan gjenopprettes av admin.', `{_t(${json(text)}, { pickup: modal.row.pickup, delivery: modal.row.delivery })}`);
    keys.add(text);
  }
  if (filename === 'app/vehicle-components.js') {
    source = source.replace('displayValue(k, event.before_data?.[k])', 'displayValue(k, event.before_data?.[k], formatDate, _t)').replace('displayValue(k, event.after_data?.[k])', 'displayValue(k, event.after_data?.[k], formatDate, _t)');
    source = source.replace(/function displayValue\(key, value\) \{[^\n]+\}/, "function displayValue(key, value, formatDate, t) { if (key === 'available_at') return formatDate(value).join(' · '); if (!value) return t('Ikke oppgitt'); return ['vehicle_type', 'door_type', 'loading_region'].includes(key) ? t(String(value)) : String(value); }");
  }
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const edits = [], seen = new Set();
  const add = (start, end, text) => {
    const id = `${start}:${end}`;
    if (start !== end && seen.has(id)) return;
    if (start !== end) seen.add(id);
    edits.push({ start, end, text });
  };
  const raw = node => source.slice(node.start, node.end);
  function translateLiteral(node) {
    if (ignored(node.value)) return;
    keys.add(plain(node.value));
    add(node.start, node.end, `_t(${raw(node)})`);
  }
  function expression(node, option = false) {
    if (!node) return;
    if (node.type === 'StringLiteral') { translateLiteral(node); return; }
    if (node.type === 'Identifier') {
      if (option || ['label', 'submitLabel', 'message', 'error', 'text', 'title', 't', 's'].includes(node.name)) add(node.start, node.end, `_t(${raw(node)})`);
      return;
    }
    if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
      const text = raw(node);
      if (option || /^(row\.(status|vehicle_type|door_type|loading_region)|tab\.label|vehicleLabels\[k\])$/.test(text)) add(node.start, node.end, `_t(${text})`);
      else if (node.object?.type === 'ObjectExpression') expression(node.object);
      return;
    }
    if (node.type === 'ConditionalExpression') { expression(node.consequent, option); expression(node.alternate, option); return; }
    if (node.type === 'LogicalExpression') { expression(node.left, option); expression(node.right, option); return; }
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      if (['eventName', 'roleName'].includes(node.callee.name)) add(node.start, node.end, `_t(${raw(node)})`);
      return;
    }
    if (node.type === 'ObjectExpression') { node.properties.forEach(property => expression(property.value)); return; }
    if (node.type === 'TemplateLiteral') {
      node.quasis.forEach(part => {
        if (ignored(part.value.cooked || '')) return;
        keys.add(plain(part.value.cooked));
        add(part.start, part.end, '${_t(' + json(part.value.cooked) + ')}');
      });
      node.expressions.forEach(value => expression(value));
    }
  }
  each(ast, (node, parent) => {
    let componentName;
    if (node.type === 'FunctionDeclaration') componentName = node.id?.name;
    if (node.type === 'ArrowFunctionExpression' && parent?.type === 'VariableDeclarator') componentName = parent.id?.name;
    if (componentName && /^[A-Z]/.test(componentName)) {
      const hook = 'const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();';
      if (node.body.type === 'BlockStatement') add(node.body.start + 1, node.body.start + 1, `\n  ${hook}\n`);
      else { add(node.body.start, node.body.start, `{ ${hook} return (`); add(node.body.end, node.body.end, '); }'); }
    }
    if (node.type === 'JSXElement' && node.openingElement.name.name === 'option') {
      const opening = node.openingElement;
      if (!opening.attributes.some(attribute => attribute.name?.name === 'value')) {
        const child = node.children.find(child => child.type !== 'JSXText' || child.value.trim());
        const value = child?.type === 'JSXText' ? json(plain(child.value)) : child?.type === 'JSXExpressionContainer' ? raw(child.expression) : null;
        if (value === null) throw new Error(`Option has no stable value in ${filename}`);
        add(opening.end - 1, opening.end - 1, ` value={${value}}`);
      }
    }
    if (node.type === 'JSXText' && !ignored(node.value)) {
      const text = node.value.replace(/\s+/g, ' ');
      keys.add(plain(text));
      add(node.start, node.end, `{_t(${json(text)})}`);
    }
    if (node.type === 'JSXAttribute' && ['label', 'placeholder', 'aria-label', 'title', 'text', 'submitLabel', 't', 's'].includes(node.name.name)) {
      if (node.value?.type === 'StringLiteral' && !ignored(node.value.value)) {
        keys.add(plain(node.value.value));
        add(node.value.start, node.value.end, `{_t(${json(node.value.value)})}`);
      } else if (node.value?.type === 'JSXExpressionContainer') expression(node.value.expression);
    }
    if (node.type === 'JSXExpressionContainer' && parent?.type !== 'JSXAttribute') {
      expression(node.expression, parent?.openingElement?.name?.name === 'option');
    }
  });
  // Apply from right to left; nested JSX edits retain all original business logic.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index];
    const previous = edits[index - 1];
    if (previous && edit.end > previous.start) throw new Error(`Overlapping edits in ${filename} at ${edit.start}`);
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }
  source = source.replace("'use client';", "'use client';\nimport { useI18n } from './i18n-provider';");
  parse(source, { sourceType: 'module', plugins: ['jsx'] });
  fs.writeFileSync(filename, source);
}
fs.writeFileSync('app/layout.js', "import './globals.css';\nimport './i18n.css';\nimport I18nProvider from './i18n-provider';\nexport const metadata = { title: 'GNS Capacity', description: 'Ledige biler – GNS Cargo AS' };\nexport default function RootLayout({ children }) { return <html lang=\"nb\"><body><I18nProvider>{children}</I18nProvider></body></html>; }\n");
fs.mkdirSync('test-artifacts', { recursive: true });
fs.writeFileSync('tests/i18n-source-keys.json', JSON.stringify([...keys].sort(), null, 2) + '\n');
(async () => {
  const { dictionaries } = await import('../lib/i18n.mjs');
  const missing = [...keys].filter(key => !dictionaries.nb.has(key)).sort();
  fs.writeFileSync('test-artifacts/i18n-untranslated.json', JSON.stringify(missing, null, 2));
  console.log('Translation source audit:', { keys: keys.size, missing });
})();
