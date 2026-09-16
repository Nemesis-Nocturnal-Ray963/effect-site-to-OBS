import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = "Nemesis-Nocturnal-Ray963/effect-site-to-OBS";
const programDirectories = ["apps", "packages", "scripts", "docs"];
const protectedName = /^(?:data|node_modules|\.git|\.updates|\.pnpm-store|\.env(?:\..*)?)$/i;
const ignoredArtifacts = new Set(["node_modules", "dist", ".git", ".updates"]);

export function childPath(root, relative) {
  const result = path.resolve(root, relative);
  if (!result.startsWith(path.resolve(root) + path.sep))
    throw new Error(`Unsafe path: ${relative}`);
  return result;
}

function command(root, executable, args, capture = false) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${executable} failed (${result.status ?? result.error?.code}). ${capture ? (result.stderr?.trim() ?? "") : ""}`
    );
  }
  return result.stdout?.trim() ?? "";
}

function git(root, ...args) {
  return command(root, "git", args, true);
}

function pnpm(root, args) {
  // Only fixed commands generated here enter cmd.exe; paths are passed through cwd.
  const line =
    args === "install" ? "corepack pnpm install --frozen-lockfile" : "corepack pnpm build";
  command(root, process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", line]);
}

export async function copyTree(source, destination, skipArtifacts = false) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Backup cannot safely follow a link: ${source}`);
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    for (const name of await fs.readdir(source)) {
      if (skipArtifacts && ignoredArtifacts.has(name)) continue;
      await copyTree(path.join(source, name), path.join(destination, name), skipArtifacts);
    }
  } else if (stat.isFile()) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    const digest = async (file) => {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      return hash.digest("hex");
    };
    if ((await digest(source)) !== (await digest(destination))) {
      throw new Error(`Backup verification failed: ${source}`);
    }
  } else throw new Error(`Unsupported file in backup: ${source}`);
}

export async function validateCandidate(candidate) {
  const pkg = JSON.parse(await fs.readFile(path.join(candidate, "package.json"), "utf8"));
  if (pkg.name !== "obs-effect-app") throw new Error("This archive is not OBS Effect App.");
  for (const name of [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/server/src/server.ts",
    "scripts/update.mjs"
  ]) {
    if (!existsSync(path.join(candidate, name)))
      throw new Error(`Incomplete update archive: ${name}`);
  }
  const names = await fs.readdir(candidate);
  for (const name of names) {
    if (protectedName.test(name))
      throw new Error(`The update contains protected user data: ${name}`);
    const stat = await fs.lstat(path.join(candidate, name));
    if (stat.isDirectory() && !programDirectories.includes(name))
      throw new Error(`Unknown program directory: ${name}`);
  }
  return names;
}

async function artifacts(root) {
  const result = ["node_modules"];
  for (const group of ["apps", "packages"]) {
    if (!existsSync(path.join(root, group))) continue;
    for (const name of await fs.readdir(path.join(root, group))) {
      for (const kind of ["node_modules", "dist"]) result.push(`${group}/${name}/${kind}`);
    }
  }
  return result;
}

