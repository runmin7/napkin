// 단축키 설정 창.

import { SHORTCUT_LABELS } from '../../shared/shortcut-labels.js';
import { captureShortcut, prettyAccelerator, isCapturing } from './keycapture.js';

const noteListEl = document.getElementById('note-shortcuts');
const messageEl = document.getElementById('message');

let shortcuts = {};
let noteShortcuts = [];

api.settings.onData((payload) => {
  shortcuts = { ...payload.shortcuts };
  noteShortcuts = payload.noteShortcuts;
  paintSlots();
  paintNoteShortcuts();
});

function paintSlots() {
  for (const slot of document.querySelectorAll('.keyslot')) {
    slot.querySelector('.value').textContent = prettyAccelerator(shortcuts[slot.dataset.key]);
  }
}

function paintNoteShortcuts() {
  noteListEl.textContent = '';
  if (noteShortcuts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '메모 목록에서 메모를 우클릭하면 지정할 수 있습니다.';
    noteListEl.appendChild(empty);
    return;
  }

  for (const item of noteShortcuts) {
    const row = document.createElement('div');
    row.className = 'note-shortcut';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title || '(빈 메모)';

    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = prettyAccelerator(item.accelerator);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'link';
    clear.textContent = '해제';
    clear.title = '이 메모의 단축키를 해제합니다';
    clear.addEventListener('click', async () => {
      await api.settings.clearNoteShortcut(item.id);
      showMessage(`"${item.title || '(빈 메모)'}" 단축키를 해제했습니다.`, 'ok');
    });

    row.append(name, key, clear);
    noteListEl.appendChild(row);
  }
}

function showMessage(text, kind) {
  messageEl.hidden = false;
  messageEl.className = `message ${kind}`;
  messageEl.textContent = text;
}

function clearMessage() {
  messageEl.hidden = true;
  messageEl.textContent = '';
}

for (const slot of document.querySelectorAll('.keyslot')) {
  slot.addEventListener('click', async () => {
    const key = slot.dataset.key;
    const picked = await captureShortcut({
      title: SHORTCUT_LABELS[key],
      target: '전역 단축키 · 다른 프로그램을 쓰는 중에도 동작합니다',
      current: shortcuts[key],
      // 여기서는 받아만 두고, 실제 등록은 저장할 때 한꺼번에 확인한다.
      verify: (accelerator) => {
        const duplicated = Object.keys(shortcuts).find((other) => other !== key && shortcuts[other] === accelerator);
        if (duplicated) return { ok: false, reason: `${SHORTCUT_LABELS[duplicated]}와 같은 조합입니다.` };
        return { ok: true };
      },
    });
    if (!picked) return;
    shortcuts[key] = picked;
    paintSlots();
    clearMessage();
  });
}

document.getElementById('save').addEventListener('click', async () => {
  const result = await api.settings.save(shortcuts);
  if (result.ok) showMessage('저장했습니다.', 'ok');
  else showMessage(result.reason, 'error');
});

document.getElementById('close').addEventListener('click', () => api.settings.close());

document.addEventListener('keydown', (e) => {
  // 단축키를 받아내는 창이 떠 있으면 그쪽이 먼저 가져간다.
  if (isCapturing()) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    api.settings.close();
  }
});

api.settings.ready();
