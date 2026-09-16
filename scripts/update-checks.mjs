import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  applyUpdate,
  childPath,
  copyTree,
  extractArchive,
  main,
  validateCandidate
} from "./update.mjs";

async function write(root, name, value) {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value);
}
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(tmpdir(), "obs-update-test-"));
  // This directory is freshly created by this test and never contains user files.
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "old app 日本語 & test");
  const candidate = path.join(base, "new app");
  for (const folder of [root, candidate]) {
    await write(folder, "package.json", JSON.stringify({ name: "obs-effect-app" }));
    await write(folder, "pnpm-lock.yaml", "lockfileVersion: '9.0'");
    await write(folder, "pnpm-workspace.yaml", "packages: []");
    await write(folder, "apps/server/src/server.ts", folder === root ? "old code" : "new code");
    await write(folder, "scripts/update.mjs", "// updater");
  }
  await write(root, "data/presets/presets.json", '{"name":"saved preset"}');
  await write(root, "data/events/catalog.sqlite", Buffer.from([0, 1, 2, 3, 255]));
  await write(root, "data/assets/image.png", "user image");
  await write(root, ".env", "TEST_SETTING=preserved");
  await write(root, "node_modules/old-dependency.txt", "old dependency");
  await write(root, "apps/server/node_modules/old-link.txt", "old workspace dependency");
  await write(root, "apps/server/dist/server.js", "old server");
  await write(root, "apps/control/dist/index.html", "old control");
  await write(root, "apps/overlay/dist/index.html", "old overlay");
  await write(root, "apps/server/src/obsolete.ts", "remove on ZIP update");
  const backup = path.join(root, ".updates", "test-backup");
  return { root, candidate, backup, before: "old", target: "new", mode: "zip" };
}
function install(root, action) {
  const files =
    action === "install"
      ? ["node_modules/new-dependency.txt", "apps/server/node_modules/new-link.txt"]
      : [
          "apps/server/dist/server.js",
          "apps/control/dist/index.html",
          "apps/overlay/dist/index.html"
        ];
  for (const name of files) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), `new ${action}`);
  }
}
const read = (root, name) => fs.readFile(path.join(root, name), "utf8");

test("ZIP update preserves settings, database, images and env; backs up old dependencies", async (t) => {
  const options = await fixture(t);
  const result = await applyUpdate({ ...options, install });
  assert.equal(result.status, "complete");
  assert.equal(await read(options.root, "apps/server/src/server.ts"), "new code");
  await assert.rejects(fs.access(path.join(options.root, "apps/server/src/obsolete.ts")));
  assert.equal(await read(options.root, "data/presets/presets.json"), '{"name":"saved preset"}');
  assert.deepEqual(
    await fs.readFile(path.join(options.root, "data/events/catalog.sqlite")),
    Buffer.from([0, 1, 2, 3, 255])
  );
  assert.equal(await read(options.root, ".env"), "TEST_SETTING=preserved");
  assert.equal(await read(options.backup, "data/assets/image.png"), "user image");
  assert.equal(
    await read(options.backup, "previous-artifacts/node_modules/old-dependency.txt"),
    "old dependency"
  );
  assert.equal(JSON.parse(await read(options.root, ".updates/installed.json")).commit, "new");
});

test("failed ZIP build restores the exact old source, dependencies and build without overwriting data", async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    applyUpdate({
      ...options,
      install(root, action) {
        install(root, action);
        if (action === "build") throw new Error("simulated build failure");
      }
    }),
    /simulated build failure/
  );
  assert.equal(await read(options.root, "apps/server/src/server.ts"), "old code");
  assert.equal(await read(options.root, "apps/server/src/obsolete.ts"), "remove on ZIP update");
  assert.equal(await read(options.root, "node_modules/old-dependency.txt"), "old dependency");
  assert.equal(
    await read(options.root, "apps/server/node_modules/old-link.txt"),
    "old workspace dependency"
  );
  assert.equal(await read(options.root, "apps/control/dist/index.html"), "old control");
  assert.equal(await read(options.root, "data/assets/image.png"), "user image");
  assert.equal(JSON.parse(await read(options.backup, "update.json")).status, "rolled-back");
});

test("protected archive paths and a running application abort before program changes", async (t) => {
  const options = await fixture(t);
  await write(options.candidate, "data/presets.json", "must not overwrite user data");
  await assert.rejects(validateCandidate(options.candidate), /protected user data/);
  await assert.rejects(applyUpdate({ ...options, install }), /protected user data/);
  assert.equal(await read(options.root, "apps/server/src/server.ts"), "old code");
  assert.throws(() => childPath(options.root, "../escape"), /Unsafe path/);
  const clean = await fixture(t);
  await assert.rejects(
    applyUpdate({
      ...clean,
      install,
      stopped: () => {
        throw new Error("running");
      }
    }),
    /running/
  );
  assert.equal(await read(clean.root, "node_modules/old-dependency.txt"), "old dependency");
});

