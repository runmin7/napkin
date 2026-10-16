// 앱이 건드리는 모든 경로가 여기서 나온다.
//
// 메모와 설정이 놓이는 자리, 그리고 앱 자신이 들고 다니는 파일(preload·화면·아이콘·문서)의
// 자리를 함께 둔다. 경로를 각자 계산하면 폴더 구조를 바꿀 때마다 흩어진 곳을 전부 찾아야 한다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

/* ---------------------------------------------------------------- 사용자 파일 */

const APP_DIR = path.join(app.getPath('appData'), '빠른메모');
const NOTES_DIR = path.join(APP_DIR, 'notes');
const SETTINGS_PATH = path.join(APP_DIR, 'settings.json');
const BACKUP_PATH = path.join(APP_DIR, 'settings.backup.json');

/* ---------------------------------------------------------------- 앱 자신의 파일 */

// 이 파일은 src/main/ 안에 있다. 앱 뿌리는 두 단계 위다.
const ROOT_DIR = path.join(__dirname, '..', '..');

// preload도 번들 산출물이다. 소스는 src/preload.js에 있다.
// sandbox 안의 preload는 다른 파일을 require할 수 없어서 번들을 거쳐야 한다(src/preload.js 머리말 참고).
const PRELOAD_PATH = path.join(ROOT_DIR, 'renderer', 'bundle', 'preload.js');

function rendererFile(name) {
  return path.join(ROOT_DIR, 'renderer', name);
}

function assetFile(name) {
  return path.join(ROOT_DIR, 'assets', name);
}

function docFile(name) {
  return path.join(ROOT_DIR, name);
}

/* ---------------------------------------------------------------- 메모 폴더 */

function ensureDirs() {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
}

// 메모 폴더의 .txt 목록. 폴더를 읽지 못하면 빈 배열이 아니라 null을 돌려준다.
//
// 둘을 구분해야 하는 이유는 설정 정리(pruneMissing)에 있다. 읽지 못한 것을 "메모가 하나도
// 없다"로 받아들이면 즐겨찾기와 메모별 단축키를 통째로 지워 버린다.
function listNoteFiles() {
  try {
    return fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith('.txt'));
  } catch {
    return null;
  }
}

// 저장 도중에 멈춘 임시 파일이 남아 있을 수 있다. 목록에는 나오지 않지만 쌓이기만 하므로
// 켤 때 한 번 걷어낸다. 지우지 못해도 다음 저장이 같은 이름을 덮어쓴다.
function sweepTempNotes() {
  let leftovers;
  try {
    leftovers = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith('.txt.tmp'));
  } catch {
    return;
  }
  for (const name of leftovers) {
    try {
      fs.unlinkSync(path.join(NOTES_DIR, name));
    } catch {
      /* 지우지 못한 것은 다음에 켤 때 다시 시도한다 */
    }
  }
}

module.exports = {
  APP_DIR,
  NOTES_DIR,
  SETTINGS_PATH,
  BACKUP_PATH,
  PRELOAD_PATH,
  rendererFile,
  assetFile,
  docFile,
  ensureDirs,
  listNoteFiles,
  sweepTempNotes,
};
