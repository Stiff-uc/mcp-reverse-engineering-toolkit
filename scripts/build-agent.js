import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src', 'js-agent');
const distDir = join(__dirname, '..', 'dist');

function stripImports(content) {
  return content.replace(/^import .+ from\s+['"].+['"];?\s*$/gm, '').trim();
}

function rewriteIndexJs(content) {
  return content.replace(/AGENT_VERSION/g, '__agentVersion');
}

function collectExports(content) {
  const exports = [];
  const cleaned = content
    .replace(/^export function (\w+)/gm, (_, name) => {
      exports.push(name);
      return `function ${name}`;
    })
    .replace(/^export const (\w+)/gm, (_, name) => {
      exports.push(name);
      return `const ${name}`;
    })
    .replace(/^export class (\w+)/gm, (_, name) => {
      exports.push(name);
      return `class ${name}`;
    })
    .replace(/^export \{([^}]+)\};?\s*$/gm, (_, list) => {
      list.split(',').forEach((item) => {
        const trimmed = item.trim().split(' as ')[0].trim();
        exports.push(trimmed);
      });
      return '';
    })
    .replace(/^export default /gm, '');
  return { cleaned, exports };
}

const modules = [
  { file: 'executor.js', varName: 'executeJs' },
  { file: 'self-update.js', varName: 'selfUpdate' },
  { file: 'command-handler.js', varName: 'createCommandHandler' },
  { file: 'connection.js', varName: 'createConnection' },
  { file: 'index.js', varName: 'createJsAgent' },
];

function build() {
  let bundle = '(function() {\n';
  const allExports = {};

  for (const mod of modules) {
    const raw = readFileSync(join(srcDir, mod.file), 'utf-8');
    const noImports = mod.file === 'index.js' ? rewriteIndexJs(stripImports(raw)) : stripImports(raw);
    const { cleaned, exports: expNames } = collectExports(noImports);

    bundle += `// ---- ${mod.file} ----\n`;
    bundle += cleaned + '\n\n';

    for (const name of expNames) {
      allExports[name] = true;
    }
  }

  bundle += '// ---- self-executing ----\n';
  bundle += 'var agent = createJsAgent("ws://localhost:3101");\n';
  bundle += 'agent.start();\n';
  bundle += 'console.log("[JS-Agent] Connected to MCP Proxy. Version: " + __agentVersion);\n';
  bundle += 'window.__jsAgent = agent;\n';
  bundle += '})();\n';

  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'js-agent-bundle.js'), bundle, 'utf-8');
  console.log('Bundle built: dist/js-agent-bundle.js');
  console.log('Exports captured:', Object.keys(allExports));
}

build();