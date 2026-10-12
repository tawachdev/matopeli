import type { OsApp, OsKeyEvent, OsServices } from '../types';

const SYMBOLS = ['#', '*', '+', '=', 'o', 'x', '>', '~'];
const GRID = 4;

type Cell = { symbol: string; up: boolean; done: boolean };

function shuffledCells(): Cell[] {
  const deck: Cell[] = [];
  for (const symbol of SYMBOLS) {
    deck.push({ symbol, up: false, done: false });
    deck.push({ symbol, up: false, done: false });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = deck[i];
    deck[i] = deck[j];
    deck[j] = swap;
  }
  return deck;
}

export function createPairsApp(services: OsServices): OsApp {
  let root: HTMLElement | null = null;
  let cells: Cell[] = shuffledCells();
  let cursor = 0;
  let first = -1;
  let locked = false;
  let moves = 0;
  let settleTimer = 0;
  let fanfareTimers: number[] = [];

  function clearTimers(): void {
    if (settleTimer !== 0) {
      window.clearTimeout(settleTimer);
      settleTimer = 0;
    }
    for (const id of fanfareTimers) window.clearTimeout(id);
    fanfareTimers = [];
  }

  function pairsLeft(): number {
    return SYMBOLS.length - cells.filter((cell) => cell.done).length / 2;
  }

  function playFanfare(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((freq, i) => {
      const id = window.setTimeout(() => services.playTone(freq, 120), i * 120);
      fanfareTimers.push(id);
    });
  }

  function newGame(): void {
    clearTimers();
    cells = shuffledCells();
    cursor = 0;
    first = -1;
    locked = false;
    moves = 0;
    render();
  }

  function makeSoft(): HTMLElement {
    const soft = document.createElement('div');
    soft.className = 'os-soft';
    const hint = document.createElement('span');
    hint.className = 'os-hint';
    hint.textContent = '5 flip  C new';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'os-back';
    back.textContent = 'Back';
    soft.append(hint, back);
    return soft;
  }

  function render(): void {
    if (root === null) return;
    root.textContent = '';
    const title = document.createElement('div');
    title.className = 'os-title';
    title.textContent = 'Pairs II';

    const status = document.createElement('div');
    status.className = 'os-row';
    const movesSpan = document.createElement('span');
    const leftSpan = document.createElement('span');
    leftSpan.className = 'os-val';
    if (cells.every((cell) => cell.done)) {
      movesSpan.textContent = 'CLEARED ' + String(moves) + ' moves';
    } else {
      movesSpan.textContent = 'MOVES ' + String(moves);
      leftSpan.textContent = 'LEFT ' + String(pairsLeft());
    }
    status.append(movesSpan, leftSpan);

    const grid = document.createElement('div');
    grid.className = 'os-grid';
    cells.forEach((cell, i) => {
      const node = document.createElement('div');
      node.className = 'os-cell';
      if (cell.up || cell.done) {
        node.classList.add('flip');
        node.textContent = cell.symbol;
      }
      if (cell.done) node.classList.add('done');
      if (i === cursor) node.classList.add('cur');
      grid.append(node);
    });

    root.append(title, status, grid, makeSoft());
  }

  function flip(index: number): void {
    if (locked) return;
    const cell = cells[index];
    if (cell.done || cell.up) return;
    cell.up = true;
    if (first < 0) {
      first = index;
      render();
      return;
    }
    const a = cells[first];
    const b = cell;
    first = -1;
    locked = true;
    moves++;
    render();
    if (a.symbol === b.symbol) {
      settleTimer = window.setTimeout(() => {
        settleTimer = 0;
        locked = false;
        a.done = true;
        b.done = true;
        render();
        services.playTone(880, 80);
        if (cells.every((c) => c.done)) playFanfare();
      }, 350);
    } else {
      settleTimer = window.setTimeout(() => {
        settleTimer = 0;
        locked = false;
        a.up = false;
        b.up = false;
        render();
        services.playTone(220, 80);
      }, 700);
    }
  }

  function moveCursor(dir: number, axis: 'row' | 'col'): void {
    const row = Math.floor(cursor / GRID);
    const col = cursor % GRID;
    const next =
      axis === 'row'
        ? (((row + dir + GRID) % GRID) * GRID + col)
        : row * GRID + ((col + dir + GRID) % GRID);
    cursor = next;
    render();
  }

  return {
    id: 'pairs',
    title: 'Pairs II',
    mount(target: HTMLElement): void {
      root = target;
      root.className = 'os-screen';
      newGame();
    },
    unmount(): void {
      clearTimers();
      if (root !== null) root.textContent = '';
      root = null;
    },
    onKey(event: OsKeyEvent): void {
      if (event.name === 'up') moveCursor(-1, 'row');
      else if (event.name === 'down') moveCursor(1, 'row');
      else if (event.name === 'left') moveCursor(-1, 'col');
      else if (event.name === 'right') moveCursor(1, 'col');
      else if (event.name === 'select' || (event.name === 'digit' && event.digit === 5)) {
        flip(cursor);
      } else if (event.name === 'back') {
        if (!locked) window.dispatchEvent(new CustomEvent('os-home'));
      } else if (event.name === 'clear') {
        newGame();
      }
    },
  };
}
