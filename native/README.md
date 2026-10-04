# Offline native apps

The web client, cab chunk, mobile adapter, rehearsal worker and assets ship together from `dist/client`. No development-server URL or remote page is used by the native shells.

## Windows

Run `npm run native:desktop` to build and launch Electron. Run `npm run native:windows` to build an x64 NSIS installer into `releases`.

Electron opens a secure `rail-sim://app` origin. The renderer has no Node.js access; the preload exposes only app-private save operations and a close acknowledgement. Native saves use `%APPDATA%/Rail Sim/saves` (the exact user-data directory is reported by Electron), alternating checksummed generations and two recovery backups. Files are written to a temporary file, synchronized, and renamed. Closing waits for the current world and the write queue; a save failure keeps the window open. Uninstalling does not remove save data.

After a production build, `npm run test:native` opens a hidden sandboxed Electron instance with an isolated temporary save directory. It checks the packaged rehearsal worker, constructs and saves a regional railway through its public controls, closes from a running clock, reopens the world, and verifies the paused durable snapshot. It does not touch player saves. Set `RAIL_SIM_PACKAGED_EXE` to the built `win-unpacked/Rail Sim.exe` to run the same checks against the packaged ASAR application.

Release installers still need a publisher certificate/signing configuration and manual clean-machine/offline validation. Those credentials are deliberately absent from source.

## Android and iOS

The Capacitor configuration packages the same local `dist/client` assets. Initial platform generation is:

```powershell
npm run build
npx cap add android
npx cap add ios
node native/configure-mobile.cjs
npm run native:sync
```

Use Android Studio/Android SDK for Android builds. Use macOS with Xcode, Apple signing credentials and a physical iPhone for iOS builds; Windows cannot compile or sign an iOS application. `npm run native:android` and `npm run native:ios` open the relevant native IDE when available.

Run `node native/configure-mobile.cjs` after regeneration to apply sensor-landscape Android orientation, landscape-only iOS orientations, and the Filesystem timestamp privacy manifest to the App target's resources. The manifest uses the Filesystem plugin's documented `C617.1` reason; review future plugin changes before store submissions.

Saves use Capacitor Filesystem `Directory.Data`, not WebView localStorage. Android automatic cloud backup is disabled. Background transitions request a snapshot and flush, and pause play without offline progression. On browser builds IndexedDB provides the same generations, while the original localStorage worlds remain available as preserved migration sources. The original source is never replaced by automatic migration. Imported worlds with duplicate ids receive a fresh id.

Portable JSON formats and browser download/file-input controls are implemented. Android/iOS document export and sharing still need a native bridge and device verification; private save files are separate from user-transferable documents.

## Required device checks before release

- Start in airplane mode; build track, run a service, enter/exit the cab, save and reopen.
- Background and foreground repeatedly during train movement and saving. The clock must remain paused until the player chooses to resume.
- Transfer an exported world between Windows, Android and iOS and verify identical funds, cargo, services and project progress.
- Fill device storage, interrupt a write, and corrupt the newest recovery file. The app must report the failure and retain a previous valid generation.
- Run the regional benchmark for sustained thermal/memory checks on a physical Android phone and iPhone.

Source/configuration and automated storage tests do not establish these physical-device or store-release gates.

## Documentation consulted

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Capacitor Filesystem](https://capacitorjs.com/docs/apis/filesystem)
- [Capacitor app lifecycle](https://capacitorjs.com/docs/apis/app)
- [Capacitor configuration](https://capacitorjs.com/docs/config)
