import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const portable = path.join(root, 'portable');
const staging = path.join(portable, '.stage');
const releases = path.join(root, 'releases');
const go = process.env.COMMONS_GO || 'go';
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: portable, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  return result;
}

await mkdir(staging, { recursive: true });
await mkdir(releases, { recursive: true });
// This fixed generated directory belongs to the packaging script, never user data.
const web = path.join(staging, 'web');
if (path.dirname(web) !== staging) throw new Error('Invalid staging directory');
await rm(web, { recursive: true, force: true });
await cp(path.join(root, 'dist'), web, { recursive: true });
const goRoot = run(go, ['env', 'GOROOT'], { stdio: 'pipe' }).stdout.toString().trim();
const notices = ['Commons bundled third-party notices', '\nGo runtime\n' + await readFile(path.join(goRoot, 'LICENSE'), 'utf8')];
async function collectLicenses(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) { await collectLicenses(folder); continue; }
    for (const file of await readdir(folder)) {
      if (/^(licen[sc]e|copying)(\.|$|-)/i.test(file)) {
        try { notices.push(`\n${path.relative(root, folder)}/${file}\n${await readFile(path.join(folder, file), 'utf8')}`); } catch (error) { if (error.code !== 'EISDIR') throw error; }
      }
    }
    try { await collectLicenses(path.join(folder, 'node_modules')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
await collectLicenses(path.join(root, 'node_modules'));
await writeFile(path.join(web, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'));
await cp(path.join(root, 'README.md'), path.join(web, 'README.md'));
const archiveTool = path.join(staging, process.platform === 'win32' ? 'archive.exe' : 'archive');
run(go, ['build', '-trimpath', '-o', archiveTool, './cmd/archive']);
run(archiveTool, ['-source', web, '-output', path.join(portable, 'site.zip')]);
run(go, ['test', './...']);

const targets = [
  ['windows', 'amd64', 'windows-x64.exe'], ['windows', 'arm64', 'windows-arm64.exe'],
  ['linux', 'amd64', 'linux-x64'], ['linux', 'arm64', 'linux-arm64'],
  ['darwin', 'amd64', 'macos-intel.zip'], ['darwin', 'arm64', 'macos-apple-silicon.zip'],
];
const built = [];
for (const [os, arch, suffix] of targets) {
  const name = `Commons-${version}-${suffix}`;
  const output = path.join(releases, name);
  const appRoot = path.join(staging, `macos-${arch}`);
  const contents = path.join(appRoot, 'Commons.app', 'Contents');
  const binary = os === 'darwin' ? path.join(contents, 'MacOS', 'Commons') : output;
  await mkdir(path.dirname(binary), { recursive: true });
  console.log(`Building ${os}/${arch}…`);
  run(go, ['build', '-trimpath', '-buildvcs=false', '-ldflags', `-s -w -X main.version=${version}${os === 'windows' ? ' -H=windowsgui' : ''}`, '-o', binary, '.'], { env: { ...process.env, CGO_ENABLED: '0', GOOS: os, GOARCH: arch } });
  await chmod(binary, 0o755);
  if (os === 'darwin') {
    await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Commons</string>
<key>CFBundleDisplayName</key><string>Commons</string>
<key>CFBundleIdentifier</key><string>org.commons-events.portable</string>
<key>CFBundleExecutable</key><string>Commons</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>LSUIElement</key><true/>
</dict></plist>\n`);
    run(archiveTool, ['-source', appRoot, '-output', output]);
  }
  const bytes = await readFile(output);
  built.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  console.log(`${name}: ${(bytes.length / 1024 / 1024).toFixed(1)} MiB`);
}
await writeFile(path.join(releases, `SHA256SUMS-${version}.txt`), built.join('\n') + '\n');
await writeFile(path.join(releases, 'START-HERE.txt'), `Commons ${version} — portable local website

Send the recipient ONLY the matching file for their computer:
- Windows Intel/AMD: Commons-${version}-windows-x64.exe
- Windows ARM: Commons-${version}-windows-arm64.exe
- Linux Intel/AMD: Commons-${version}-linux-x64
- Linux ARM: Commons-${version}-linux-arm64
- Mac Intel: Commons-${version}-macos-intel.zip
- Mac Apple Silicon: Commons-${version}-macos-apple-silicon.zip

Windows: double-click the EXE. No installer or administrator access is needed.
Linux: allow executing the file in its Properties/Permissions, then open it.
       If the file manager does not launch programs, run ./Commons-${version}-linux-x64
       (or the arm64 filename) in a terminal. A desktop browser and xdg-open are expected.
macOS 12+: extract the ZIP, then double-click Commons.app. It can run from Downloads.

These are unsigned builds. Windows/macOS may require explicit permission to open
the downloaded application. On macOS use the per-app Open Anyway option in
System Settings > Privacy & Security after attempting to open the app.
Do not disable the computer's security protections globally.

The app opens http://127.0.0.1:4173 in your default browser. Keep this exact
address and browser profile to retain access to drafts and cached events.
Use Quit local app at the bottom of the page to stop the server. Closing a tab
alone leaves the server running. Opening the executable again reopens the app.
Before replacing the executable with an update, quit the running app first.

No Node.js, Go, Python, Docker, or separately installed web server is needed.
An existing modern browser is required. Internet is needed for live events,
map tiles, requested street-address lookups, remote posters, and OCR language downloads on first use.
The interface, city search and previously cached events work without internet.
Drafts belong to the browser profile, NOT the executable: export them to transfer
or back them up. Existing localhost:5173 or localhost:4173 drafts must be exported
and imported once because 127.0.0.1 is a different browser storage origin.

The local server serves only bundled files; it exposes no event proxy, upload,
shared database, or system files. Existing source CORS restrictions still apply.
Third-party notices: http://127.0.0.1:4173/THIRD-PARTY-NOTICES.txt
`);
console.log(`Portable bundles written to ${releases}`);
