# Vault Wars: Thief Script API & Starter Library

This page is the single source of truth for writing a thief script, by hand or with an AI assistant. **Tip: paste this whole page into your AI of choice before asking it to write or fix a script.**

Values marked *(default)* are tunable by the game and may change between engine versions. Check the engine version shown on your replay.

---

## 1. The basics

Your script defines one function, `tick(view)`. The game calls it **once per tick** and expects exactly one action back.

```js
function tick(view) {
  return wait();
}
```

- Your script is loaded once per run. Global variables persist between ticks, but only `view.memory` is guaranteed to be saved and size-capped. Prefer `view.memory`.
- Return one action. If you return nothing or something invalid, you `wait()` and take a **strike**. Three strikes ends the run.
- No network, no timers, no `Date`, no `Math.random`. Everything is deterministic.
- Coordinates: `x` grows to the right, `y` grows downward. `N` is `y - 1`, `S` is `y + 1`, `E` is `x + 1`, `W` is `x - 1`.

---

## 2. The `view` object

You only see what your line-of-sight allows (fog of war).

```ts
type View = {
  tick: number;                       // current tick, starts at 0
  pos: { x: number; y: number };      // your position
  visibleTiles: Tile[];               // tiles you can see right now
  guards: GuardView[];                // guards you can see right now
  cameras: CameraView[];              // cameras you can see right now
  items: ItemView[];                  // items you can see right now
  inventory: ItemView[];              // what you carry
  noise: number;                      // how loud you were last tick
  alarm: boolean;                     // is an alarm currently active
  memory: Record<string, any>;        // persists between ticks (size-capped)
};

type Tile = { x: number; y: number; type: TileType };
type TileType = 'floor' | 'wall' | 'door' | 'locked_door' | 'entry' | 'exit';

type GuardView = {
  id: string;
  pos: { x: number; y: number };
  facing: 'N' | 'E' | 'S' | 'W';
  state: 'patrol' | 'suspicious' | 'chase' | 'return';
  fov: number;                        // cone width in degrees
  range: number;                      // tiles
};

type CameraView = {
  id: string;
  pos: { x: number; y: number };
  facingDeg: number;                  // 0 = N, 90 = E, clockwise
  fov: number;
  range: number;
  disabled: boolean;
};

type ItemView = { id: string; kind: 'loot' | 'key' | 'gadget'; pos: { x: number; y: number } };
```

What you do **not** see: tiles behind walls, guards out of sight, a camera's sweep pattern (you have to watch it and learn it), and the vault's hidden layout.

---

## 3. Actions

All actions are helper functions that return an action object. Return exactly one per tick.

| Action | What it does | Noise *(default)* |
| --- | --- | --- |
| `move(dir)` | Step one tile in `N`, `E`, `S`, or `W`. Takes 1 tick. | loud (radius 6) |
| `sneak(dir)` | Step one tile slowly. Takes 2 ticks. | quiet (radius 1) |
| `wait()` | Do nothing this tick. | none |
| `grab(itemId)` | Pick up an item on your tile. | quiet |
| `pickLock(doorId)` | Pick an adjacent locked door. Takes about 3 ticks standing still. | quiet |
| `throwDistraction(tile)` | Throw a noise-maker at a tile within 5 tiles. Guards in range go to investigate. Limited uses. | loud at the target |
| `disableCamera(camId)` | Disable an adjacent camera for about 20 ticks. Takes 2-3 ticks standing still. | quiet |

A move into a wall or a locked door fails: you stay in place and it counts as a wasted tick (not a strike).

**Win:** carry the loot to the exit tile before the tick limit without being caught. **Caught:** a guard reaches your tile, or you end a tick inside a guard's vision cone while its state is `chase` and it is adjacent.

---

## 4. Built-in library: `lib`

These helpers are available as globals in every script. You can ignore them and write everything yourself, but they save a lot of code.

| Function | Returns | Notes |
| --- | --- | --- |
| `lib.remember(view)` | nothing | Merges `view.visibleTiles` and `view.items` into `view.memory.map` and `view.memory.items`. Call it first every tick. |
| `lib.dist(a, b)` | number | Manhattan distance between two positions. |
| `lib.dirTo(from, to)` | `'N' \| 'E' \| 'S' \| 'W'` | Direction of one adjacent step from `from` to `to`. |
| `lib.findTile(map, type)` | position or `null` | First known tile of a type, such as `'exit'`. |
| `lib.findPath(map, from, to, opts)` | array of positions or `null` | BFS over known walkable tiles. `opts.avoid(tile)` can return `true` to block a tile. The path excludes `from`. |
| `lib.frontier(map, from)` | position or `null` | Nearest known floor tile that touches an unknown tile. Use it to explore. |
| `lib.inCone(source, pos, tick)` | boolean | Is `pos` inside this guard's or camera's vision cone right now (ignores walls)? |
| `lib.threatened(view, pos)` | boolean | Is `pos` inside any currently visible guard or active camera cone? |