async function moveIfPresent(root, relative, destinationRoot) {
  const source = childPath(root, relative),
    destination = childPath(destinationRoot, relative);
  // lstat also detects broken pnpm junctions while the root node_modules is moved.
  try {
    await fs.lstat(source);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(source, destination);
  return true;
}

export async function applyUpdate({
  root,
  backup,
  mode,
  candidate,
  before,
  target,
  run = command,
  install = pnpm,
  stopped = async () => {}
}) {
  const metadata = {
    mode,
    before,
    target,
    startedAt: new Date().toISOString(),
    status: "backing-up"
  };
  const record = () =>
    fs.writeFile(path.join(backup, "update.json"), JSON.stringify(metadata, null, 2));
  await fs.mkdir(backup, { recursive: true });
  await record();
  const candidateNames = mode === "zip" ? await validateCandidate(candidate) : [];
  // Snapshot settings, assets, SQLite databases, browser sessions and local env files.
  console.log(
    "Backing up and verifying data, assets and browser sessions. Large media folders may take several minutes..."
  );
  if (existsSync(path.join(root, "data")))
    await copyTree(path.join(root, "data"), path.join(backup, "data"));
  for (const name of await fs.readdir(root)) {
    if (/^\.env(?:\..*)?$/i.test(name))
      await copyTree(path.join(root, name), path.join(backup, "environment", name));
  }
  if (mode === "git") {
    run(
      root,
      "git",
      ["archive", "--format=zip", `--output=${path.join(backup, "previous-code.zip")}`, before],
      true
    );
  }
  await stopped();
  const artifactPaths = await artifacts(root);
  const movedArtifacts = [],
    movedProgram = [],
    installedProgram = [];
  Object.assign(metadata, { movedArtifacts, movedProgram, installedProgram });
  let codeChanged = false;
  let installStarted = false;
  const previous = path.join(backup, "previous");
  const previousArtifacts = path.join(backup, "previous-artifacts");
  const failed = path.join(backup, "failed");
  try {
    metadata.status = "updating";
    await record();
    for (const relative of artifactPaths) {
      if (await moveIfPresent(root, relative, previousArtifacts)) movedArtifacts.push(relative);
      await record();
    }
    if (mode === "git") {
      run(root, "git", ["merge", "--ff-only", target], true);
      codeChanged = true;
    } else {
      for (const name of new Set([...programDirectories, ...candidateNames])) {
        if (await moveIfPresent(root, name, previous)) movedProgram.push(name);
        await record();
      }
      for (const name of candidateNames) {
        installedProgram.push(name);
        await record();
        await copyTree(path.join(candidate, name), childPath(root, name), true);
      }
    }
    installStarted = true;
    console.log("Installing locked dependencies...");
    install(root, "install");
    console.log("Building the updated application...");
    install(root, "build");
    for (const file of [
      "apps/server/dist/server.js",
      "apps/control/dist/index.html",
      "apps/overlay/dist/index.html"
    ]) {
      if (!existsSync(path.join(root, file))) throw new Error(`Build output missing: ${file}`);
    }
    metadata.status = "complete";
    metadata.completedAt = new Date().toISOString();
    await record();
    await fs.writeFile(
      path.join(root, ".updates", "installed.json"),
      JSON.stringify({ commit: target, updatedAt: metadata.completedAt }, null, 2)
    );
    return metadata;
  } catch (error) {
    console.error(`Update failed: ${error.message}\nRestoring the previous program...`);
    try {
      // No recursive deletion: retain the failed new files for diagnosis.
      if (mode === "zip") {
        for (const name of installedProgram) await moveIfPresent(root, name, failed);
        for (const name of movedProgram) await moveIfPresent(previous, name, root);
      } else if (codeChanged) {
        run(root, "git", ["reset", "--keep", before], true);
      }
      for (const relative of installStarted ? artifactPaths : []) {
        if (mode === "git" || !programDirectories.some((name) => relative.startsWith(name + "/"))) {
          await moveIfPresent(root, relative, failed);
        }
      }
      for (const relative of movedArtifacts) await moveIfPresent(previousArtifacts, relative, root);
      metadata.status = "rolled-back";
      console.error(
        "Previous code, dependencies and build output restored. data was not replaced."
      );
    } catch (rollbackError) {
      metadata.status = "recovery-required";
      metadata.recoveryError = rollbackError.message;
      await fs.writeFile(
        path.join(root, ".updates", "recovery-required.json"),
        JSON.stringify({ backup, error: rollbackError.message }, null, 2)
      );
      console.error(
        `Automatic recovery could not finish: ${rollbackError.message}\nDo not start the app. Keep this backup: ${backup}`
      );
    }
    metadata.error = error.message;
    await record();
    throw error;
  }
}

async function assertStopped(root) {
  // Pass the path as environment data, never interpolate it into PowerShell source.
  const script =
    "$ErrorActionPreference='Stop'; $root=$env:OBS_EFFECT_UPDATE_ROOT; $items=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and (($_.Name -match '^node(\\.exe)?$' -and $_.CommandLine -match 'dist[/\\\\]server\\.js') -or ($_.CommandLine.Contains($root) -and ($_.Name -match '^(node|chrome|msedge)(\\.exe)?$') -and $_.CommandLine -notmatch 'update\\.mjs')) }; if ($items) { Write-Output 'Close the app server and its TikTok browser before updating.'; exit 2 }";
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      cwd: root,
      env: { ...process.env, OBS_EFFECT_UPDATE_ROOT: root },
      encoding: "utf8",
      windowsHide: true
    }
  );
  if (result.error || result.status !== 0)
    throw new Error(result.stdout?.trim() || "Could not verify that the app is stopped.");
  for (const port of new Set([3190, Number(process.env.PORT || 3190)])) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1500)
      });
      if (response.ok) throw new Error("APP_RUNNING");
    } catch (error) {
      if (error.message === "APP_RUNNING")
        throw new Error(`Close the app server on port ${port} before updating.`);
    }
  }
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "OBS-Effect-App-Updater", Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30000)
  });
  if (response.status === 404)
    throw new Error(
      "The update repository is not publicly accessible (GitHub 404). Ask the distributor to publish the update source. Your settings were not changed."
    );
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}). Try again later.`);
  return response.json();
}

async function downloadCandidate(target, folder) {
  const zipPath = path.join(folder, "source.zip"),
    unpack = path.join(folder, "source");
  const response = await fetch(`https://codeload.github.com/${repository}/zip/${target}`, {
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  await fs.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  return extractArchive(zipPath, unpack);
}