test("backup refuses directory links instead of copying outside the application", async (t) => {
  const options = await fixture(t);
  await fs.symlink(options.candidate, path.join(options.root, "data", "linked"), "junction");
  await assert.rejects(
    copyTree(path.join(options.root, "data"), path.join(options.backup, "data")),
    /link/
  );
});

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function gitFixture(t) {
  const options = await fixture(t);
  await write(options.root, ".gitignore", "data/\nnode_modules/\ndist/\n.env\n.updates/\n");
  git(options.root, "init", "-b", "main");
  git(options.root, "config", "user.name", "Updater test");
  git(options.root, "config", "user.email", "test@example.invalid");
  git(options.root, "add", ".");
  git(options.root, "commit", "-m", "old version");
  options.before = git(options.root, "rev-parse", "HEAD");
  git(options.root, "switch", "-c", "incoming");
  await write(options.root, "apps/server/src/server.ts", "new code");
  git(options.root, "add", ".");
  git(options.root, "commit", "-m", "new version");
  options.target = git(options.root, "rev-parse", "HEAD");
  git(options.root, "switch", "main");
  return { ...options, mode: "git", run: (root, _executable, args) => git(root, ...args) };
}

test("Git update fast-forwards and keeps data", async (t) => {
  const options = await gitFixture(t);
  await applyUpdate({ ...options, install });
  assert.equal(git(options.root, "rev-parse", "HEAD"), options.target);
  assert.equal(await read(options.root, "data/assets/image.png"), "user image");
  assert.equal(git(options.root, "status", "--porcelain"), "");
});

test("Git install failure returns to the old commit and restores offline dependencies", async (t) => {
  const options = await gitFixture(t);
  await assert.rejects(
    applyUpdate({
      ...options,
      install: () => {
        throw new Error("offline");
      }
    }),
    /offline/
  );
  assert.equal(git(options.root, "rev-parse", "HEAD"), options.before);
  assert.equal(await read(options.root, "node_modules/old-dependency.txt"), "old dependency");
  assert.equal(await read(options.root, "apps/server/dist/server.js"), "old server");
  assert.equal(git(options.root, "status", "--porcelain"), "");
});

test("local Git edits are rejected without network calls and the lock is released", async (t) => {
  const options = await gitFixture(t);
  await write(options.root, "apps/server/src/server.ts", "my uncommitted work");
  await assert.rejects(main(["--root", options.root, "--check"]), /Local program changes/);
  assert.equal(await read(options.root, "apps/server/src/server.ts"), "my uncommitted work");
  await assert.rejects(fs.access(path.join(options.root, ".updates/update.lock")));
});

test("Windows ZIP extraction works with spaces and Japanese paths and rejects traversal", async (t) => {
  const options = await fixture(t);
  const zip = path.join(options.root, ".updates", "source.zip");
  await fs.mkdir(path.dirname(zip), { recursive: true });
  const create = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:TEST_SOURCE,$env:TEST_ZIP,[IO.Compression.CompressionLevel]::Optimal,$true)"
    ],
    {
      env: { ...process.env, TEST_SOURCE: options.candidate, TEST_ZIP: zip },
      encoding: "utf8",
      windowsHide: true
    }
  );
  assert.equal(create.status, 0, create.stderr);
  const extracted = await extractArchive(zip, path.join(options.root, ".updates", "unpacked"));
  assert.equal(await read(extracted, "apps/server/src/server.ts"), "new code");
  await validateCandidate(extracted);
  const badZip = path.join(options.root, ".updates", "bad.zip");
  const bad = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::Open($env:TEST_ZIP,[IO.Compression.ZipArchiveMode]::Create); $null=$z.CreateEntry('../escape.txt'); $z.Dispose()"
    ],
    {
      env: { ...process.env, TEST_ZIP: badZip },
      encoding: "utf8",
      windowsHide: true
    }
  );
  assert.equal(bad.status, 0, bad.stderr);
  await assert.rejects(
    extractArchive(badZip, path.join(options.root, ".updates", "bad-unpacked")),
    /ZIP extraction failed/
  );
  await assert.rejects(fs.access(path.join(options.root, ".updates", "escape.txt")));
});

test("failed automatic recovery retains backups and prevents another update", async (t) => {
  const options = await gitFixture(t);
  await assert.rejects(
    applyUpdate({
      ...options,
      run(root, executable, args) {
        if (args[0] === "reset") throw new Error("simulated reset failure");
        return options.run(root, executable, args);
      },
      install: () => {
        throw new Error("simulated install failure");
      }
    }),
    /simulated install failure/
  );
  assert.equal(JSON.parse(await read(options.backup, "update.json")).status, "recovery-required");
  await assert.rejects(main(["--root", options.root]), /manual recovery/);
  assert.equal(
    await read(options.backup, "previous-artifacts/node_modules/old-dependency.txt"),
    "old dependency"
  );
});
