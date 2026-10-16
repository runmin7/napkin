// 창을 만들고 보이고 숨기고 크기를 잡는 일.
//
// 이 파일은 메모의 내용을 모른다. 무엇을 보여 줄지는 편집 세션이 정하고, 여기서는
// 그것을 담을 창만 다룬다. 창 안에서 벌어진 일(포커스를 잃었다, 닫힌다)을 세션에 알려야
// 할 때는 부팅할 때 꽂아 준 hooks를 부른다. 그러지 않으면 창과 세션이 서로를 알아야 한다.

const { BrowserWindow, nativeImage, screen, shell, dialog } = require('electron');
const fs = require('fs');
const { settings, saveSettings } = require('./settings-store');
const { PRELOAD_PATH, rendererFile, assetFile, docFile } = require('./paths');
const { EDITOR, SETTINGS } = require('../../shared/channels');

// 목록 패널 너비. 목록은 늘 붙어 있으므로 창을 만들 때 더하고, 창 크기를 기록할 때 뺀다.
// renderer/css/editor.css의 .side-list width와 반드시 같아야 한다. 어긋나면 편집 영역이 밀린다.
const PANEL_WIDTH = 340;
const MIN_EDITOR_WIDTH = 300;
const MIN_EDITOR_HEIGHT = 220;
// 저장된 위치를 되살릴 때, 최소한 이만큼은 화면 안에 들어와야 창을 붙잡아 옮길 수 있다.
const TITLEBAR_GRIP = 40;

let editorWin = null;
let settingsWin = null;
let helpWin = null;
let isQuitting = false;
let trayAvailable = true;

// 편집 창에서 벌어진 일을 세션에 알리는 통로. main.js가 부팅할 때 꽂아 준다.
let hooks = { onFlush: () => {}, onShow: () => {} };

function setEditorHooks(next) {
  hooks = { ...hooks, ...next };
}

// 창이 아직 살아 있는가. Electron의 창 객체는 닫힌 뒤에도 변수에 남아 있어서,
// 확인하지 않고 부르면 파괴된 객체를 건드렸다는 예외가 난다.
function alive(win) {
  return Boolean(win) && !win.isDestroyed();
}

function trayIconImage() {
  const image = nativeImage.createFromPath(assetFile('tray.png'));
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

// 모든 창이 공유하는 바탕. 화면 쪽 코드에 Node를 열어 주지 않는 것이 핵심이다.
function windowOptions(extra = {}) {
  const { webPreferences, ...rest } = extra;
  return {
    autoHideMenuBar: true,
    icon: trayIconImage(),
    ...rest,
    webPreferences: { contextIsolation: true, nodeIntegration: false, ...webPreferences },
  };
}

/* ---------------------------------------------------------------- 앱 상태 */

function markQuitting() {
  isQuitting = true;
}

function isTrayAvailable() {
  return trayAvailable;
}

// 트레이를 만들지 못하면 창 닫기가 곧 종료가 된다. 되살릴 방법 없이 프로세스만 남는 상태를 피한다.
function setTrayUnavailable() {
  trayAvailable = false;
}

/* ---------------------------------------------------------------- 편집 창 */

function editorWindow() {
  return alive(editorWin) ? editorWin : null;
}

function sendToEditor(channel, payload) {
  if (alive(editorWin)) editorWin.webContents.send(channel, payload);
}

// 창 제목과 작업표시줄에 메모 첫 줄이 그대로 보이게 한다.
function setEditorTitle(text) {
  if (!alive(editorWin)) return;
  if (editorWin.getTitle() !== text) editorWin.setTitle(text);
}

// 저장된 창 위치가 지금 화면 구성에는 없는 자리일 수 있다. 사무실에서 듀얼 모니터로 쓰다가
// 노트북만 열었을 때가 그렇다. 그대로 띄우면 창이 보이지 않는 곳에 뜨고, 트레이를 눌러도
// 나타나지 않아 앱이 고장난 것처럼 보인다. 어느 화면에도 걸치지 않으면 그 위치는 버린다.
function onScreen(bounds, width) {
  if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return null;

  // 가로도 세로와 같은 기준을 쓴다. 모서리 한 줄만 걸친 위치를 되살리면 창을 붙잡을 수 없다.
  const visible = screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      bounds.x + width - TITLEBAR_GRIP > workArea.x && bounds.x + TITLEBAR_GRIP < workArea.x + workArea.width;
    const overlapY = bounds.y < workArea.y + workArea.height && bounds.y + TITLEBAR_GRIP > workArea.y;
    return overlapX && overlapY;
  });
  return visible ? bounds : null;
}

