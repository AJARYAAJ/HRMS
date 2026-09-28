import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { httpError } from '../utils.js';

/**
 * Public downloads for the desktop activity agent (built with `npm run agent:build`) and one-line
 * installers. Binaries aren't secret: a device only reports data once it has a token issued in the HRMS.
 */
export const agentDownloadsRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = () => process.env.AGENT_DIST_DIR || path.join(__dirname, '..', '..', '..', 'agent', 'dist');

export const AGENT_BUILDS = [
  { file: 'peoplehub-agent-windows-amd64.exe', os: 'windows', arch: 'amd64', label: 'Windows (64-bit Intel/AMD)' },
  { file: 'peoplehub-agent-windows-arm64.exe', os: 'windows', arch: 'arm64', label: 'Windows on ARM' },
  { file: 'peoplehub-agent-macos-arm64.zip', os: 'macos', arch: 'arm64', label: 'macOS (Apple silicon)' },
  { file: 'peoplehub-agent-macos-amd64.zip', os: 'macos', arch: 'amd64', label: 'macOS (Intel)' },
];

const hashes = new Map(); // file -> { mtime, sha256 }
function sha256(file) {
  const st = fs.statSync(file);
  const hit = hashes.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.sha256;
  const sum = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  hashes.set(file, { mtime: st.mtimeMs, sha256: sum });
  return sum;
}

function versionOf() {
  try { return fs.readFileSync(path.join(distDir(), 'VERSION'), 'utf8').trim(); } catch { return null; }
}

agentDownloadsRouter.get('/', (req, res) => {
  const files = AGENT_BUILDS.flatMap((b) => {
    const f = path.join(distDir(), b.file);
    if (!fs.existsSync(f)) return [];
    return [{ ...b, size: fs.statSync(f).size, sha256: sha256(f), url: `/api/agent-downloads/${b.file}` }];
  });
  res.json({ version: versionOf(), files });
});

// The server's public origin, used inside the installer scripts. Only a plain scheme://host[:port] is accepted.
function origin(req) {
  const o = `${req.protocol}://${req.get('host')}`;
  if (!/^https?:\/\/[A-Za-z0-9.\-:[\]]+$/.test(o)) throw httpError(400, 'Invalid host');
  return o;
}

const INSTALL_SH = (server) => `#!/bin/sh
# PeopleHub desktop agent installer for macOS.
# Usage: curl -fsSL ${server}/api/agent-downloads/install.sh | PEOPLEHUB_TOKEN=<device token> sh
set -eu
SERVER="${server}"
TOKEN="\${PEOPLEHUB_TOKEN:-\${1:-}}"
if [ -z "$TOKEN" ]; then echo "Set PEOPLEHUB_TOKEN to the device token from PeopleHub → Productivity → Devices." >&2; exit 1; fi
if [ "$(uname -s)" != "Darwin" ]; then echo "This installer is for macOS." >&2; exit 1; fi
case "$(uname -m)" in arm64) ARCH=arm64 ;; x86_64) ARCH=amd64 ;; *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;; esac
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Downloading the PeopleHub agent for macOS ($ARCH)…"
curl -fsSL "$SERVER/api/agent-downloads/peoplehub-agent-macos-$ARCH.zip" -o "$TMP/agent.zip"
/usr/bin/ditto -x -k "$TMP/agent.zip" "$TMP"
chmod +x "$TMP/peoplehub-agent"
"$TMP/peoplehub-agent" setup --server "$SERVER" --token "$TOKEN"
`;

const INSTALL_PS1 = (server) => `# PeopleHub desktop agent installer for Windows.
# Usage (PowerShell): $env:PEOPLEHUB_TOKEN='<device token>'; irm ${server}/api/agent-downloads/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$server = '${server}'
$token = $env:PEOPLEHUB_TOKEN
if (-not $token) { throw 'Set $env:PEOPLEHUB_TOKEN to the device token from PeopleHub -> Productivity -> Devices.' }
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'amd64' }
$exe = Join-Path $env:TEMP ("peoplehub-agent-" + [guid]::NewGuid().ToString() + ".exe")
Write-Host "Downloading the PeopleHub agent for Windows ($arch)..."
Invoke-WebRequest -UseBasicParsing -Uri "$server/api/agent-downloads/peoplehub-agent-windows-$arch.exe" -OutFile $exe
$log = "$exe.log"
$p = Start-Process -FilePath $exe -ArgumentList @('setup', '--server', $server, '--token', $token) -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $log
Get-Content $log | Write-Host
Remove-Item $exe, $log -ErrorAction SilentlyContinue
Remove-Item Env:\\PEOPLEHUB_TOKEN -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { throw "PeopleHub agent setup failed (exit code $($p.ExitCode))." }
`;

agentDownloadsRouter.get('/install.sh', (req, res) => {
  res.type('text/x-shellscript').set('Cache-Control', 'no-store').send(INSTALL_SH(origin(req)));
});

agentDownloadsRouter.get('/install.ps1', (req, res) => {
  res.type('text/plain').set('Cache-Control', 'no-store').send(INSTALL_PS1(origin(req)));
});

agentDownloadsRouter.get('/:file', (req, res) => {
  const build = AGENT_BUILDS.find((b) => b.file === req.params.file);
  const file = build && path.join(distDir(), build.file);
  if (!file || !fs.existsSync(file)) throw httpError(404, 'This agent build is not available on the server. Run `npm run agent:build`.');
  res.set('X-Content-Type-Options', 'nosniff');
  res.download(file, build.file, { headers: { 'Content-Type': build.file.endsWith('.zip') ? 'application/zip' : 'application/vnd.microsoft.portable-executable' } });
});
