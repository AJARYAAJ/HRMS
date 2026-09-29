# PeopleHub desktop agent

A small background program for **Windows 10/11** and **macOS 12+**. Every few seconds it records which application
is in focus and whether the person is active or idle, and sends that to PeopleHub once a minute. PeopleHub then
builds the productivity analytics: the live board, timelines, app and website usage, and alerts.

- A single ~3–7 MB executable with no runtime to install. It is written in Go: the standard library, plus [purego](https://github.com/ebitengine/purego) on macOS for the menu bar icon (so it builds without Xcode or cgo).
- It starts at login in the user's session and uses almost no CPU.
- Nothing is lost when offline: activity is queued on disk for up to 7 days and uploaded when the connection returns.
- It stops by itself when an admin revokes the device in PeopleHub.
- A tray icon (Windows notification area, macOS menu bar) shows what it's doing and lets people take a break.

## What is collected

| Collected | Details |
| --- | --- |
| Application name | e.g. "Google Chrome", "Microsoft Excel" |
| Window title | e.g. the document or tab name. On macOS this needs Accessibility permission |
| Website **domain** | e.g. `github.com`, for Chrome, Edge, Brave, Safari and other Chromium browsers. The full URL, path and query never leave the computer |
| Active vs idle seconds | Idle means no keyboard or mouse input for the idle threshold (Settings, default 2 minutes). After the away limit (default 60 minutes) the agent stops recording until the person returns |
| Screenshots | **Only if an admin turns them on** (Productivity → Settings), at a jittered interval, only while the person is active. They are visible to the employee, their managers and HR |
| Agent version, OS, computer name | Shown to admins in Productivity → Devices |

The agent never records keystrokes, clipboard contents, files, microphone, camera or full URLs.

## Tray icon

The agent shows the PeopleHub icon in the Windows notification area or the macOS menu bar. A coloured dot shows
the state:

| Dot | Meaning |
| --- | --- |
| Green | tracking activity |
| Amber | idle, or paused |
| Grey | away, or offline (uploads are queued) |
| Red | stopped: the device was revoked |

Clicking the icon opens a menu with:

- the current status, the last upload time, and whether screenshots are on;
- **Pause for 15 minutes / 1 hour**, then **Resume tracking**. These only appear if the admin allows pausing
  (Productivity → Settings → "Let employees pause tracking", on by default). While paused nothing is recorded, and
  managers see the person as *Paused* on the live board, not *Offline*;
- **View my activity**, which opens the employee's own timeline in PeopleHub;
- **Open PeopleHub**;
- the agent version.

On Windows, the first start shows a one-time notification that activity is shared with PeopleHub. The icon comes
back by itself if Explorer restarts.

The icon needs a desktop session. Over SSH, or on a server without a shell, the agent runs normally without it.
Set `PEOPLEHUB_AGENT_NO_TRAY=1` to hide the icon, for example on shared kiosks.

## Installing

An admin (or the employee) registers the computer in **PeopleHub → Productivity → Devices → Register device**.
The dialog shows the device token once, with three ways to install:

1. **Windows, one line in PowerShell:**
   ```powershell
   $env:PEOPLEHUB_TOKEN='phd_…'; irm https://hr.example.com/api/agent-downloads/install.ps1 | iex
   ```
2. **macOS, one line in Terminal:**
   ```sh
   curl -fsSL https://hr.example.com/api/agent-downloads/install.sh | PEOPLEHUB_TOKEN='phd_…' sh
   ```
3. **Without a terminal:** download the agent for your system and the `peoplehub-agent.json` setup file into the
   same folder, then open the agent. It installs itself, starts, and deletes the setup file (which holds the token).

For IT tooling (Intune, Jamf, scripts), run:

```
peoplehub-agent setup --server https://hr.example.com --token phd_…
```

Setup copies the agent to a per-user folder, turns on start at login, and starts tracking:

| | Program and data | Start at login |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\PeopleHub\peoplehub-agent.exe`, data in `%APPDATA%\PeopleHub` | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` → `PeopleHubAgent` |
| macOS | `~/Library/Application Support/PeopleHub/` | `~/Library/LaunchAgents/com.peoplehub.agent.plist`, restarted by launchd if it crashes |

It runs per user, in the login session. A Windows service or a macOS LaunchDaemon cannot see the user's desktop,
so neither would work for activity tracking.

### macOS permissions

macOS asks for these once. You can grant them in advance under **System Settings → Privacy & Security**:

| Permission | Used for | Without it |
| --- | --- | --- |
| Accessibility | window titles | titles are left empty; app names still work |
| Automation (per browser) | reading the active tab's address | the website isn't recorded, only the browser |
| Screen Recording | screenshots (only when enabled) | screenshots show just the desktop background |

`peoplehub-agent check` takes one sample and saves a test screenshot, so you can confirm the permissions work.

### Unsigned builds

These builds are not code-signed. Signing needs an Apple Developer ID and a Windows code-signing certificate,
which belong to your organisation.

- The one-line installers download with PowerShell or curl, so **no warning** appears.
- A **browser-downloaded** copy triggers a warning. On Windows, SmartScreen shows "Windows protected your PC";
  choose *More info → Run anyway*. On macOS, Gatekeeper blocks it; right-click → *Open*, or use *System Settings →
  Privacy & Security → Open Anyway*, or run `xattr -d com.apple.quarantine peoplehub-agent`.
- Updating the agent on macOS may ask for the permissions again, because the ad-hoc signature changes.

To sign for production: sign the Windows `.exe` with `signtool`. For macOS, `codesign --options runtime` the
binary with a Developer ID, then notarize it.

## Commands

```
peoplehub-agent setup --server <url> --token <token> [--name <device>] [--no-autostart] [--no-start]
peoplehub-agent status      connection, running state, last upload, queued events, last error
peoplehub-agent check       one sample now + a test screenshot (permission check)
peoplehub-agent run         run in the foreground (what start at login runs)
peoplehub-agent install     start at login
peoplehub-agent uninstall   stop and remove start at login
peoplehub-agent reset       stop, remove start at login, delete the token and queued data
peoplehub-agent version
```

On Windows the program is built as a GUI app, so no console window flashes at login. From a terminal, commands
print to that terminal. Opened by double-click, results appear in a message box. In PowerShell, add
`| Out-String` so the prompt waits for output: `.\peoplehub-agent.exe status | Out-String`.

Logs are written to `agent.log` in the data folder (rotated at 5 MB).

## How it works

- **Sampling:** every 5 seconds it reads the foreground window and the time since the last input. Time between two
  samples is credited to the first. Gaps (sleep or hibernate) are not credited.
  - **Windows:** Win32 calls `GetForegroundWindow`, `GetLastInputInfo` and `QueryFullProcessImageName`. App names
    come from the executable's version resource. UWP apps are resolved through `ApplicationFrameHost`. Browser
    addresses are read via UI Automation by a hidden PowerShell helper, only while a browser is focused.
  - **macOS:** built-in tools. `lsappinfo` gives the frontmost app (no permission needed), `ioreg` the idle time,
    `osascript` the window title and browser tab, and `screencapture` the screenshots.
- **Events:** samples roll up into one event per app or site per minute (`POST /api/agent/heartbeat`, up to 200 per
  request), sent every 60 seconds. On failure it backs off (15 s up to 5 min) and keeps queuing.
- **Settings** come from `GET /api/agent/config`, refreshed every 10 minutes: screenshots on or off, interval,
  idle threshold and away limit.
- **Screenshots:** the whole virtual desktop on Windows, the main display on macOS. They are downscaled to 1600 px
  wide and sent as JPEG.

## Building and testing

Requires Go 1.23+.

```sh
npm run agent:build      # cross-compiles all four builds into agent/dist (served by PeopleHub automatically)
npm run agent:test       # unit tests: minute roll-up, offline queue, uploads, outages, idle/away, pause, revocation, tray menu and icons
```

| Build | File |
| --- | --- |
| Windows x64 | `peoplehub-agent-windows-amd64.exe` |
| Windows ARM64 | `peoplehub-agent-windows-arm64.exe` |
| macOS Apple silicon | `peoplehub-agent-macos-arm64.zip` |
| macOS Intel | `peoplehub-agent-macos-amd64.zip` |

The macOS builds are zipped so the executable bit survives a browser download. The PeopleHub server serves
`agent/dist`; set `AGENT_DIST_DIR` to serve a different folder.

The **Desktop agent** GitHub Actions workflow (`.github/workflows/agent.yml`) runs:

- the Go tests on Linux, Windows and macOS. On Windows and macOS these include creating the real tray/menu-bar
  icon and menu;
- on real Windows and macOS runners: starts PeopleHub, installs the agent with the one-line installer, waits for
  its first upload, then uninstalls it;
- the cross-compile, uploaded as an artifact and attached to GitHub releases.

On Linux, `PEOPLEHUB_AGENT_FAKE=1` switches to a scripted platform for development against a server. Linux is not a
supported target.
