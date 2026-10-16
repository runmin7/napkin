// 빠른 메모 - 트레이에 상주하는 자동저장 메모장.
//
// 이 파일이 하는 일은 두 가지뿐이다. 앱을 켜고 끄는 순서를 정하는 것, 그리고 모듈끼리
// 서로를 알지 않아도 되도록 필요한 동작만 꽂아 주는 것. 실제로 하는 일은 src/main/ 아래에 있다.
//
//   paths          앱이 건드리는 모든 경로
//   atomic-write   쓰다 멈춰도 원본이 깨지지 않는 파일 쓰기
//   settings-store 설정 읽기·쓰기·손상 복구
//   note-store     메모 파일 자체
//   note-list      목록 패널에 보낼 목록과 검색
//   markdown       미리보기용 HTML 변환
//   accelerators   단축키 조합이 겹치는지
//   shortcuts      전역 단축키 등록
//   windows        창을 만들고 보이고 크기를 잡는 일
//   save-failure   저장이 안 되고 있다는 사실을 알리는 일
//   session        지금 편집 중인 메모와 그것을 둘러싼 동작들
//   tray           트레이 아이콘과 메뉴
//   ipc            화면에서 오는 요청의 배선

const { app, dialog } = require('electron');
const { ensureDirs, sweepTempNotes, SETTINGS_PATH } = require('./src/main/paths');
const { loadSettings } = require('./src/main/settings-store');
const shortcuts = require('./src/main/shortcuts');
const windows = require('./src/main/windows');
const session = require('./src/main/session');
const { setUpTray } = require('./src/main/tray');
const { registerIpc } = require('./src/main/ipc');

// 아래쪽 모듈이 위쪽 모듈을 직접 부르지 않도록, 필요한 동작만 여기서 건네준다.
// 이렇게 하지 않으면 창이 편집 세션을 알아야 하고 세션도 창을 알아야 해서 서로를 물고 돈다.
// 거꾸로 흐르는 연결은 이 함수 안에 있는 것이 전부다.
function wireModules() {
  // 창이 포커스를 잃거나 닫히는 순간의 저장, 그리고 다시 보일 때의 목록 갱신.
  // 창은 무엇을 저장하는지도, 목록이 어떻게 만들어지는지도 몰라도 된다.
  windows.setEditorHooks({ onFlush: session.flushDraft, onShow: session.refreshList });

  // 전역 단축키를 눌렀을 때 할 일. 단축키 등록기는 메모를 여는 법을 몰라도 된다.
  shortcuts.setActions({
    toggleWindow: () => windows.toggleEditor(),
    openNote: session.openNote,
  });
}

// 시작프로그램 바로가기가 이 인자를 달고 앱을 부른다(deploy.ps1이 바로가기를 만든다).
// 로그인 직후 메모 창이 떠서 하려던 일의 포커스를 뺏지 않도록, 이때는 트레이에만 올라간다.
// 창은 트레이 클릭이나 전역 단축키로 부를 때 그제야 열린다.
const startedHidden = process.argv.includes('--autostart');

// 두 번째 실행은 새 창을 띄우는 대신 이미 떠 있는 창을 살린다. 메모는 언제나 하나만 열린다.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => windows.showEditor());

  app.whenReady().then(() => {
    ensureDirs();
    sweepTempNotes();
    const settingsLost = loadSettings();
    wireModules();
    registerIpc();
    setUpTray();
    shortcuts.applyShortcuts();

    // 설정을 되살리지 못했다면 즐겨찾기와 메모별 단축키가 초기화된다. 조용히 넘기지 않는다.
    if (settingsLost) {
      dialog.showMessageBox({
        type: 'warning',
        title: '설정이 초기화되었습니다',
        message: '설정 파일을 읽지 못해 기본값으로 시작합니다.',
        detail: `즐겨찾기와 메모별 단축키가 초기화되었습니다. 메모 자체는 그대로 있습니다.\n\n읽지 못한 파일은 아래에 남겨 두었습니다.\n${SETTINGS_PATH}.corrupt`,
      });
    }

    // 트레이를 만들지 못했다면 창이 앱을 부를 유일한 통로다. 그때는 조용히 켜려던 참이어도
    // 창을 띄운다. 그러지 않으면 창도 트레이도 없이 프로세스만 남아 되살릴 길이 없어진다.
    session.openInitialNote({ silent: startedHidden && windows.isTrayAvailable() });
  });

  app.on('before-quit', (e) => {
    session.flushDraft();
    // 저장이 안 되는 채로 나가면 쓴 글이 사라진다. 멈춰 세울 마지막 기회가 여기다.
    // 종료 표시는 이 확인을 통과한 뒤에 세운다. 미리 세워 두면 종료를 취소하고도
    // 창을 닫는 순간 앱이 꺼져 버린다.
    const detail = '지금 종료하면 방금 쓴 내용이 사라집니다.\n\n종료를 멈추고 내용을 다른 곳에 옮겨 두시기를 권합니다.';
    if (!session.confirmLeaveUnsaved(detail)) {
      e.preventDefault();
      return;
    }

    windows.markQuitting();
    // 창을 옮긴 직후 종료해도 마지막 위치가 남도록 미뤄 둔 기록을 지금 쓴다.
    windows.flushBounds();
  });

  app.on('will-quit', () => {
    shortcuts.unregisterAll();
  });

  // 창을 모두 닫아도 트레이에 남는다. 종료는 트레이 메뉴에서만 한다.
  // 트레이를 만들지 못한 경우에만, 되살릴 방법이 없으므로 그대로 종료한다.
  app.on('window-all-closed', () => {
    if (!windows.isTrayAvailable()) app.quit();
  });
}
