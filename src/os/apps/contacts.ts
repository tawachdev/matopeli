import type { Contact, OsApp, OsKeyEvent, OsServices } from '../types';

type View = 'list' | 'detail' | 'form' | 'confirm';

function normalizeNumber(raw: string): string {
  return raw.replace(/ /g, '');
}

function isValidNumber(raw: string): boolean {
  return /^\d{8,15}$/.test(normalizeNumber(raw));
}

export function createContactsApp(services: OsServices): OsApp {
  let root: HTMLElement | null = null;
  let list: Contact[] = [];
  let view: View = 'list';
  let cursor = 0;
  let nameInput: HTMLInputElement | null = null;
  let numberInput: HTMLInputElement | null = null;
  let formCursor = 0;
  let hintText: HTMLElement | null = null;
  let formRows: HTMLElement[] = [];

  function load(): void {
    list = [...services.contacts()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function makeSoft(): HTMLElement {
    const soft = document.createElement('div');
    soft.className = 'os-soft';
    const hint = document.createElement('span');
    hint.textContent = view === 'list' ? '# add  C delete' : '';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'os-back';
    back.textContent = 'Back';
    soft.append(hint, back);
    return soft;
  }

  function renderShell(): void {
    if (root !== null) root.textContent = '';
    const title = document.createElement('div');
    title.className = 'os-title';
    title.textContent = 'Contacts';
    root?.append(title);
  }

  function renderList(): void {
    view = 'list';
    renderShell();
    const container = document.createElement('div');
    container.className = 'os-list';
    if (list.length === 0) {
      const row = document.createElement('div');
      row.className = 'os-row';
      const span = document.createElement('span');
      span.textContent = 'No contacts';
      row.append(span);
      container.append(row);
    } else {
      list.forEach((contact, i) => {
        const row = document.createElement('div');
        row.className = 'os-row' + (i === cursor ? ' os-cur' : '');
        const name = document.createElement('span');
        name.textContent = contact.name;
        const num = document.createElement('span');
        num.className = 'os-val';
        num.textContent = contact.number;
        row.append(name, num);
        container.append(row);
      });
    }
    hintText = document.createElement('div');
    hintText.className = 'os-hint';
    hintText.textContent = list.length === 0 ? 'Press # to add' : '';
    root?.append(container, hintText, makeSoft());
  }

  function renderDetail(): void {
    view = 'detail';
    renderShell();
    const contact = list[cursor];
    const container = document.createElement('div');
    container.className = 'os-list';
    const nameRow = document.createElement('div');
    nameRow.className = 'os-row';
    const name = document.createElement('span');
    name.textContent = contact !== undefined ? contact.name : '';
    nameRow.append(name);
    const numRow = document.createElement('div');
    numRow.className = 'os-row';
    const num = document.createElement('span');
    num.textContent = contact !== undefined ? contact.number : '';
    numRow.append(num);
    container.append(nameRow, numRow);
    hintText = document.createElement('div');
    hintText.className = 'os-hint';
    hintText.textContent = 'select = call';
    root?.append(container, hintText, makeSoft());
  }

  function renderConfirm(): void {
    view = 'confirm';
    renderShell();
    const container = document.createElement('div');
    container.className = 'os-list';
    const row = document.createElement('div');
    row.className = 'os-row os-cur';
    const span = document.createElement('span');
    span.textContent = 'Delete? 5=yes C=no';
    row.append(span);
    container.append(row);
    root?.append(container, makeSoft());
  }

  function renderForm(): void {
    view = 'form';
    formCursor = 0;
    renderShell();
    const container = document.createElement('div');
    container.className = 'os-list';
    formRows = [];
    const fields: { label: string; input: HTMLInputElement }[] = [];
    nameInput = document.createElement('input');
    nameInput.className = 'os-input';
    nameInput.autocapitalize = 'off';
    nameInput.spellcheck = false;
    numberInput = document.createElement('input');
    numberInput.className = 'os-input';
    numberInput.inputMode = 'numeric';
    fields.push({ label: 'Name', input: nameInput }, { label: 'Number', input: numberInput });
    fields.forEach((field) => {
      const row = document.createElement('div');
      row.className = 'os-row';
      const label = document.createElement('span');
      label.textContent = field.label;
      row.append(label, field.input);
      formRows.push(row);
      container.append(row);
    });
    const saveRow = document.createElement('div');
    saveRow.className = 'os-row';
    const saveLabel = document.createElement('span');
    saveLabel.textContent = 'Save';
    saveRow.append(saveLabel);
    formRows.push(saveRow);
    container.append(saveRow);
    hintText = document.createElement('div');
    hintText.className = 'os-hint';
    hintText.textContent = '';
    root?.append(container, hintText, makeSoft());
    updateFormCursor();
    nameInput.focus();
  }

  function updateFormCursor(): void {
    formRows.forEach((row, i) => {
      if (i === formCursor) row.classList.add('os-cur');
      else row.classList.remove('os-cur');
    });
    if (formCursor === 0 && nameInput !== null) nameInput.focus();
    else if (formCursor === 1 && numberInput !== null) numberInput.focus();
  }

  function saveForm(): void {
    const name = nameInput !== null ? nameInput.value.trim() : '';
    const number = numberInput !== null ? normalizeNumber(numberInput.value) : '';
    if (name.length === 0) {
      if (hintText !== null) hintText.textContent = 'Name required';
      return;
    }
    if (!isValidNumber(number)) {
      if (hintText !== null) hintText.textContent = 'Number 8-15 digits';
      return;
    }
    list.push({ name, number });
    list.sort((a, b) => a.name.localeCompare(b.name));
    services.saveContacts(list);
    cursor = list.findIndex((c) => c.name === name && c.number === number);
    if (cursor < 0) cursor = 0;
    nameInput = null;
    numberInput = null;
    renderList();
  }

  function deleteCurrent(): void {
    list = list.filter((_, i) => i !== cursor);
    services.saveContacts(list);
    if (cursor >= list.length) cursor = Math.max(0, list.length - 1);
    renderList();
  }

  return {
    id: 'contacts',
    title: 'Contacts',
    mount(target: HTMLElement): void {
      root = target;
      root.className = 'os-screen';
      load();
      if (list.length === 0) renderForm();
      else renderList();
    },
    unmount(): void {
      if (root !== null) root.textContent = '';
      root = null;
      nameInput = null;
      numberInput = null;
      hintText = null;
      formRows = [];
    },
    onKey(event: OsKeyEvent): void {
      if (view === 'list') {
        if (event.name === 'back') {
          window.dispatchEvent(new CustomEvent('os-home'));
        } else if (event.name === 'up' || event.name === 'down') {
          if (list.length === 0) return;
          cursor =
            event.name === 'up' ? Math.max(0, cursor - 1) : Math.min(list.length - 1, cursor + 1);
          renderList();
        } else if (event.name === 'select') {
          if (list.length > 0) renderDetail();
        } else if (event.name === 'hash') {
          renderForm();
        } else if (event.name === 'clear') {
          if (list.length > 0) renderConfirm();
        }
      } else if (view === 'detail') {
        if (event.name === 'back') {
          renderList();
        } else if (event.name === 'select' && list[cursor] !== undefined) {
          const chosen = list[cursor];
          window.dispatchEvent(new CustomEvent('os-call', { detail: { name: chosen.name, number: chosen.number } }));
        } else if (event.name === 'clear') {
          renderConfirm();
        }
      } else if (view === 'confirm') {
        if (event.name === 'select' || (event.name === 'digit' && event.digit === 5)) {
          deleteCurrent();
        } else if (event.name === 'back' || event.name === 'clear') {
          renderList();
        }
      } else if (view === 'form') {
        if (event.name === 'up' || event.name === 'down') {
          formCursor =
            event.name === 'up' ? Math.max(0, formCursor - 1) : Math.min(2, formCursor + 1);
          updateFormCursor();
        } else if (event.name === 'select') {
          if (formCursor === 2) saveForm();
          else updateFormCursor();
        } else if (event.name === 'back') {
          nameInput = null;
          numberInput = null;
          renderList();
        } else if (event.name === 'digit' && event.digit !== undefined) {
          const target = formCursor === 0 ? nameInput : formCursor === 1 ? numberInput : null;
          if (target !== null) target.value += String(event.digit);
        } else if (event.name === 'clear') {
          const target = formCursor === 0 ? nameInput : formCursor === 1 ? numberInput : null;
          if (target !== null) target.value = target.value.slice(0, -1);
        }
      }
    },
  };
}
