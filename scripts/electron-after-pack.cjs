// electron-builder afterPack hook: copy the Next.js standalone server (with its
// own node_modules, which extraResources won't copy) into resources/server.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const src = path.join(context.packager.projectDir, ".next-app", "standalone");
  // macOS keeps resources inside the .app bundle; Linux and Windows next to the executable.
  const resources = context.electronPlatformName === "darwin" ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources") : path.join(context.appOutDir, "resources");
  const dest = path.join(resources, "server");
  if (!fs.existsSync(path.join(src, "server.js"))) throw new Error("No standalone server. Run npm run dist (scripts/package-desktop.mjs), which builds it first.");
  fs.rmSync(dest, { recursive: true, force: true });
  // dereference: Next links a hashed package name to the real package (.next-app/node_modules/<pkg>-<hash>).
  // A copied link would point at this build machine's folder (broken on every other computer, and it
  // breaks the macOS universal merge), so links are copied as the files they point to.
  fs.cpSync(src, dest, { recursive: true, dereference: true, filter: (f) => !path.basename(f).startsWith(".env") });
};
