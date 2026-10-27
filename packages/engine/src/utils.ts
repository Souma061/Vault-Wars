import { Action, Dir, Vec2 } from './types';

export function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
export function eq(a: Vec2, b: Vec2): boolean { return a.x === b.x && a.y === b.y; }
export function distMan(a: Vec2, b: Vec2): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

const DIRS: Record<Dir, Vec2> = { N: {x:0,y:-1}, E: {x:1,y:0}, S: {x:0,y:1}, W: {x:-1,y:0} };
export function step(d: Dir): Vec2 { return DIRS[d]; }

export function dirTo(from: Vec2, to: Vec2): Dir | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  if (dx === 1) return 'E';
  if (dx === -1) return 'W';
  if (dy === 1) return 'S';
  if (dy === -1) return 'N';
  return null;
}

export function isWall(t: string): boolean { return t === 'wall'; }
export function isBlocking(t: string): boolean { return t === 'wall' || t === 'locked_door'; }
