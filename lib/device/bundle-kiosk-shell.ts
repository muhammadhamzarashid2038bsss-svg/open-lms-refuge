// Turns the shell TypeScript into one browser script. The app's build command
// stays the same. The script is saved under public/kiosk and inlined into the
// shell document. It does not start Next.js.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function moduleId(fileName: string): string {
  return relative(root, fileName).replaceAll("\\", "/");
}

function resolveModule(fromFile: string, spec: string): string {
  const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : resolve(dirname(fromFile), spec);
  for (const ext of [".ts", ".tsx", ".js"]) {
    const candidate = base.endsWith(ext) ? base : `${base}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot bundle import ${spec} from ${fromFile}`);
}

function valueImports(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    if (node.importClause?.isTypeOnly) return;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      const values = bindings.elements.filter((element) => !element.isTypeOnly);
      if (!node.importClause?.name && values.length === 0) return;
    }
    specs.push(node.moduleSpecifier.text);
  });
  return specs;
}

export function bundleKioskShell(entry = join(root, "lib", "device", "kiosk-shell.ts")): string {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (fileName: string) => {
    if (seen.has(fileName)) return;
    seen.add(fileName);
    const source = readFileSync(fileName, "utf8");
    for (const spec of valueImports(fileName, source)) visit(resolveModule(fileName, spec));
    order.push(fileName);
  };
  visit(entry);

  const modules = order.map((fileName) => {
    const source = readFileSync(fileName, "utf8").replace(/^\uFEFF?["']use client["'];\s*/, "");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName,
    }).outputText;
    const body = transpiled.replace(/require\((["'])(.*?)\1\)/g, (_match, _quote: string, spec: string) => {
      return `require(${JSON.stringify(moduleId(resolveModule(fileName, spec)))})`;
    });
    return `define(${JSON.stringify(moduleId(fileName))}, function (exports, require) {\n${body}\n});`;
  });

  return `/* olr-kiosk-shell. No learner data is stored in this file. */\n(function () {\n  var modules = {};\n  function define(id, factory) {\n    var module = { exports: {} };\n    modules[id] = module;\n    factory(module.exports, function (req) {\n      var loaded = modules[req];\n      if (!loaded) throw new Error("Missing shell module");\n      return loaded.exports;\n    });\n  }\n  ${modules.join("\n  ")}\n  modules[${JSON.stringify(moduleId(entry))}].exports.mountKioskShell(document);\n})();\n`;
}
