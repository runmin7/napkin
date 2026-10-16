// 저장이 안 되고 있다는 사실을 들고 있다가 알리는 곳.
//
// 저장 실패는 이 앱에서 가장 알려야 할 사고다. "저장은 알아서 된다"는 약속이 깨진 순간인데
// 조용히 넘기면 사용자는 아무것도 모른 채 계속 쓴다. 상태바에 곧바로 띄우고,
// 그래도 계속 실패하면 한 번은 창을 띄워 확실히 알린다.

const { dialog } = require('electron');
const { NOTES_DIR } = require('./paths');
const windows = require('./windows');
const { NOTE } = require('../../shared/channels');

const DIALOG_AT = 3;

let failures = 0;
let warned = false;

function report(message) {
  failures += 1;
  windows.sendToEditor(NOTE.SAVE_FAILED, { message });
  if (failures < DIALOG_AT || warned) return;

  warned = true;
  dialog.showMessageBox({
    type: 'error',
    title: '메모를 저장하지 못했습니다',
    message: '메모가 저장되지 않고 있습니다.',
    detail: `${message}\n\n지금까지 쓴 내용은 창에 그대로 남아 있습니다. 다른 곳에 옮겨 두고 저장 폴더를 확인해 주세요.\n다른 메모로 넘어가거나 앱을 끄려고 하면 한 번 더 붙잡아 알려 드립니다.\n\n${NOTES_DIR}`,
  });
}

function clear() {
  if (failures === 0) return;
  failures = 0;
  warned = false;
}

// 저장이 안 되는 상태에서 다른 메모로 넘어가면 화면에 남아 있던 글이 그대로 사라진다.
// 한 번에 하나만 여는 앱이라 넘어가는 순간 되돌릴 방법이 없으므로, 그 전에 멈춰 세운다.
//
// dirty는 화면에만 있고 디스크에 닿지 않은 내용이 있는지다. 그 판단은 편집 세션이 한다.
// 넘어가도 좋다고 답해야 true.
function confirmLeaveUnsaved(detail, dirty) {
  if (failures === 0 || !dirty) return true;

  const options = {
    type: 'warning',
    buttons: ['머무르기', '그래도 넘어가기'],
    defaultId: 0,
    cancelId: 0,
    title: '저장되지 않았습니다',
    message: '이 메모가 저장되지 않았습니다.',
    detail,
  };
  const parent = windows.editorWindow();
  const answer = parent ? dialog.showMessageBoxSync(parent, options) : dialog.showMessageBoxSync(options);
  return answer === 1;
}

module.exports = { report, clear, confirmLeaveUnsaved };
