# Rail Sim

A terrain-aware railway management game in development. Every new game starts
from a generated, empty landscape: the player surveys route opportunities,
builds a railway that fits the terrain and budget, and grows it into a modern
freight network.

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
npm run build
```

The long-term design and milestone plans live in `docs/superpowers`.