// 목록까지 붙인 창이 화면 오른쪽 밖으로 넘치면 넘친 만큼 왼쪽으로 당긴다.
// 저장된 x는 글 쓰는 자리만 있던 시절의 자리여서, 패널을 더하면 그만큼 오른쪽으로 삐져나간다.
// 그대로 두면 창을 오른쪽 가장자리에 붙여 쓰던 경우 목록이 화면 밖에 걸려 보이지 않는다.
function pullInside(bounds, width) {
  const area = screen.getDisplayMatching({ ...bounds, width, height: bounds.height || 460 }).workArea;
  if (bounds.x + width <= area.x + area.width) return bounds.x;
  return Math.max(area.x, area.x + area.width - width);
}

// 메모에 어떤 주소가 적혀 있을지 알 수 없다. 웹 주소만 바깥으로 넘기고 나머지는 무시한다.
// file: 같은 스킴을 그대로 넘기면 눌리는 것만으로 다른 프로그램이 열릴 수 있다.
function openExternalSafely(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function createEditor() {
  // 저장된 너비는 패널을 뺀 글 쓰는 자리의 너비다. 목록은 늘 붙어 있으므로 그만큼 다시 더해 연다.
  const bounds = settings.windowBounds || {};
  const width = (bounds.width || 520) + PANEL_WIDTH;
  const spot = onScreen(bounds, width);
  const x = spot ? pullInside(spot, width) : undefined;

  editorWin = new BrowserWindow(
    windowOptions({
      width,
      height: bounds.height || 460,
      // 쓸 수 없는 좌표는 넘기지 않는다. 비워 두면 Electron이 화면 가운데에 놓는다.
      x,
      y: spot ? spot.y : undefined,
      alwaysOnTop: settings.alwaysOnTop,
      minWidth: MIN_EDITOR_WIDTH + PANEL_WIDTH,
      minHeight: MIN_EDITOR_HEIGHT,
      title: '빠른 메모',
      backgroundColor: '#fdfcf7',
      webPreferences: { preload: PRELOAD_PATH },
    })
  );
  editorWin.setMenu(null);
  editorWin.loadFile(rendererFile('editor.html'));

  // 창 제목은 메모 첫 줄로 직접 관리한다. 문서의 <title>이 이를 덮어쓰지 않게 막는다.
  editorWin.on('page-title-updated', (e) => e.preventDefault());

  // 렌더링한 메모 안의 링크를 눌러도 이 창은 자리를 지킨다. 편집 창이 다른 주소로 떠나면
  // 편집기도 목록도 상태바도 함께 사라지고, 트레이로 불러도 그 창이라 돌아올 길이 없다.
  // CSP는 스크립트를 막을 뿐 창이 옮겨 가는 것은 막지 못한다. 주소는 기본 브라우저에 넘긴다.
  // 파일을 창에 끌어다 놓았을 때 그 파일로 넘어가 버리는 것도 여기서 함께 막힌다.
  editorWin.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
  editorWin.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    openExternalSafely(url);
  });

  // 브라우저나 폴더 등 다른 프로그램으로 포커스가 넘어가는 순간 저장한다.
  editorWin.on('blur', () => hooks.onFlush());

  editorWin.on('close', (e) => {
    hooks.onFlush();
    rememberBounds();
    // 닫기는 종료가 아니라 숨기기다. 트레이에서 언제든 다시 부를 수 있어야 한다.
    if (!isQuitting && trayAvailable) {
      e.preventDefault();
      editorWin.hide();
    }
  });
  editorWin.on('hide', () => hooks.onFlush());

  // 숨겨 둔 사이에 탐색기에서 메모를 지웠거나 되살렸을 수 있다. 다시 보이는 순간 목록을
  // 디스크 기준으로 맞춘다. 전에는 목록을 펼칠 때마다 다시 만들었던 자리다.
  editorWin.on('show', () => hooks.onShow());
  editorWin.on('resize', rememberBounds);
  editorWin.on('move', rememberBounds);
}

// 창을 끄는 동안 resize·move가 연달아 들어온다. 멈춘 뒤에 한 번만 기록한다.
let boundsTimer = null;

function rememberBounds() {
  if (!alive(editorWin) || editorWin.isMinimized()) return;
  // 패널을 뺀 너비로 기록한다. 그러지 않으면 켤 때마다 창이 패널 너비만큼 계속 커진다.
  const live = editorWin.getBounds();
  settings.windowBounds = {
    x: live.x,
    y: live.y,
    width: Math.max(live.width - PANEL_WIDTH, MIN_EDITOR_WIDTH),
    height: live.height,
  };
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(saveSettings, 400);
}

// 창을 옮긴 직후 종료해도 마지막 위치가 남도록 미뤄 둔 기록을 지금 쓴다.
function flushBounds() {
  clearTimeout(boundsTimer);
  saveSettings();
}

function showEditor() {
  if (!alive(editorWin)) createEditor();
  if (editorWin.isMinimized()) editorWin.restore();
  editorWin.show();
  editorWin.focus();
}

function hideEditor() {
  if (alive(editorWin)) editorWin.hide();
}

