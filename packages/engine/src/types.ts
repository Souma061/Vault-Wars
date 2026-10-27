export type Vec2 = { x: number; y: number };

export type TileType = 'floor' | 'wall' | 'door' | 'locked_door' | 'entry' | 'exit';

export type Tile = Vec2 & { type: TileType };

export type Dir = 'N' | 'E' | 'S' | 'W';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'sneak'; dir: Dir }
  | { type: 'wait' }
  | { type: 'grab'; itemId: string }
  | { type: 'pickLock'; doorId: string }
  | { type: 'throwDistraction'; tile: Vec2 }
  | { type: 'disableCamera'; camId: string };

export type GuardState = 'patrol' | 'suspicious' | 'chase' | 'return';

export type Guard = {
  id: string;
  pos: Vec2;
  facing: Dir;
  state: GuardState;
  patrol: Vec2[];
  patrolIndex: number;
};

export type Camera = {
  id: string;
  pos: Vec2;
  facing: number;
  fov: number;
  range: number;
  pattern: 'fixed' | 'sweep';
  sweepMin?: number;
  sweepMax?: number;
  sweepPeriod?: number;
  disabledUntil?: number;
};

export type Item = { id: string; kind: 'loot' | 'key' | 'gadget'; pos: Vec2 };

export type Vault = {
  width: number;
  height: number;
  tiles: TileType[][];
  guards: Guard[];
  cameras: Camera[];
  items: Item[];
  entry: Vec2;
  exit: Vec2;
  lootId?: string;
};

export type View = {
  tick: number;
  pos: Vec2;
  visibleTiles: Tile[];
  guards: any[];
  cameras: any[];
  items: any[];
  inventory: Item[];
  noise: number;
  alarm: boolean;
  memory: Record<string, any>;
};

export type ThiefAgent = (view: View) => Action;

export type TickEvent = { tick: number; type: string; [k: string]: any };

export type RunResult = {
  outcome: 'escaped' | 'caught' | 'timeout' | 'error';
  ticks: number;
  score?: number;
};

export type RunLimits = { maxTicks: number; tickCpuMs?: number };
