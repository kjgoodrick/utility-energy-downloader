import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "icons");
const svgPath = join(outDir, "icon.svg");
const sizes = [16, 32, 48, 128];

function hasCommand(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

if (!existsSync(svgPath)) {
  throw new Error(`Cannot generate extension icons: missing source SVG at ${svgPath}`);
}

mkdirSync(outDir, { recursive: true });

if (!hasCommand("rsvg-convert")) {
  const missingPngs = sizes
    .map((size) => join(outDir, `icon${size}.png`))
    .filter((filePath) => !existsSync(filePath));

  if (missingPngs.length === 0) {
    console.warn("Skipping extension icon PNG generation: rsvg-convert is not available and existing PNGs are present.");
    process.exit(0);
  }

  throw new Error(
    "Cannot generate extension icon PNGs: rsvg-convert is not available and one or more PNGs are missing.\n" +
      "Install librsvg locally, run npm run generate-icons, and commit the generated PNGs."
  );
}

for (const size of sizes) {
  execFileSync("rsvg-convert", [
    "--keep-aspect-ratio",
    "-w",
    String(size),
    "-h",
    String(size),
    svgPath,
    "-o",
    join(outDir, `icon${size}.png`)
  ]);
}