// 단축키로 부를 때는 창이 다른 창에 가려져 있으면 앞으로 끌어온다.
// 트레이 클릭은 그 순간 창이 이미 포커스를 잃으므로 보이는지만 본다.
function toggleEditor({ requireFocus = true } = {}) {
  if (alive(editorWin) && editorWin.isVisible() && (!requireFocus || editorWin.isFocused())) {
    editorWin.hide();
    return;
  }
  showEditor();
}

// 다른 창 위에 계속 떠 있게 한다. 메모를 보면서 다른 작업을 할 때 쓴다.
function toggleAlwaysOnTop() {
  settings.alwaysOnTop = !settings.alwaysOnTop;
  saveSettings();

  for (const win of [editorWin, settingsWin, helpWin]) {
    if (alive(win)) win.setAlwaysOnTop(settings.alwaysOnTop);
  }
  sendToEditor(EDITOR.PIN, settings.alwaysOnTop);
}


/* ---------------------------------------------------------------- 딸린 창 */

function createChildWindow(file, opts) {
  const win = new BrowserWindow(
    windowOptions({
      width: opts.width,
      height: opts.height,
      // 편집 창을 위에 고정해 두었다면 설정 창이 그 뒤로 숨지 않게 함께 올린다.
      alwaysOnTop: settings.alwaysOnTop,
      title: opts.title,
      backgroundColor: '#fdfcf7',
      webPreferences: { preload: PRELOAD_PATH },
    })
  );
  win.setMenu(null);
  win.loadFile(rendererFile(file));
  return win;
}

function openSettingsWindow() {
  if (alive(settingsWin)) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = createChildWindow('settings.html', { width: 480, height: 560, title: '단축키 설정' });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

function closeSettingsWindow() {
  if (alive(settingsWin)) settingsWin.close();
}

// 설정 창이 떠 있는가. 보낼 내용을 만드는 데 드는 비용이 있으므로, 부르는 쪽이
// 만들기 전에 먼저 물어볼 수 있어야 한다(settingsPayload는 메모 폴더를 훑는다).
function hasSettingsWindow() {
  return alive(settingsWin);
}

function sendToSettings(payload) {
  if (alive(settingsWin)) settingsWin.webContents.send(SETTINGS.DATA, payload);
}

// 사용 설명서는 브라우저에 맡기지 않고 앱 안에서 연다.
// 나중에 exe로 묶으면 문서가 패키지 안으로 들어가 외부 프로그램은 열 수 없게 되지만,
// 앱이 직접 띄우면 그때도 경로가 그대로 유효하다.
// 문서 창은 하나를 돌려 쓴다. 사용법과 개발 문서를 나란히 볼 일은 없고,
// 창이 여러 개로 늘어나는 것이 이 앱의 성격과 맞지 않는다.
function openDocWindow(fileName, fallbackTitle) {
  const target = docFile(fileName);
  if (!fs.existsSync(target)) {
    dialog.showMessageBox({
      type: 'warning',
      title: '문서를 찾지 못했습니다',
      message: `${fallbackTitle} 파일이 없습니다.`,
      detail: `${target}\n\n파일이 지워졌거나 옮겨진 것 같습니다.`,
    });
    return;
  }

  if (alive(helpWin)) {
    if (helpWin.isMinimized()) helpWin.restore();
    helpWin.loadFile(target);
    helpWin.show();
    helpWin.focus();
    return;
  }

  helpWin = new BrowserWindow(
    windowOptions({
      width: 880,
      height: 780,
      minWidth: 420,
      minHeight: 320,
      title: fallbackTitle,
      backgroundColor: '#fcfbf8',
      // 문서를 읽는 창이라 맞춤법 검사가 필요 없다. 기본값이 true라 꺼 준다.
      // 여기에는 preload를 붙이지 않는다. 문서는 앱에 요청할 일이 없다.
      webPreferences: { spellcheck: false },
    })
  );
  helpWin.setMenu(null);
  helpWin.loadFile(target);

  // 문서 안의 링크는 이 창을 덮어쓰지 않고 기본 브라우저로 보낸다.
  helpWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  helpWin.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape') return;
    event.preventDefault();
    // 키 처리 도중에 창을 없애지 않도록 한 박자 미룬다.
    setImmediate(() => {
      if (alive(helpWin)) helpWin.close();
    });
  });

  helpWin.on('closed', () => {
    helpWin = null;
  });
}

module.exports = {
  setEditorHooks,
  trayIconImage,
  markQuitting,
  isTrayAvailable,
  setTrayUnavailable,

  editorWindow,
  sendToEditor,
  setEditorTitle,
  showEditor,
  hideEditor,
  toggleEditor,
  rememberBounds,
  flushBounds,
  toggleAlwaysOnTop,

  openSettingsWindow,
  closeSettingsWindow,
  hasSettingsWindow,
  sendToSettings,
  openDocWindow,
};
