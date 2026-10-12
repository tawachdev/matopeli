import type { OsApp, OsKeyEvent, OsServices } from '../types';

type Tok = { t: 'n'; v: number } | { t: 'o'; v: string };

function parseNumber(src: string, start: number): { value: number; next: number } | null {
  let seenDigit = false;
  let seenDot = false;
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch >= '0' && ch <= '9') {
      seenDigit = true;
      i++;
    } else if (ch === '.') {
      if (seenDot) return null;
      seenDot = true;
      i++;
    } else {
      break;
    }
  }
  if (!seenDigit) return null;
  return { value: Number(src.slice(start, i)), next: i };
}

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ') {
      i++;
      continue;
    }
    if (ch === '+' || ch === '*' || ch === '/') {
      toks.push({ t: 'o', v: ch });
      i++;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      const num = parseNumber(src, i);
      if (!num) return null;
      toks.push({ t: 'n', v: num.value });
      i = num.next;
      continue;
    }
    if (ch === '-' || ch === '.') {
      const prev: Tok | undefined = toks[toks.length - 1];
      const expectsNumber = toks.length === 0 || prev !== undefined && prev.t === 'o';
      if (ch === '-' && expectsNumber) {
        const num = parseNumber(src, i + 1);
        if (!num) return null;
        toks.push({ t: 'n', v: -num.value });
        i = num.next;
        continue;
      }
      if (ch === '.' && expectsNumber) {
        const num = parseNumber(src, i);
        if (!num) return null;
        toks.push({ t: 'n', v: num.value });
        i = num.next;
        continue;
      }
      toks.push({ t: 'o', v: ch });
      i++;
      continue;
    }
    return null;
  }
  return toks;
}

function precedence(op: string): number {
  if (op === '+' || op === '-') return 1;
  return 2;
}

function evaluate(toks: Tok[]): number | null {
  if (toks.length === 0) return null;
  const out: Tok[] = [];
  const ops: string[] = [];
  let expectNum = true;
  for (const tk of toks) {
    if (tk.t === 'n') {
      if (expectNum === false) return null;
      out.push(tk);
      expectNum = false;
    } else {
      if (expectNum === true) return null;
      while (ops.length > 0 && precedence(ops[ops.length - 1]) >= precedence(tk.v)) {
        const op = ops.pop();
        if (op === undefined) return null;
        out.push({ t: 'o', v: op });
      }
      ops.push(tk.v);
      expectNum = true;
    }
  }
  if (expectNum === true) return null;
  while (ops.length > 0) {
    const op = ops.pop();
    if (op === undefined) return null;
    out.push({ t: 'o', v: op });
  }
  const st: number[] = [];
  for (const tk of out) {
    if (tk.t === 'n') {
      st.push(tk.v);
      continue;
    }
    const b = st.pop();
    const a = st.pop();
    if (a === undefined || b === undefined) return null;
    if (tk.v === '+') st.push(a + b);
    else if (tk.v === '-') st.push(a - b);
    else if (tk.v === '*') st.push(a * b);
    else {
      if (b === 0) return null;
      st.push(a / b);
    }
  }
  if (st.length !== 1) return null;
  return st[0];
}

function formatResult(value: number): string {
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded);
}

export function createCalculatorApp(services: OsServices): OsApp {
  const hashCycle: string[] = ['*', '/', '-', '.'];
  let hashIndex = 0;
  let expression = '';
  let lastExpression = '';
  let root: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let resultLine: HTMLElement | null = null;

  function syncInput(): void {
    if (input !== null) input.value = expression;
  }

  function runEquals(): void {
    const src = expression.trim().length > 0 ? expression : lastExpression;
    if (src.trim().length === 0) {
      if (resultLine !== null) resultLine.textContent = '';
      return;
    }
    lastExpression = src;
    const toks = tokenize(src);
    const value = toks === null ? null : evaluate(toks);
    if (resultLine !== null) {
      resultLine.textContent =
        value !== null && Number.isFinite(value) ? '= ' + formatResult(value) : 'Error';
    }
  }

  return {
    id: 'calculator',
    title: 'Calculator',
    mount(target: HTMLElement): void {
      root = target;
      root.className = 'os-screen';
      const title = document.createElement('div');
      title.className = 'os-title';
      title.textContent = 'Calculator';
      input = document.createElement('input');
      input.className = 'os-input';
      input.inputMode = 'decimal';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      input.addEventListener('input', () => {
        expression = input !== null ? input.value : '';
      });
      resultLine = document.createElement('div');
      resultLine.className = 'os-hint';
      const soft = document.createElement('div');
      soft.className = 'os-soft';
      const hint = document.createElement('span');
      hint.textContent = '5 =  C clear';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'os-back';
      back.textContent = 'Back';
      soft.append(hint, back);
      root.append(title, input, resultLine, soft);
      syncInput();
      input.focus();
    },
    unmount(): void {
      if (root !== null) root.textContent = '';
      root = null;
      input = null;
      resultLine = null;
    },
    onKey(event: OsKeyEvent): void {
      if (event.name === 'digit' && event.digit !== undefined) {
        expression += String(event.digit);
      } else if (event.name === 'star') {
        expression += '+';
      } else if (event.name === 'hash') {
        expression += hashCycle[hashIndex % hashCycle.length];
        hashIndex++;
      } else if (event.name === 'select') {
        runEquals();
        return;
      } else if (event.name === 'back') {
        window.dispatchEvent(new CustomEvent('os-home'));
      } else if (event.name === 'clear') {
        expression = '';
        lastExpression = '';
        if (resultLine !== null) resultLine.textContent = '';
      }
      syncInput();
    },
  };
}