The library only knows what you have seen. A route through unexplored space returns `null`.

---

## 5. Memory

`view.memory` is a plain object that is saved between ticks. It is size-capped *(default 16 KB when serialized)*. If it grows past the cap, the oldest map entries are dropped and your run takes a warning in the console. Store compact data: tile maps as small keys, timing logs as short arrays.

Common uses:

- The map you have explored (`lib.remember` does this for you).
- A log of when you saw each camera pointing at a given angle, so you can predict its sweep.
- A plan (list of positions to follow) so you do not recompute the path every tick.

---

## 6. Starter scripts

These ship as templates in the editor. Start from one and change it.

### Script A: Walker (the starter)

Walks to the loot, grabs it, walks to the exit. Ignores guards. Dies fast, but it is the right first run to see how everything works.

```js
function tick(view) {
  lib.remember(view);
  const m = view.memory.map;
  const hasLoot = view.inventory.some(i => i.kind === 'loot');
  const loot = view.memory.items.find(i => i.kind === 'loot');
  const goal = hasLoot ? lib.findTile(m, 'exit') : loot && loot.pos;

  // Standing on the loot: pick it up.
  if (loot && !hasLoot && lib.dist(view.pos, loot.pos) === 0) return grab(loot.id);

  // Don't know where to go yet: explore.
  if (!goal) return explore(view);

  const path = lib.findPath(m, view.pos, goal, {});
  if (!path || path.length === 0) return explore(view);
  return move(lib.dirTo(view.pos, path[0]));
}

function explore(view) {
  const target = lib.frontier(view.memory.map, view.pos);
  if (!target) return wait();
  const path = lib.findPath(view.memory.map, view.pos, target, {});
  return path && path.length ? move(lib.dirTo(view.pos, path[0])) : wait();
}
```

### Script B: Careful Walker

Same as A, but routes around tiles that a visible guard or camera is currently watching, and sneaks when a guard is within 8 tiles.

```js
function tick(view) {
  lib.remember(view);
  const m = view.memory.map;
  const hasLoot = view.inventory.some(i => i.kind === 'loot');
  const loot = view.memory.items.find(i => i.kind === 'loot');
  const goal = hasLoot ? lib.findTile(m, 'exit') : loot && loot.pos;

  if (loot && !hasLoot && lib.dist(view.pos, loot.pos) === 0) return grab(loot.id);
  if (!goal) return explore(view);

  const path = lib.findPath(m, view.pos, goal, {
    avoid: t => lib.threatened(view, t),
  });
  if (!path || path.length === 0) return wait();   // no safe route right now: hold still

  const dir = lib.dirTo(view.pos, path[0]);
  const guardNear = view.guards.some(g => lib.dist(g.pos, view.pos) <= 8);
  return guardNear ? sneak(dir) : move(dir);
}

function explore(view) {
  const target = lib.frontier(view.memory.map, view.pos);
  if (!target) return wait();
  const path = lib.findPath(view.memory.map, view.pos, target, {
    avoid: t => lib.threatened(view, t),
  });
  return path && path.length ? sneak(lib.dirTo(view.pos, path[0])) : wait();
}
```

### Script C: Camera Timer

Watches a sweeping camera, records how long one full sweep takes, then only crosses its cone while it is pointing away.

```js
function tick(view) {
  lib.remember(view);
  const mem = view.memory;
  mem.camLog = mem.camLog || {};   // camId -> list of [tick, facingDeg]

  for (const c of view.cameras) {
    const log = (mem.camLog[c.id] = mem.camLog[c.id] || []);
    if (log.length < 60) log.push([view.tick, Math.round(c.facingDeg)]);
  }

  // Stand still and observe for the first 20 ticks if a camera is visible.
  if (view.cameras.length > 0 && view.tick < 20) return wait();

  // After that, hand off to the careful walker, but only step into a
  // camera cone tile if that camera is currently pointing at least 45 degrees away.
  return carefulStep(view);
}

function carefulStep(view) {
  const m = view.memory.map;
  const hasLoot = view.inventory.some(i => i.kind === 'loot');
  const loot = view.memory.items.find(i => i.kind === 'loot');
  const goal = hasLoot ? lib.findTile(m, 'exit') : loot && loot.pos;
  if (loot && !hasLoot && lib.dist(view.pos, loot.pos) === 0) return grab(loot.id);
  if (!goal) return wait();

  const path = lib.findPath(m, view.pos, goal, { avoid: t => lib.threatened(view, t) });
  return path && path.length ? sneak(lib.dirTo(view.pos, path[0])) : wait();
}
```

This one is a skeleton: the next step is to use `mem.camLog` to predict when the camera will point away, then time your crossing. That prediction is the fun part.

### Script D: Distraction Decoy

