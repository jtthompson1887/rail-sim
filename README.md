# Rail Sim

A terrain-aware railway management game in development: design a railway,
rehearse its operation, and transform a region. Generated landscapes offer
construction, food and recycling supply chains, automated freight and passenger
services, and regional development projects. Offline native shells share the
same gameplay with the browser build.

## Regional play

Create a region with a landscape preset and difficulty, then open **Railway**.
New regions start paused. Use **Plans** to sketch an industry connection or a
passing loop; the quoted design can include platforms, trains and services.
Choose **Fleet** to buy a train and **Services** to choose its stops. Freight
loads at its first stop and unloads at subsequent stops. Start the clock with
1×, 2× or 4×; construction tools remain available independently.

**Plans** runs detached ghost rehearsals and keeps two saved alternatives.
Engineering results and demand assumptions are shown separately. **Projects**
offers developments whose deliveries and passenger arrivals change both the
landscape and future traffic. **Company** provides liveries, durable saving and
portable JSON world files and browser import/export. Native Android/iOS
document sharing remains a platform task. Compatible older worlds retain their original
gameplay until **Start regional play** is selected.

This is an implemented development slice, not a release candidate. See
[implementation status and remaining gates](docs/full-game/IMPLEMENTATION.md).

## Construction

1. Create a world from the main menu.
2. Press `P` or choose **Place**.
3. Drag between two points to survey a route.
4. Review grade, structures, engineering cost, topology cost, and remaining
   cash before choosing **Build**.
5. Continue from an open endpoint to chain track, or use **Step back** and
   **Cancel** to revise the route.

Track cannot be built outside the map, through an existing railway, with an
unsafe curve or grade, or when the company cannot afford it. Bridges, tunnels,
cut, fill, demolition refunds, undo/redo, and save/reload all use the same
authoritative construction data.

## Controls

| Control | Action |
| --- | --- |
| `P` | Track construction |
| Drag | Survey a route |
| `Enter` | Confirm an available action |
| `Escape` | Cancel the current placement |
| Right-click | Step back during placement, or open a context menu |
| `Delete` | Begin the selected-track demolition review |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` | Save or retry a failed save |
| `H` | Pan tool |
| `C` | Toggle 3-D cab view (play mode) |
| `Q` / `E` | Zoom in / out |
| Mouse wheel | Zoom |
| Middle drag | Pan |

## Development

```powershell
npm install
npm start
```

Release gates:

```powershell
npm test -- --runInBand
npx playwright test --retries=0
npm run benchmark:construction-drag
npm run benchmark:world-generation
npm run benchmark:train-physics
npm run benchmark:train-physics-browser
npm run benchmark:rehearsal
npm run build
npm run test:native
git diff --check
```

Native development:

```powershell
npm run native:desktop
npm run native:windows
npm run native:sync
npm run native:android
npm run native:ios
```

Android needs a configured Android SDK/JDK. Building iOS requires macOS/Xcode.
Device suspend/resume, memory and thermal testing are required before release.

The long-term design and milestone plans live in `docs/superpowers`.
