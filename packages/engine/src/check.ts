import { RNG } from './rng';
const r = new RNG(12345);
const v = [r.next(), r.next(), r.next(), r.next(), r.next()];
console.log(v[0]);
console.log(v[1]);
console.log(v[2]);
console.log(v[3]);
console.log(v[4]);