export async function extractArchive(zipPath, unpack) {
  const extraction = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($env:OBS_EFFECT_UPDATE_ZIP)
try {
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName -match '(^[/\\\\]|(^|[/\\\\])\\.\\.([/\\\\]|$)|:)' -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw 'Unsafe ZIP entry' }
  }
} finally { $zip.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($env:OBS_EFFECT_UPDATE_ZIP,$env:OBS_EFFECT_UPDATE_UNPACK)
`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", extraction],
    {
      env: { ...process.env, OBS_EFFECT_UPDATE_ZIP: zipPath, OBS_EFFECT_UPDATE_UNPACK: unpack },
      encoding: "utf8",
      windowsHide: true
    }
  );
  if (result.error || result.status !== 0)
    throw new Error(`ZIP extraction failed: ${result.stderr ?? ""}`);
  const roots = await fs.readdir(unpack);
  if (roots.length !== 1) throw new Error("Unexpected ZIP layout.");
  return path.join(unpack, roots[0]);
}

export async function main(args = process.argv.slice(2)) {
  const originalDirectory = process.cwd();
  try {
    return await runMain(args);
  } finally {
    if (existsSync(originalDirectory)) process.chdir(originalDirectory);
  }
}

async function runMain(args) {
  if (args.includes("--help")) {
    console.log(
      "Usage: scripts\\update.bat [--check] [--git]\nDefault: download the public ZIP; Git is not required.\n--git: developer checkout only.\nClose the app before installing updates. See docs/updating.md."
    );
    return;
  }
  for (let position = 0; position < args.length; position++) {
    if (args[position] === "--root" && args[position + 1]) {
      position++;
      continue;
    }
    if (!["--check", "--git"].includes(args[position]))
      throw new Error(`Unknown or incomplete argument: ${args[position]}`);
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13))
    throw new Error("Node.js 22.13 or later is required for this application.");
  const index = args.indexOf("--root");
  const root = await fs.realpath(
    index >= 0 ? args[index + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
  );
  // Direct Node launches can also start inside scripts. Release that directory
  // before the ZIP installer renames program directories (Windows cwd lock).
  process.chdir(root);
  const checkOnly = args.includes("--check");
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  if (pkg.name !== "obs-effect-app")
    throw new Error("Run this updater from the OBS Effect App folder.");
  const stateDir = path.join(root, ".updates");
  if (existsSync(stateDir) && (await fs.lstat(stateDir)).isSymbolicLink())
    throw new Error(".updates must not be a link.");
  await fs.mkdir(stateDir, { recursive: true });
  if (existsSync(path.join(stateDir, "recovery-required.json")))
    throw new Error(
      "A previous update needs manual recovery. See .updates/recovery-required.json and docs/updating.md. No files were changed."
    );
  const lockPath = path.join(stateDir, "update.lock");
  let lock;
  try {
    lock = await fs.open(lockPath, "wx");
  } catch {
    throw new Error(
      "Another update is running, or a previous update was interrupted. See docs/updating.md before removing .updates/update.lock."
    );
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  try {
    // Copies may contain .git owned by another Windows user or an SSH remote.
    // Public ZIP updates do not depend on either, or on an installed Git executable.
    const mode = args.includes("--git") ? "git" : "zip";
    let before = "unknown",
      target;
    if (mode === "git") {
      if (!existsSync(path.join(root, ".git")))
        throw new Error(
          "--git requires a developer Git checkout. Run without --git for a distribution update."
        );
      if (path.resolve(git(root, "rev-parse", "--show-toplevel")) !== root)
        throw new Error("The application must be the Git repository root.");
      if (git(root, "branch", "--show-current") !== "main")
        throw new Error("Switch to main before updating.");
      const dirty = git(
        root,
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        ".",
        ":(exclude).updates",
        ":(exclude).env",
        ":(exclude).env.*"
      );
      if (dirty)
        throw new Error(
          "Local program changes found. Commit or move your changes before updating; nothing was overwritten."
        );
      const remote = git(root, "remote", "get-url", "origin");
      if (
        ![
          `https://github.com/${repository}.git`,
          `https://github.com/${repository}`,
          `git@github.com:${repository}.git`
        ].includes(remote)
      )
        throw new Error("origin does not point to the expected OBS Effect App repository.");
      before = git(root, "rev-parse", "HEAD");
      git(root, "fetch", "origin", "main");
      target = git(root, "rev-parse", "FETCH_HEAD");
      git(root, "merge-base", "--is-ancestor", before, target);
      const tracked = git(root, "ls-tree", "-r", "--name-only", target).split("\n");
      if (tracked.some((name) => protectedName.test(name.split("/")[0])))
        throw new Error("The update tracks protected user data; update refused.");
    } else {
      try {
        before = JSON.parse(
          await fs.readFile(path.join(stateDir, "installed.json"), "utf8")
        ).commit;
      } catch {}
      target = (await githubJson(`https://api.github.com/repos/${repository}/commits/main`)).sha;
    }
    if (!/^[a-f0-9]{40}$/i.test(target)) throw new Error("Invalid update commit.");
    console.log(`Mode: ${mode}\nCurrent: ${before}\nLatest main: ${target}`);
    if (target === before) {
      console.log("Already up to date.");
      return;
    }
    if (checkOnly) {
      console.log("An update is available. Run update.bat without --check to install it.");
      return;
    }
    await assertStopped(root);
    command(root, process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "corepack --version"], true);
    const backup = path.join(stateDir, `u-${Date.now().toString(36)}`);
    await fs.mkdir(backup, { recursive: true });
    console.log(
      `Backup: ${backup}\nKeep the server and TikTok browser closed until this update finishes.`
    );
    const candidate = mode === "zip" ? await downloadCandidate(target, backup) : undefined;
    await applyUpdate({
      root,
      backup,
      mode,
      candidate,
      before,
      target,
      stopped: () => assertStopped(root)
    });
    console.log(
      "Update complete. Settings and assets were preserved. Start scripts/start-dev.bat, then reload the OBS browser source."
    );
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
}
