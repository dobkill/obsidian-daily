import esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const prod = process.argv.includes("--watch") === false;
const watch = process.argv.includes("--watch");
const outdir = "project-manager";
const bundledMain = path.join(outdir, "main.js");

async function prepareOutputFiles() {
  await mkdir(outdir, { recursive: true });
  await Promise.all([
    copyFile("manifest.json", path.join(outdir, "manifest.json")),
    copyFile("styles.css", path.join(outdir, "styles.css"))
  ]);
}

async function syncRootMain() {
  await copyFile(bundledMain, "main.js");
}

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands", "@codemirror/language", "@codemirror/lint", "@codemirror/search", "@codemirror/state", "@codemirror/view", "@lezer/common", "@lezer/highlight", "@lezer/lr"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: bundledMain,
  plugins: [{
    name: "sync-root-main",
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length === 0) {
          await syncRootMain();
        }
      });
    }
  }]
});

if (watch) {
  await prepareOutputFiles();
  await ctx.watch();
} else {
  await prepareOutputFiles();
  await ctx.rebuild();
  await ctx.dispose();
}