Throws a noise-maker to pull a nearby guard away from the path, then moves while the guard is busy.

```js
function tick(view) {
  lib.remember(view);
  const mem = view.memory;
  const guard = view.guards.find(g => lib.dist(g.pos, view.pos) <= 6);

  // One throw per run, aimed 4 tiles away from our own direction of travel.
  if (guard && !mem.threw && guard.state === 'patrol') {
    const target = { x: guard.pos.x + (guard.pos.x >= view.pos.x ? 4 : -4), y: guard.pos.y };
    mem.threw = true;
    return throwDistraction(target);
  }

  // Otherwise behave like the careful walker.
  const m = mem.map;
  const hasLoot = view.inventory.some(i => i.kind === 'loot');
  const loot = mem.items.find(i => i.kind === 'loot');
  const goal = hasLoot ? lib.findTile(m, 'exit') : loot && loot.pos;
  if (loot && !hasLoot && lib.dist(view.pos, loot.pos) === 0) return grab(loot.id);
  if (!goal) return wait();
  const path = lib.findPath(m, view.pos, goal, { avoid: t => lib.threatened(view, t) });
  return path && path.length ? sneak(lib.dirTo(view.pos, path[0])) : wait();
}
```

### Script E: Blank skeleton

```js
function tick(view) {
  lib.remember(view);
  // 1. Where am I, what do I see?
  // 2. What is my goal right now? (loot, exit, explore, hide)
  // 3. Is the next step safe this tick?
  // 4. Return exactly one action.
  return wait();
}
```

---

## 7. Limits

| Limit | Value *(default)* |
| --- | --- |
| CPU per tick | 20 ms (timeout means `wait()` plus a strike) |
| Strikes before the run ends | 3 |
| Total CPU per run | 2 s |
| Memory | 32 MB |
| Script size | 20 KB |
| `view.memory` size | 16 KB serialized |
| Console output | 200 lines, 200 characters each |
| Tick limit | set by the vault, shown on the vault card |

---

## 8. Errors you may see

| Message | Meaning | Fix |
| --- | --- | --- |
| `strike: timeout` | `tick` took longer than the per-tick limit. | Remove heavy loops. Cache paths in `memory`. |
| `strike: invalid action` | You returned something that is not an action. | Always `return` one of the action helpers. |
| `strike: exception` | Your code threw. The message and line number follow. | Fix the bug. Check `null` before using `findTile` and `findPath` results. |
| `script_error: memory` | You exceeded the memory cap. | Store less. Do not build huge arrays. |
| `script_error: too many strikes` | Three strikes. The run ended and counts as caught. | Look at the earlier strikes in the console. |
| `caught: guard` / `caught: camera alarm` | What caught you, with the tick and positions. | Use the replay scrubber to see the exact tick. |

---

## 9. Failure report (for pasting into your AI)

Every failed run has a **Copy failure report** button. The report is plain text like this:

```
Result: caught at tick 34 (guard G2, state chase)
Engine: 1.0.0   Vault: v_8f2c   Seed: 91823
Last 5 thief positions: (6,3) (7,3) (7,4) (7,5) (7,6)
Visible at tick 33: guard G2 at (9,6) facing W, state suspicious; camera C1 at (7,1) facing 140deg, active
Alarms: C1 at tick 31 (sighting at (7,3))
Strikes: 0
Console (last 5 lines): ...
```

Paste it with your script and ask the AI to explain what went wrong and propose a fix.

---

## 10. Prompt template for AI assistants

Copy this, fill in the brackets, and paste it after this page:

```
I'm writing a thief script for Vault Wars using the API above.

Here is my current script:
[paste script]

Here is the failure report from my last run:
[paste report]

Please:
1. Explain in two sentence
3. Give me the full updated scrs why the thief was caught.
2. Suggest one change to the strategy.ipt. Keep it under 20 KB, only use the
   actions and lib functions documented above, and never return anything
   except one action from tick().
```

Ask for **one change at a time**. Players who change five things at once cannot tell what helped.

---

## 11. Tips from the design team

- Run the Walker once on every new vault just to learn the layout. Your `memory.map` is aempty at the strt of each run, so that run cannot teach the next one. Use the **replay** to study the layout instead.
- Guards follow patrol routes. If you can see one for 10 ticks, you can usually predict where it will be.
- Sneaking costs time but makes no noise. Moving is fast and loud. The best scripts switch between them.
- Waiting behind a corner is often the strongest move in the game.
- A vault that nobody has beaten yet is not always unbeatable. Check its stats: many have a tiny but real win rate.

---

## 12. Changelog and versioning

This page is versioned together with the game engine. Every replay shows its `engineVersion`. When the rules change, the old version of this page stays available, so old replays still make sense.

| Engine | Notes |
| --- | --- |
| 1.0.0 | First release: actions, `lib`, memory, limits as described above. |
