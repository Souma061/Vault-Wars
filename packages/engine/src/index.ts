import { Action, RunLimits, RunResult, ThiefAgent, TickEvent, Vault, Vec2, Guard, Item } from './types';
import { RNG } from './rng';
import { add, eq, isBlocking, step } from './utils';

export function runHeist(vault: Vault, agent: ThiefAgent, seed: number, limits: RunLimits) {
  const rng = new RNG(seed);
  const events: TickEvent[] = [];
  let pos: Vec2 = { ...vault.entry };
  const inventory: Item[] = [];
  const memory: Record<string, any> = {};
  const guards: Guard[] = vault.guards.map(g => ({ ...g, pos: { ...g.pos }, patrol: g.patrol.map(p => ({ ...p })) }));
  const lootId = vault.lootId || vault.items.find(i => i.kind === 'loot')?.id;

  function getTile(p: Vec2) {
    if (p.x < 0 || p.y < 0 || p.x >= vault.width || p.y >= vault.height) return 'wall';
    return vault.tiles[p.y][p.x];
  }

  function buildView(tick: number) {
    return {
      tick,
      pos: { ...pos },
      visibleTiles: [],
      guards: guards.map(g => ({ id: g.id, pos: { ...g.pos }, facing: g.facing, state: g.state, fov: 90, range: 6 })),
      cameras: (vault.cameras || []).map(c => ({ id: c.id, pos: { ...c.pos }, facingDeg: c.facing, fov: c.fov, range: c.range, disabled: c.disabledUntil !== undefined && c.disabledUntil > tick })),
      items: vault.items.map(i => ({ id: i.id, kind: i.kind, pos: { ...i.pos } })),
      inventory: inventory.map(i => ({ ...i })),
      noise: 0,
      alarm: false,
      memory,
    };
  }

  for (let tick = 0; tick < limits.maxTicks; tick++) {
    // Update guards - simple patrol
    for (const g of guards) {
      if (g.patrol && g.patrol.length > 0) {
        const target = g.patrol[g.patrolIndex];
        if (eq(g.pos, target)) {
          g.patrolIndex = (g.patrolIndex + 1) % g.patrol.length;
        } else {
          const dx = target.x - g.pos.x;
          const dy = target.y - g.pos.y;
          if (Math.abs(dx) > Math.abs(dy)) {
            g.pos.x += dx > 0 ? 1 : -1;
            g.facing = dx > 0 ? 'E' : 'W';
          } else if (dy !== 0) {
            g.pos.y += dy > 0 ? 1 : -1;
            g.facing = dy > 0 ? 'S' : 'N';
          }
        }
      }
    }

    // Get action
    let action: Action = { type: 'wait' };
    try {
      action = agent(buildView(tick)) || { type: 'wait' };
    } catch (e: any) {
      events.push({ tick, type: 'agent_error', msg: e?.message });
      action = { type: 'wait' };
    }

    // Resolve action
    if (action.type === 'move' || action.type === 'sneak') {
      const n = add(pos, step(action.dir));
      const t = getTile(n);
      if (!isBlocking(t)) {
        pos = n;
        events.push({ tick, type: 'move', from: { ...pos }, to: { ...n }, dir: action.dir });
      } else {
        events.push({ tick, type: 'blocked', pos: { ...pos }, dir: action.dir });
      }
    } else if (action.type === 'grab') {
      const it = vault.items.find(i => i.id === action.itemId && eq(i.pos, pos));
      if (it && !inventory.find(x => x.id === it.id)) {
        inventory.push({ ...it });
        events.push({ tick, type: 'grab', itemId: it.id });
      }
    } else if (action.type === 'wait') {
      events.push({ tick, type: 'wait' });
    }

    // Check caught
    for (const g of guards) {
      if (eq(g.pos, pos)) {
        events.push({ tick, type: 'caught', by: g.id });
        return { events, result: { outcome: 'caught', ticks: tick + 1 } };
      }
    }

    // Check win
    if (eq(pos, vault.exit) && lootId && inventory.some(i => i.id === lootId)) {
      events.push({ tick, type: 'escaped' });
      return { events, result: { outcome: 'escaped', ticks: tick + 1 } };
    }
  }

  return { events, result: { outcome: 'timeout', ticks: limits.maxTicks } };
}
