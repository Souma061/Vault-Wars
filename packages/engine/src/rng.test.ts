import { describe, it, expect } from 'vitest';
import { RNG } from './rng';

describe('Mulberry32', () => {
  it('seed 12345 produces stable sequence', () => {
    const r = new RNG(12345);
    const v = [r.next(), r.next(), r.next(), r.next(), r.next()];
    expect(v[0]).toBeCloseTo(0.9797282677609473, 12);
    expect(v[1]).toBeCloseTo(0.3067522644996643, 12);
    expect(v[2]).toBeCloseTo(0.484205421525985, 12);
    expect(v[3]).toBeCloseTo(0.817934412509203, 12);
    expect(v[4]).toBeCloseTo(0.5094283693470061, 12);
  });

  it('same seed produces same first 5 values', () => {
    const r1 = new RNG(12345);
    const r2 = new RNG(12345);
    expect([r1.next(), r1.next(), r1.next(), r1.next(), r1.next()]).toEqual([
      r2.next(), r2.next(), r2.next(), r2.next(), r2.next()
    ]);
  });

  it('is deterministic across instances', () => {
    const r1 = new RNG(999);
    const r2 = new RNG(999);
    expect([r1.next(), r1.next()]).toEqual([r2.next(), r2.next()]);
  });

  it('forked streams are independent', () => {
    const base = new RNG(42);
    const a = base.fork('guards');
    const b = base.fork('noise');
    expect(a.next()).not.toBe(b.next());
  });

  it("fork('a') before and after drawing numbers from the parent gives identical output", () => {
    const base1 = new RNG(77);
    const f1 = base1.fork('a');
    const out1 = [f1.next(), f1.next(), f1.next()];

    const base2 = new RNG(77);
    base2.next();
    base2.next();
    const f2 = base2.fork('a');
    const out2 = [f2.next(), f2.next(), f2.next()];

    expect(out1).toEqual(out2);
  });
});
