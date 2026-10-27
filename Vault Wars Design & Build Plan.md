# Vault Wars: Design & Build Plan

A two-sided programming game. Everyone plays **designer** (build a vault on a budget) and **thief** (write a JS script that breaks into other players' vaults). Runs are deterministic, so every heist can be replayed and shared.

---

## 1. Game overview

**Core loop**

1. Design a vault on a grid within a coin budget (walls, doors, guards, cameras, lasers, locks).
2. Write a thief script in the browser editor.
3. Run it against another player's vault. The server simulates it and returns a replay.
4. Watch the replay, fix the script, retry.
5. Both thief and vault ratings update (Elo).

**Win conditions**

- Thief wins a run: grabs the loot and reaches the exit before the tick limit without being caught.
- Score = loot value + speed bonus - alarms triggered. A partial run (loot grabbed, then caught) still earns a little.
- Ghost run: no alarms, no guard ever sees you.
- Designer wins when thieves fail. Target a win rate of about 20-40% for a "hard but fair" vault.

**Progression**

- Separate Elo for thief and designer, ranked tiers (Bronze to Master).
- Daily vault: everyone attacks the same vault, leaderboard by score and tick count.
- Monthly seasons with soft rating resets and badges.
- Gadget unlocks (EMP, grappling hook, better lock picks) from milestones.
- Achievements: Ghost, Speedrun, Cracked a Master vault.

---

## 2. World rules

- Grid-based, turn-based ticks. Each tick every entity acts once.
- Fog of war: the thief only sees what its line-of-sight allows.
- Noise: `move` is fast but loud, `sneak` is slow but quiet. Guards that hear noise become suspicious.
- Guard state machine: patrol, suspicious, chase, return to patrol.
- Cameras: fixed position, a vision cone, optional sweep pattern. A sighting raises an alarm and guards path to the last known position.
- All randomness comes from one seeded RNG. No real time anywhere in the sim.

**Thief script API**

```javascript
function tick(view) {
  // view: pos, visibleTiles, guards, cameras, inventory, memory
  if (view.canSee('vault_door')) return move('toward', 'vault_door');
  return sneak(dirOfNextWaypoint());
}
```

Actions: `move(dir)`, `sneak(dir)`, `wait()`, `pickLock(door)`, `grab(item)`, `throwDistraction(tile)`, `disableCamera(cam)`.

A `memory` object persists between ticks (size-capped) so scripts can remember what they explored.

---

## 3. System architecture

```
Browser (React)
  vault editor, Monaco, replay viewer (reuses /engine)
  REST + SSE
        |
   API (Fastify, stateless)
        |-- Postgres (users, vaults, scripts, runs, ratings)
        |-- Redis -- BullMQ queue
                       |
                  Workers (N, separate processes)
                    |-- /engine (pure sim)
                    |-- isolated-vm sandbox
                       |
                 Object storage (replays, gzip)
```

**Heist request flow**

1. Client: `POST /heists { vaultId, scriptId }`.
2. API validates (script is yours, vault is public and not yours, rate limit), inserts a `runs` row with `status=queued` and a fixed `seed`, enqueues a job.
3. Worker loads vault and script, runs the engine tick by tick.
4. Worker writes the replay, then in one transaction updates the run result and both Elo ratings and sets `status=done`.
5. Client is notified over SSE (or polling) and opens the replay.

Jobs are idempotent (keyed by `runId`). Check `status` inside the transaction so a retry cannot double-apply ratings.

---

## 4. Engine package (`/engine`)

Pure TypeScript. No I/O, no `Date`, no `Math.random`. Shared by the server (official results) and the browser (replay viewer).

```ts
runHeist(vault, thiefAgent, seed, limits) -> { events: TickEvent[], result }
```

`thiefAgent` is `(view) => Action`. In the browser it is a plain function; on the server it wraps the sandbox. The engine does not care which.

**Per tick**

1. Build each entity's view (line-of-sight via Bresenham or shadow casting).
2. Get the thief's action from the agent.
3. Update guards (patrol or chase, A\* toward last known position).
4. Update cameras and check sightings.
5. Resolve interactions: caught, alarm, item grabbed.
6. Log the tick event.
7. Stop on escape, caught, or tick limit.

---

## 5. Code execution sandbox

One `isolated-vm` isolate per run, created at job start and disposed at the end. `tick(view)` is called every tick in the same isolate, so globals persist naturally.

**Boundary rules**

- Only JSON strings cross the boundary. Never pass references or functions.
- Validate every returned action with a schema (zod).
- Fresh fog-of-war `view` each tick.
- Freeze prototypes. Disable `Math.random` and `Date.now`.

**Limits**

| Limit | Value |
| --- | --- |
| Per-tick CPU | about 20 ms (timeout = wait + strike) |
| Strikes | 3 strikes ends the run |
| Per-run CPU budget | about 2 s |
| Memory | 32 MB |
| Script size | about 20 KB |
| Log lines | 200 |

**Process isolation**

- Run workers as separate processes so a native crash cannot take down the API.
- Wall-clock kill timer per job (about 10 s).
- In production: Docker with CPU/memory limits, no network, read-only filesystem.

**Determinism note:** wall-clock timeouts are slightly non-deterministic, but replays store the thief's actions, not the script execution, so replays never re-run the sandbox. For strict determinism later, switch to QuickJS-WASM with instruction counting.

**Malicious-script test suite (write early)**

- `while(true){}` (timeout)
- Memory bomb (push huge arrays forever)
- Prototype pollution and `constructor.constructor('return process')()` escape attempts
- Huge output strings
- `console.log` spam
- Syntax error script (clean `script_error`)

---

## 6. Cameras

A camera is a guard that never moves: position, facing, cone, and a rotation pattern. It reuses the same line-of-sight code as guards.

```ts
type Camera = {
  id: string;
  pos: { x: number; y: number };
  facing: number;          // degrees, 0 = N, 90 = E
  fov: number;             // cone width, e.g. 60
  range: number;           // tiles, e.g. 6
  pattern: 'fixed' | 'sweep';
  sweepMin?: number;
  sweepMax?: number;
  sweepPeriod?: number;    // ticks for one back-and-forth
  disabledUntil?: number;
};
```

**Facing at tick t** is a pure function of the tick (no stored rotation state), which keeps the sim deterministic:

```ts
function cameraFacing(cam: Camera, tick: number): number {
  if (cam.pattern === 'fixed') return cam.facing;
  const phase = (tick % cam.sweepPeriod!) / cam.sweepPeriod!;
  const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return cam.sweepMin! + tri * (cam.sweepMax! - cam.sweepMin!);
}
```

**Sighting check** (cheapest first): range, then inside the cone (normalize angles to 0-360, watch wraparound), then line-of-sight (walls block).

**On sighting:** raise an alarm event with the last known position, guards switch to suspicious or chase and path there. Add a cooldown so one camera does not retrigger every tick.

**Thief interaction:** `disableCamera(id)` works only when adjacent, takes 2-3 ticks standing still, and disables the camera for about 20 ticks. Sneaking can shrink effective range or fov.

**Rendering:** draw the cone by casting rays across the fov (every 2 degrees) and stopping each at the first wall. Use the same math as the engine so the replay matches the decisions.

**Tests:** thief on the cone edge, just inside, just outside; wall between camera and thief; sweep at tick 0, mid-period, period end; same seed twice gives identical alarm logs.

---

## 7. Replay format

Store the full event log for now (simple and safe against engine changes). Optimize later.

```json
{ "engineVersion": "1.0.0", "vault": {}, "seed": 91823,
  "actions": [], "events": [], "result": {} }
```

Version the engine on every run. If guard AI changes later, old replays would desync unless the full event log is stored or the old engine build is kept.

Viewer features: scrubber, guard and camera cone overlay, heat map of the thief's path, console log panel, share link.

---

## 8. Data model

- `users(id, handle, ...)`
- `vaults(id, owner_id, layout jsonb, cost, version, published, rating, created_at)`
- `scripts(id, owner_id, source, hash, created_at)`: immutable, edits create a new row
- `runs(id, thief_id, script_id, vault_id, seed, status, result jsonb, replay_key, engine_version, created_at)`
- `ratings(user_id, role, elo, games)`: roles are `thief` and `designer`

Indexes: `runs(vault_id, created_at)`, `runs(thief_id, created_at)`, `vaults(published, rating)`.

---

## 9. Matchmaking and ratings

- A run is a match between a thief and a vault. Result can be a score fraction, not just win/loss.
- Update thief Elo and vault Elo in the same transaction, with `SELECT ... FOR UPDATE` on rating rows.
- "Suggest a vault": published vaults within a rating window, excluding your own and recently played ones.
- Leaderboards: cached (Redis sorted set or a materialized view refreshed every minute).

---

## 10. Validation and anti-abuse

- Vault validation on save (in the engine package): within budget, in bounds, BFS path from entry to loot exists, patrol routes valid, and at least one safe window past cameras (BFS over x, y, tick mod LCM of periods).
- Run limits: per-user rate limit, max queue depth, job timeout.
- Rating farming: cannot attack your own vaults; discount repeat runs on the same vault.

---

## 11. Tech stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript everywhere |
| Monorepo | pnpm workspaces (`engine`, `web`, `api`, `worker`) |
| API | Fastify |
| Sandbox | `isolated-vm` (QuickJS-WASM as the alternative) |
| DB | Postgres |
| Queue | BullMQ + Redis |
| Replays | gzip JSON in Postgres or S3/R2 |
| Frontend | React + Vite, Canvas 2D, Monaco, Zustand |
| Infra | Docker Compose locally, a single VPS or Fly.io |

Skip for now: WebSockets (SSE or polling is enough), microservices, Kubernetes.

---

## 12. Milestones

Start with no backend at all.

1. **Engine skeleton:** 15x15 hardcoded vault, one guard on a patrol loop, a dumb thief script that walks to the loot. Plain canvas replay.
2. **Vision:** guard vision cones, line-of-sight, caught detection. If the guard sweeping across your thief feels tense, the game works.
3. **Sandbox:** standalone Node script with `isolated-vm`. Make `while(true){}` time out and a memory bomb get killed. Then call `tick` 100 times and check state persists. Plug it in as `agent.act(view)`.
4. **Fog of war + memory** for the thief script.
5. **Cameras:** fixed first, then sweep.
6. **Replay viewer:** scrubber, cone overlays, share link.
7. **Vault editor:** budget, validation, saving.
8. **Backend:** API, Postgres, BullMQ worker as a separate process with a kill timer, Docker limits.
9. **Ratings and leaderboards.**
10. **Extras:** noise, distractions, lock-picking, daily vault, seasons, gadgets.

---

## 13. Testing checklist

- Engine unit tests: line-of-sight, A\*, guard state machine, camera cone, with golden replays.
- Determinism test in CI: same seed twice gives identical event logs.
- Malicious-script suite against the sandbox.
- Rating transaction test: retrying a job does not double-apply Elo.

---

## 14. Open decisions

- Scoring formula weights (loot, speed, alarms).
- Starter gadget list and unlock thresholds.
- Replay storage: full event log vs actions only.
- `isolated-vm` vs QuickJS-WASM for the sandbox.
- Alarm behavior: one-time vs repeating every N ticks.
