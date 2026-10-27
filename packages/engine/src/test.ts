import { runHeist } from './index';
import { Vault } from './types';

const vault: Vault = {
  width: 15,
  height: 15,
  tiles: Array(15).fill(0).map((_, y) => Array(15).fill(0).map((__, x) => {
    if (x === 0 || y === 0 || x === 14 || y === 14) return 'wall';
    return 'floor';
  })),
  guards: [{
    id: 'g1',
    pos: { x: 5, y: 7 },
    facing: 'E',
    state: 'patrol',
    patrol: [{ x: 5, y: 7 }, { x: 9, y: 7 }],
    patrolIndex: 0
  }],
  cameras: [],
  items: [{ id: 'loot1', kind: 'loot', pos: { x: 12, y: 7 } }],
  entry: { x: 1, y: 7 },
  exit: { x: 13, y: 7 },
  lootId: 'loot1'
};

vault.tiles[7][2] = 'door';

function walker(view: any) {
  const hasLoot = view.inventory.some((i: any) => i.kind === 'loot');
  const target = hasLoot ? { x: 13, y: 7 } : { x: 12, y: 7 };
  const dx = target.x - view.pos.x;
  const dy = target.y - view.pos.y;
  if (Math.abs(dx) > Math.abs(dy)) return { type: 'move', dir: dx > 0 ? 'E' : 'W' };
  if (dy !== 0) return { type: 'move', dir: dy > 0 ? 'S' : 'N' };
  if (!hasLoot) return { type: 'grab', itemId: 'loot1' };
  return { type: 'wait' };
}

const res = runHeist(vault, walker, 12345, { maxTicks: 500 });
console.log(res.result);
console.log(res.events.slice(-5));
