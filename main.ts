// Sokoban solver for generated hallway-and-rooms levels.
//
// The generator's levels are a hallway with one to four rooms off it, each room holding its
// own boxes and goals, and a box can never leave its room. So a level's push optimum is the
// sum of its rooms' optima: find each room (the floor beyond a single doorway cell), solve it
// on its own with a push-level A* whose estimate is every box's true push distance to a goal
// (pulled back from the goals, ignoring the other boxes), then walk the hallway between the
// doors and join the pieces. A room the search cannot finish falls back to no answer for the
// level rather than a wrong one; every cap below counts expansions, never the clock, so two
// runs of this program on the same set write the same bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fixed direction order keeps every search deterministic: u, d, l, r.
const DIRS: ReadonlyArray<readonly [number, number, string]> = [
  [0, -1, 'u'],
  [0, 1, 'd'],
  [-1, 0, 'l'],
  [1, 0, 'r'],
];

const ROOM_EXPANSION_CAP = 1_500_000;

interface Level {
  w: number;
  h: number;
  floor: Set<number>;
  goals: Set<number>;
  boxes: number[];
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const floor = new Set<number>();
  const goals = new Set<number>();
  const boxes: number[] = [];
  let player = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x] ?? '#';
      if (ch === '#') continue;
      const cell = y * w + x;
      floor.add(cell);
      if (ch === '.' || ch === '*' || ch === '+') goals.add(cell);
      if (ch === '$' || ch === '*') boxes.push(cell);
      if (ch === '@' || ch === '+') player = cell;
    }
  }
  boxes.sort((a, b) => a - b);
  return { w, h, floor, goals, boxes, player };
}

