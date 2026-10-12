import type { OsApp, OsKeyEvent, OsServices } from './types';
import { net, type SmsMessage } from './net';
import { incomingAlert, playSequence } from './audio';
import { emitPhoneEvent, PhoneEvent } from './events';

type SmsView = 'menu' | 'list' | 'sent' | 'thread' | 'compose';

interface Thread {
  peer: string;
  messages: SmsMessage[];
}

export function createSmsApp(services: OsServices): OsApp {
  let root: HTMLElement | null = null;
  let view: SmsView = 'menu';
  let threads: Thread[] = [];
  let threadIndex = 0;
  let menuIndex = 0;
  let sentIndex = 0;
  let activePeer = '';
  let composeTo = '';
  let composeBody = '';
  let composeFocus: 'to' | 'body' | 'send' = 'to';
  let attachTone = false;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  const incoming = (message: SmsMessage): void => {
    if (message.kind === 'ringtone') playSequence(message.body.split('|').pop() || '');
    incomingAlert(message.kind);
    void reload();
  };

  const el = (tag: string, cls: string, text?: string): HTMLElement => {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const hint = (): string => {
    if (!net.online) return 'No signal';
    if (view === 'menu') return '5 open';
    if (view === 'list') return '5 open  C back';
    if (view === 'sent') return '5 open  C back';
    if (view === 'thread') return '5 reply  C back';
    return 'to/body: 4-6   5 send';
  };

  const renderShell = (): void => {
    if (!root) return;
    root.innerHTML = '';
    root.appendChild(el('div', 'os-title', view === 'compose' ? 'Write message' : view === 'sent' ? 'Sent items' : 'Messages'));
    const body = el('div', 'os-body');
    root.appendChild(body);
    const soft = el('div', 'os-soft');
    soft.appendChild(el('span', 'os-hint', hint()));
    const back = el('button', 'os-back', 'Back');
    back.addEventListener('click', () => onKey({ name: 'back' }));
    soft.appendChild(back);
    root.appendChild(soft);
  };

  const renderList = (): void => {
    const body = root?.querySelector('.os-body');
    if (!body) return;
    body.innerHTML = '';
    if (!net.currentSim()) {
      body.appendChild(el('div', 'os-row', 'No SIM - retry later'));
      return;
    }
    if (threads.length === 0) {
      body.appendChild(el('div', 'os-row', 'Inbox empty'));
    }
    const list = el('div', 'os-list');
    const myNumber = net.currentSim()?.number;
    if (myNumber) list.appendChild(el('div', 'os-row os-my', `My ${myNumber}`));
    if (threads.length === 0) {
      list.appendChild(el('div', 'os-row', 'Inbox empty - star writes'));
    }
    threads.forEach((thread, i) => {
      const last = thread.messages[thread.messages.length - 1];
      const row = el('div', 'os-row');
      row.appendChild(el('span', '', thread.peer));
      const preview = (last?.body || '').slice(0, 10);
      row.appendChild(el('span', 'os-val', preview));
      if (i === threadIndex) row.classList.add('os-cur');
      list.appendChild(row);
    });
    body.appendChild(list);
  };

  const renderThread = (): void => {
    const body = root?.querySelector('.os-body');
    if (!body) return;
    body.innerHTML = '';
    const thread = threads.find((t) => t.peer === activePeer);
    body.appendChild(el('div', 'os-row', activePeer || 'Unknown'));
    if (!thread) return;
    const list = el('div', 'os-list os-thread');
    thread.messages
      .slice()
      .sort((a, b) => a.created_at - b.created_at)
      .forEach((message) => {
        const mine = message.from === net.currentSim()?.number;
        const row = el('div', 'os-row', `${mine ? '>' : '<'} ${message.body}`);
        if (message.kind === 'ringtone') row.classList.add('os-tone');
        if (mine && message.status !== 'delivered') row.classList.add('os-wait');
        list.appendChild(row);
      });
    body.appendChild(list);
  };

  const renderCompose = (): void => {
    const body = root?.querySelector('.os-body');
    if (!body) return;
    body.innerHTML = '';
    const toRow = el('div', 'os-row', `To: ${composeTo || '_'}${composeFocus === 'to' ? '|' : ''}`);
    if (composeFocus === 'to') toRow.classList.add('os-cur');
    body.appendChild(toRow);
    const bodyRow = el('div', 'os-row', `Text: ${composeBody.slice(-14) || '_'}${composeFocus === 'body' ? '|' : ''}`);
    if (composeFocus === 'body') bodyRow.classList.add('os-cur');
    body.appendChild(bodyRow);
    const toneRow = el('div', 'os-row', attachTone ? `Tone: ${services.ringtoneNotes().slice(0, 16)}` : 'Tone: none');
    if (composeFocus === 'send') toneRow.classList.add('os-cur');
    body.appendChild(toneRow);
    const action = el('div', 'os-row', 'SEND');
    if (composeFocus === 'send') action.classList.add('os-cur');
    body.appendChild(action);
  };

  const menuItems = (): string[] => ['Write message', 'Inbox', 'Sent items'];

  const renderMenu = (): void => {
    const body = root?.querySelector('.os-body');
    if (!body) return;
    body.innerHTML = '';
    const list = el('div', 'os-list');
    menuItems().forEach((label, i) => {
      const row = el('div', 'os-row', label);
      if (i === menuIndex) row.classList.add('os-cur');
      list.appendChild(row);
    });
    body.appendChild(list);
  };

  const renderSent = (): void => {
    const body = root?.querySelector('.os-body');
    if (!body) return;
    body.innerHTML = '';
    const list = el('div', 'os-list');
    const myNumber = net.currentSim()?.number;
    if (myNumber) list.appendChild(el('div', 'os-row os-my', `My ${myNumber}`));
    const outbox = threads
      .flatMap((thread) => thread.messages)
      .filter((message) => message.from === net.currentSim()?.number)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 12);
    if (outbox.length === 0) list.appendChild(el('div', 'os-row', 'No sent messages'));
    outbox.forEach((message, i) => {
      const row = el('div', 'os-row');
      row.appendChild(el('span', '', message.to));
      row.appendChild(el('span', 'os-val', message.status === 'delivered' ? 'SENT' : 'QUEUED'));
      if (i === sentIndex) row.classList.add('os-cur');
      list.appendChild(row);
    });
    body.appendChild(list);
  };

  const render = (): void => {
    renderShell();
    if (view === 'menu') renderMenu();
    else if (view === 'list') renderList();
    else if (view === 'sent') renderSent();
    else if (view === 'thread') renderThread();
    else renderCompose();
  };

  const reload = async (): Promise<void> => {
    const data = await net.list();
    if (!data) return;
    const map = new Map<string, Thread>();
    data.inbox.forEach((message) => {
      const thread = map.get(message.from) || { peer: message.from, messages: [] };
      thread.messages.push(message);
      map.set(message.from, thread);
    });
    data.outbox.forEach((message) => {
      const thread = map.get(message.to) || { peer: message.to, messages: [] };
      thread.messages.push(message);
      map.set(message.to, thread);
    });
    threads = [...map.values()].sort((a, b) => {
      const lastA = a.messages[a.messages.length - 1]?.created_at || 0;
      const lastB = b.messages[b.messages.length - 1]?.created_at || 0;
      return lastB - lastA;
    });
    if (view === 'list') renderList();
    if (view === 'thread') renderThread();
    if (view === 'sent') renderSent();
  };

  const sendCurrent = async (): Promise<void> => {
    const to = composeTo.replace(/\s+/g, '');
    if (!to || (!composeBody && !attachTone)) {
      if (root) {
        const hintEl = root.querySelector('.os-hint');
        if (hintEl) hintEl.textContent = 'Need number and text';
      }
      return;
    }
    const kind = attachTone ? 'ringtone' : 'text';
    const payload = attachTone ? `${composeBody}|${services.ringtoneNotes()}`.replace(/^\|/, '') : composeBody;
    const result = await net.send(to, kind, payload);
    if ('error' in result) {
      if (root) {
        const hintEl = root.querySelector('.os-hint');
        if (hintEl) hintEl.textContent = `Send failed: ${result.error}`;
      }
      return;
    }
    composeBody = '';
    attachTone = false;
    activePeer = to;
    view = 'thread';
    render();
    await reload();
  };

  const onKey = (event: OsKeyEvent): void => {
    if (view === 'menu') {
      const count = menuItems().length;
      if (event.name === 'up') {
        menuIndex = (menuIndex + count - 1) % count;
        renderMenu();
      } else if (event.name === 'down') {
        menuIndex = (menuIndex + 1) % count;
        renderMenu();
      } else if (event.name === 'select') {
        if (menuIndex === 0) {
          composeTo = '';
          composeBody = '';
          composeFocus = 'to';
          view = 'compose';
          render();
        } else if (menuIndex === 1) {
          view = 'list';
          render();
          void reload();
        } else {
          view = 'sent';
          sentIndex = 0;
          render();
          void reload();
        }
      } else if (event.name === 'back') {
        emitPhoneEvent(PhoneEvent.home);
      }
      return;
    }
    if (view === 'sent') {
      const myMessages = threads
        .flatMap((thread) => thread.messages)
        .filter((message) => message.from === net.currentSim()?.number)
        .sort((a, b) => b.created_at - a.created_at);
      if (event.name === 'up' && myMessages.length > 0) {
        sentIndex = (sentIndex + myMessages.length - 1) % myMessages.length;
        renderSent();
      } else if (event.name === 'down' && myMessages.length > 0) {
        sentIndex = (sentIndex + 1) % myMessages.length;
        renderSent();
      } else if (event.name === 'select' && myMessages[sentIndex]) {
        activePeer = myMessages[sentIndex].to;
        view = 'thread';
        render();
      } else if (event.name === 'back') {
        view = 'menu';
        renderMenu();
      }
      return;
    }
    if (view === 'list') {
      if (event.name === 'up' && threads.length > 0) {
        threadIndex = (threadIndex + threads.length - 1) % threads.length;
        renderList();
      } else if (event.name === 'down' && threads.length > 0) {
        threadIndex = (threadIndex + 1) % threads.length;
        renderList();
      } else if (event.name === 'select' && threads[threadIndex]) {
        activePeer = threads[threadIndex].peer;
        view = 'thread';
        render();
      } else if (event.name === 'star') {
        composeTo = '';
        composeBody = '';
        composeFocus = 'to';
        view = 'compose';
        render();
      } else if (event.name === 'back') {
        view = 'menu';
        renderMenu();
      }
      return;
    }
    if (view === 'thread') {
      if (event.name === 'select') {
        composeTo = activePeer;
        composeBody = '';
        composeFocus = 'body';
        view = 'compose';
        render();
      } else if (event.name === 'back') {
        view = 'list';
        renderList();
        void reload();
      }
      return;
    }
    if (event.name === 'left') {
      composeFocus = composeFocus === 'body' ? 'to' : 'to';
      render();
    } else if (event.name === 'right') {
      composeFocus = composeFocus === 'to' ? 'body' : composeFocus === 'body' ? 'send' : 'send';
      render();
    } else if (event.name === 'digit' && event.digit !== undefined) {
      if (composeFocus === 'to') composeTo = (composeTo + String(event.digit)).slice(0, 15);
      else if (composeFocus === 'body') composeBody = (composeBody + String(event.digit)).slice(0, 160);
      renderCompose();
    } else if (event.name === 'star') {
      if (composeFocus === 'to') composeTo = (composeTo + '+').slice(0, 16);
      else composeBody = (composeBody + ' ').slice(0, 160);
      renderCompose();
    } else if (event.name === 'hash') {
      if (composeFocus === 'send') {
        attachTone = !attachTone;
        renderCompose();
      } else {
        composeBody = (composeBody + '.').slice(0, 160);
        renderCompose();
      }
    } else if (event.name === 'clear') {
      if (composeFocus === 'to') composeTo = composeTo.slice(0, -1);
      else composeBody = composeBody.slice(0, -1);
      renderCompose();
    } else if (event.name === 'select') {
      if (composeFocus === 'to') {
        composeFocus = 'body';
        renderCompose();
      } else if (composeFocus === 'body') {
        composeFocus = 'send';
        renderCompose();
      } else {
        void sendCurrent();
      }
    } else if (event.name === 'back') {
      view = 'menu';
      renderMenu();
    }
  };

  net.onMessage(incoming);

  return {
    id: 'messages',
    acceptsDigits: () => view === 'compose' || view === 'thread',
    title: 'Messages',
    mount(node: HTMLElement): void {
      root = node;
      render();
      void reload();
      refreshTimer = setInterval(() => void reload(), 4000);
    },
    unmount(): void {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = null;
      net.offMessage(incoming);
      root = null;
    },
    onKey,
  };
}
