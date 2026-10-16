// 전역 단축키 등록. 다른 프로그램을 쓰는 중에도 도는 조합들이다.

const { globalShortcut, dialog } = require('electron');
const { settings } = require('./settings-store');
const { describeAccelerator } = require('./accelerators');

// 단축키를 누르면 무슨 일이 일어나는지는 이 파일이 정하지 않는다. 부팅할 때 배선해 준다.
// 그러지 않으면 단축키가 메모를 열고 창을 여는 쪽을 알아야 해서 의존이 거꾸로 돈다.
let actions = {
  toggleWindow: () => {},
  openNote: () => {},
};

function setActions(next) {
  actions = next;
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const failed = [];
  const bind = (accelerator, handler) => {
    if (!accelerator) return;
    try {
      if (!globalShortcut.register(accelerator, handler)) failed.push(accelerator);
    } catch {
      failed.push(accelerator);
    }
  };

  bind(settings.shortcuts.toggleWindow, () => actions.toggleWindow());
  for (const [id, accelerator] of Object.entries(settings.noteShortcuts)) {
    bind(accelerator, () => actions.openNote(id));
  }
  return failed;
}

// 재등록 결과를 한 곳에서 처리한다. registerShortcuts()는 매번 전부 해제하고 다시 등록하므로,
// 지금 바꾼 조합 말고 원래 멀쩡하던 단축키가 실패했을 수도 있다. 그것까지 알려야
// 설정에는 남아 있는데 실제로는 안 먹는 단축키가 생기지 않는다.
// expect에 적은 조합은 호출한 쪽이 결과를 받아 직접 안내하므로 여기서 두 번 알리지 않는다.
function applyShortcuts({ expect = [] } = {}) {
  const expected = Array.isArray(expect) ? expect : [expect];
  const failed = registerShortcuts();
  const unexpected = failed.filter((accelerator) => !expected.includes(accelerator));
  if (unexpected.length > 0) warnShortcutFailure(unexpected);
  return failed;
}

function warnShortcutFailure(accelerators) {
  dialog.showMessageBox({
    type: 'warning',
    title: '단축키 등록 실패',
    message: '일부 단축키가 등록되지 않았습니다.',
    detail: `${accelerators.map(describeAccelerator).join('\n')}\n\n다른 프로그램이 이미 쓰고 있는 조합입니다. 트레이 메뉴의 "단축키 설정"에서 다른 조합으로 바꿔 주세요.`,
  });
}

function unregisterAll() {
  globalShortcut.unregisterAll();
}

/* ---------------------------------------------------------------- 받아내는 동안 */

// 새 조합을 받아내는 동안에는 전역 단축키를 내려놓는다. 등록된 채로 두면 OS가 키를 먼저
// 가로채 두 가지가 한꺼번에 어긋난다. 눌러도 받아내는 창까지 닿지 않아 지금 쓰고 있는
// 조합을 다시 지정할 수 없고, 그러는 사이 그 기능이 실제로 실행된다. 창 보이기/숨기기라면
// 창이 그대로 사라져 받아내던 화면이 포커스를 잃는다.
let capturing = false;

function beginCapture() {
  capturing = true;
  globalShortcut.unregisterAll();
}

// 받아내기를 마쳤을 때, 취소했을 때, 받아내던 창이 닫혔을 때 모두 여기로 온다.
// 어느 길로 오든 한 번만 되돌리면 되므로 이미 되돌렸다면 그냥 나간다.
function endCapture() {
  if (!capturing) return;
  capturing = false;
  applyShortcuts();
}

module.exports = {
  setActions,
  registerShortcuts,
  applyShortcuts,
  unregisterAll,
  beginCapture,
  endCapture,
};
