// 단축키 조합이 이미 쓰이고 있는지 가린다.
//
// 등록에 성공하더라도 앱 안에서 겹치면 뒤에 등록된 쪽만 동작한다. 그래서 OS에 내주기 전에
// 여기서 먼저 따져 본다.

const { settings } = require('./settings-store');
const { readNote, titleOf } = require('./note-store');
// 설정 창도 같은 이름을 쓴다. 한쪽만 고쳐지지 않도록 shared에 둔다.
const { SHORTCUT_LABELS } = require('../../shared/shortcut-labels');

// 메모 창이 떠 있을 때만 도는 고정 단축키(renderer/editor.js). 설정으로 바꿀 수 없고
// 전역 단축키로도 내줄 수 없다. 여기 적어 두면 지정하려 할 때 미리 막힌다.
const WINDOW_SHORTCUTS = {
  'Ctrl+N': '새 메모',
  'Ctrl+PageUp': '이전 메모',
  'Ctrl+PageDown': '다음 메모',
  'Ctrl+F': '메모 안에서 찾기',
  'Ctrl+G': '다음 찾기',
  'Ctrl+D': '현재 줄 지우기',
  // 키 이름은 keycapture.js가 만드는 문자열과 같아야 한다. Enter는 거기서 Return으로 적힌다.
  'Ctrl+Return': '표 다음 줄 만들기',
};

// 저장하려는 값으로 미리 따져 볼 수 있도록 기본 단축키 쪽은 인자로 받는다.
function findAcceleratorOwner(accelerator, { shortcuts = settings.shortcuts, skipKey = null, skipNoteId = null } = {}) {
  // 전역으로 내주면 OS가 먼저 가로채 정작 메모 창 안에서는 눌리지 않게 된다.
  if (WINDOW_SHORTCUTS[accelerator]) return `메모 창의 "${WINDOW_SHORTCUTS[accelerator]}"`;
  for (const [key, value] of Object.entries(shortcuts)) {
    if (value === accelerator && key !== skipKey) return SHORTCUT_LABELS[key] || '기본 단축키';
  }
  for (const [id, value] of Object.entries(settings.noteShortcuts)) {
    if (value === accelerator && id !== skipNoteId) {
      const title = titleOf(readNote(id));
      return `메모 "${title || id}"`;
    }
  }
  return null;
}

function describeAccelerator(accelerator) {
  const owner = findAcceleratorOwner(accelerator);
  return owner ? `${accelerator} — ${owner}` : accelerator;
}

module.exports = { SHORTCUT_LABELS, WINDOW_SHORTCUTS, findAcceleratorOwner, describeAccelerator };
