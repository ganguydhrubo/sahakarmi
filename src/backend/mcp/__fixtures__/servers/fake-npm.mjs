// Test stand-in for npm-cli.js: "install --prefix <folder> ... <pkg>@<version>" puts a package with a bin.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
const spec = args[args.length - 1];
const at = spec.lastIndexOf("@");
const name = spec.slice(0, at);
if (args[0] !== "install" || !prefix || at <= 0) {
  console.error("unexpected arguments", args.join(" "));
  process.exit(2);
}
const root = join(prefix, "node_modules", ...name.split("/"));
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(
  join(root, "package.json"),
  JSON.stringify({
    name,
    version: spec.slice(at + 1),
    bin: { [name.split("/").pop()]: "dist/index.js" },
  }),
);
writeFileSync(join(root, "dist", "index.js"), "// server\n");
console.log(`added 1 package (${spec})`);