// Cells whose removal splits the floor into more pieces (Tarjan, recursive; boards are tiny).
function articulationPoints(level: Level): Set<number> {
  const { floor, w } = level;
  const disc = new Map<number, number>();
  const low = new Map<number, number>();
  const arts = new Set<number>();
  let time = 0;
  const visit = (u: number, parent: number): void => {
    disc.set(u, time);
    low.set(u, time);
    time++;
    let children = 0;
    for (const [dx, dy] of DIRS) {
      const v = u + dy * w + dx;
      if (!floor.has(v)) continue;
      if (!disc.has(v)) {
        children++;
        visit(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (parent !== -1 && low.get(v)! >= disc.get(u)!) arts.add(u);
      } else if (v !== parent) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
    if (parent === -1 && children > 1) arts.add(u);
  };
  for (const cell of floor) if (!disc.has(cell)) visit(cell, -1);
  return arts;
}

interface Room {
  door: number; // the doorway cell, part of the room's floor for solving
  cells: Set<number>; // room floor including the door
  boxes: number[];
}

// A room is what lies beyond one doorway: cut the doorway cell out and the piece away from
// the player holds the room's boxes and the same number of goals, and nothing else.
function findRooms(level: Level): Room[] | null {
  const { floor, goals, boxes, player } = level;
  const arts = articulationPoints(level);
  const rooms: Room[] = [];
  const claimed = new Set<number>();
  for (const door of arts) {
    if (door === player) continue;
    // Components of the floor with the door removed.
    const seen = new Set<number>([door]);
    for (const start of floor) {
      if (seen.has(start)) continue;
      const comp: number[] = [];
      const queue = [start];
      seen.add(start);
      while (queue.length > 0) {
        const c = queue.pop()!;
        comp.push(c);
        for (const [dx, dy] of DIRS) {
          const n = c + dy * level.w + dx;
          if (floor.has(n) && !seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      if (comp.includes(player)) continue;
      const compBoxes = comp.filter((c) => boxes.includes(c));
      const compGoals = comp.filter((c) => goals.has(c));
      if (compBoxes.length === 0) continue;
      if (compBoxes.length !== compGoals.length) continue;
      if (comp.length > 64) continue;
      if (compBoxes.some((b) => claimed.has(b))) continue;
      const cells = new Set<number>(comp);
      cells.add(door);
      for (const b of compBoxes) claimed.add(b);
      rooms.push({ door, cells, boxes: compBoxes });
    }
  }
  if (rooms.length === 0) return null;
  if (claimed.size !== boxes.length) return null; // not a clean split: solve whole instead
  return rooms;
}

// Push distance from every cell to the nearest goal, other boxes ignored: pull each box back
// from the goals. A cell with no distance can never hold a box that reaches a goal.
function pullDistances(cells: Set<number>, goals: Set<number>, w: number): Map<number, number> {
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const g of goals) {
    if (cells.has(g)) {
      dist.set(g, 0);
      queue.push(g);
    }
  }
  while (queue.length > 0) {
    const y = queue.shift()!;
    for (const [dx, dy] of DIRS) {
      const boxFrom = y - (dy * w + dx);
      const stand = y - 2 * (dy * w + dx);
      if (!cells.has(boxFrom) || !cells.has(stand)) continue;
      if (dist.has(boxFrom)) continue;
      dist.set(boxFrom, dist.get(y)! + 1);
      queue.push(boxFrom);
    }
  }
  return dist;
}

interface Flood {
  rep: number;
  pathTo: Map<number, string>;
}

// Every cell the player can walk to with the boxes frozen, the walk string that gets there,
// and one canonical cell naming the whole reachable region.
function flood(cells: Set<number>, boxSet: Set<number>, from: number, w: number): Flood {
  const pathTo = new Map<number, string>([[from, '']]);
  const queue = [from];
  let rep = from;
  while (queue.length > 0) {
    const c = queue.shift()!;
    if (c < rep) rep = c;
    for (const [dx, dy, ch] of DIRS) {
      const n = c + dy * w + dx;
      if (!cells.has(n) || boxSet.has(n) || pathTo.has(n)) continue;
      pathTo.set(n, pathTo.get(c)! + ch);
      queue.push(n);
    }
  }
  return { rep, pathTo };
}

interface NodeRec {
  g: number;
  boxes: number[];
  player: number;
  parent: string | null;
  seg: string;
}

// Push-optimal A* inside one room. The player starts on the door (or on the level's start
// square for a whole-board solve); a box is never pushed onto the door, and when the player
// still has to leave afterwards, only an ending that can walk back to the door counts.
function solveRoom(
  level: Level,
  cells: Set<number>,
  door: number | null,
  startBoxes: number[],
  goals: Set<number>,
  playerStart: number,
  needExit: boolean,
): { moves: string; endPlayer: number } | null {
  const { w } = level;
  const dist = pullDistances(cells, goals, w);
  for (const b of startBoxes) if (!dist.has(b)) return null;
  const heuristic = (bs: number[]): number => bs.reduce((s, b) => s + (dist.get(b) ?? 0), 0);
  const isGoal = (bs: number[]): boolean => bs.every((b) => goals.has(b));

  const startBoxSet = new Set(startBoxes);
  const startFlood = flood(cells, startBoxSet, playerStart, w);
  const startKey = `${startBoxes.join(',')}|${startFlood.rep}`;
  const nodes = new Map<string, NodeRec>();
  nodes.set(startKey, { g: 0, boxes: [...startBoxes], player: playerStart, parent: null, seg: '' });
  const bestG = new Map<string, number>([[startKey, 0]]);

  // Binary heap ordered by (f, then h, then key): a total order, so the search is repeatable.
  type Item = [number, number, string];
  const cmp = (a: Item, b: Item): number =>
    a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
  const heap: Item[] = [[heuristic(startBoxes), heuristic(startBoxes), startKey]];
  const heapPush = (item: Item): void => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cmp(heap[p], heap[i]) <= 0) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const heapPop = (): Item | undefined => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && cmp(heap[l], heap[m]) < 0) m = l;
        if (r < heap.length && cmp(heap[r], heap[m]) < 0) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  let expansions = 0;
  while (heap.length > 0) {
    const popped = heapPop()!;
    const key = popped[2];
    const node = nodes.get(key)!;
    if (node.g !== bestG.get(key)) continue;
    if (isGoal(node.boxes)) {
      if (!needExit || door === null) return finish(nodes, key);
      const fl = flood(cells, new Set(node.boxes), node.player, w);
      if (fl.pathTo.has(door)) return finish(nodes, key);
    }
    if (++expansions > ROOM_EXPANSION_CAP) return null;
    const boxSet = new Set(node.boxes);
    const fl = flood(cells, boxSet, node.player, w);
    for (const b of node.boxes) {
      for (const [dx, dy, ch] of DIRS) {
        const step = dy * w + dx;
        const stand = b - step;
        const dest = b + step;
        if (!fl.pathTo.has(stand)) continue;
        if (!cells.has(dest) || boxSet.has(dest)) continue;
        if (door !== null && dest === door) continue;
        if (!dist.has(dest)) continue; // a push onto a dead square can never finish
        const nextBoxes = node.boxes.map((x) => (x === b ? dest : x)).sort((a, z) => a - z);
        const nextPlayer = b;
        const nextFlood = flood(cells, new Set(nextBoxes), nextPlayer, w);
        const nextKey = `${nextBoxes.join(',')}|${nextFlood.rep}`;
        const g2 = node.g + 1;
        if (bestG.has(nextKey) && bestG.get(nextKey)! <= g2) continue;
        bestG.set(nextKey, g2);
        nodes.set(nextKey, {
          g: g2,
          boxes: nextBoxes,
          player: nextPlayer,
          parent: key,
          seg: fl.pathTo.get(stand)! + ch,
        });
        const h2 = heuristic(nextBoxes);
        heapPush([g2 + h2, h2, nextKey]);
      }
    }
  }
  return null;
}

function finish(nodes: Map<string, NodeRec>, key: string): { moves: string; endPlayer: number } {
  const parts: string[] = [];
  let k: string | null = key;
  let endPlayer = nodes.get(key)!.player;
  while (k !== null) {
    const n = nodes.get(k)!;
    if (n.seg) parts.push(n.seg);
    k = n.parent;
  }
  parts.reverse();
  return { moves: parts.join(''), endPlayer };
}

// A plain walk on the whole board with every box frozen: the hallway between two doors.
function walkPath(level: Level, from: number, to: number, boxSet: Set<number>): string | null {
  const fl = flood(level.floor, boxSet, from, level.w);
  return fl.pathTo.has(to) ? fl.pathTo.get(to)! : null;
}

// Replay a move string on the live board so the assembly always knows where things stand.
function applyMoves(level: Level, boxes: Set<number>, player: number, moves: string): number {
  let p = player;
  for (const ch of moves) {
    const dir = DIRS.find((d) => d[2] === ch.toLowerCase())!;
    const step = dir[1] * level.w + dir[0];
    const next = p + step;
    if (boxes.has(next)) {
      boxes.delete(next);
      boxes.add(next + step);
    }
    p = next;
  }
  return p;
}

function solveLevel(text: string): string {
  const level = parseLevel(text);
  if (level.boxes.length === 0 || level.player < 0) return '';
  const rooms = findRooms(level);
  if (rooms !== null) {
    for (const order of [rooms, [...rooms].reverse()]) {
      const boxes = new Set(level.boxes);
      let player = level.player;
      let out = '';
      let ok = true;
      for (let i = 0; i < order.length; i++) {
        const room = order[i];
        const walk = walkPath(level, player, room.door, boxes);
        if (walk === null) {
          ok = false;
          break;
        }
        out += walk;
        player = applyMoves(level, boxes, player, walk);
        const roomGoals = new Set([...level.goals].filter((g) => room.cells.has(g) && g !== room.door));
        const roomBoxes = room.boxes.filter((b) => boxes.has(b)).sort((a, z) => a - z);
        const sol = solveRoom(level, room.cells, room.door, roomBoxes, roomGoals, room.door, i < order.length - 1);
        if (sol === null) {
          ok = false;
          break;
        }
        out += sol.moves;
        player = applyMoves(level, boxes, player, sol.moves);
      }
      if (ok) return out;
    }
    return '';
  }
  const sol = solveRoom(level, level.floor, null, level.boxes, level.goals, level.player, false);
  return sol === null ? '' : sol.moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
