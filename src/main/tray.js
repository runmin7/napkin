// 트레이 아이콘과 그 메뉴.
//
// 트레이는 창을 닫은 뒤 앱을 다시 부를 유일한 통로다. 만들지 못하면 그 사실을 알리고
// 창 닫기를 종료로 바꿔, 되살릴 방법 없이 프로세스만 남는 상태를 피한다.

const { app, Tray, Menu, dialog } = require('electron');
const windows = require('./windows');
const session = require('./session');

let tray = null;

function createTray() {
  tray = new Tray(windows.trayIconImage());
  tray.setToolTip('빠른 메모');

  const menu = Menu.buildFromTemplate([
    { label: '새 메모', click: session.newNote },
    { type: 'separator' },
    { label: '단축키 설정', click: session.openSettings },
    { label: '사용법', click: () => windows.openDocWindow('빠른메모_사용설명서.html', '빠른 메모 사용법') },
    { label: '개발자 문서', click: () => windows.openDocWindow('빠른메모_개발자문서.html', '빠른 메모 개발자 문서') },
    { type: 'separator' },
    // isQuitting은 before-quit이 세운다. 저장에 실패한 상태라면 그곳에서 종료를 되돌릴 수 있어야 한다.
    { label: '종료', click: () => app.quit() },
  ]);

  tray.on('click', () => windows.toggleEditor({ requireFocus: false }));
  tray.on('right-click', () => tray.popUpContextMenu(menu));
}

function setUpTray() {
  try {
    createTray();
  } catch (err) {
    console.error('트레이 생성 실패:', err);
    windows.setTrayUnavailable();
    dialog.showMessageBox({
      type: 'warning',
      title: '트레이 아이콘 없이 실행합니다',
      message: '트레이 아이콘을 만들지 못했습니다.',
      detail: `${String(err.message || err)}\n\n창을 닫으면 앱이 종료됩니다. 단축키는 그대로 동작합니다.`,
    });
  }
}

module.exports = { setUpTray };
