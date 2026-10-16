// 설정 파일의 읽기·쓰기·복구.
//
// 메모 본문이 아니라 그 둘레의 것들을 들고 있다. 전역 단축키 조합, 즐겨찾기 순서,
// 메모별 단축키, 마지막으로 보던 메모, 창 위치와 크기.

const fs = require('fs');
const { SETTINGS_PATH, BACKUP_PATH, listNoteFiles } = require('./paths');
const { writeAtomic } = require('./atomic-write');

const DEFAULT_SETTINGS = {
  // 여기 적힌 것만 전역 단축키로 남는다. knownShortcuts()가 이 키 목록으로 걸러내므로,
  // 예전에 쓰던 조합이 설정 파일에 남아 있어도 읽어들이는 순간 함께 정리된다.
  shortcuts: {
    toggleWindow: 'Ctrl+Alt+M',
  },
  favorites: [],
  noteShortcuts: {},
  // 조회 전용으로 표시한 메모. 열면 편집기 대신 렌더링된 모습이 먼저 나온다.
  // 잠그는 것이 아니라 여는 순간의 기본값일 뿐이라, 미리보기 버튼을 누르면 그 자리에서 편집으로 돌아간다.
  viewOnlyNotes: [],
  lastNote: null,
  windowBounds: null,
  alwaysOnTop: false,
};

// 설정 객체는 참조를 고정한다. 여러 모듈이 이 객체를 그대로 들고 쓰기 때문에,
// 다시 읽어들일 때도 새 객체로 갈아 끼우지 않고 내용만 덮어쓴다.
const settings = { ...DEFAULT_SETTINGS };

function readSettingsFile(target) {
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// 본 파일도 백업도 못 읽은 경우. 깨진 파일을 옆에 남겨 두면 나중에 열어볼 수 있다.
function keepCorruptSettings() {
  try {
    fs.renameSync(SETTINGS_PATH, `${SETTINGS_PATH}.corrupt`);
  } catch {
    /* 옮기지 못해도 아래에서 새 설정으로 덮어쓴다 */
  }
  return true;
}

// 지금 쓰이는 단축키만 남긴다. 없어진 기능의 조합이 설정 파일에 남아 있으면, 아무 일도
// 하지 않으면서 그 조합을 차지한 것처럼 보여(accelerators.js의 중복 검사) 다른 단축키에
// 지정할 수 없게 된다.
function knownShortcuts(loaded) {
  const saved = (loaded && loaded.shortcuts) || {};
  const result = { ...DEFAULT_SETTINGS.shortcuts };
  for (const key of Object.keys(result)) {
    if (typeof saved[key] === 'string' && saved[key]) result[key] = saved[key];
  }
  return result;
}

// 설정을 통째로 잃었으면 true를 돌려준다. 부른 쪽이 그 사실을 사용자에게 알린다.
function loadSettings() {
  const hadFile = fs.existsSync(SETTINGS_PATH);
  let loaded = readSettingsFile(SETTINGS_PATH);
  let recovered = false;
  let lost = false;

  // 설정 파일이 깨졌다면(종료 도중 전원이 끊긴 경우 등) 직전 백업에서 되살린다.
  // 여기서 그냥 기본값으로 넘어가면 즐겨찾기와 메모별 단축키가 조용히 사라진다.
  if (!loaded && hadFile) {
    loaded = readSettingsFile(BACKUP_PATH);
    recovered = loaded !== null;
    if (recovered) console.warn('설정이 손상되어 백업에서 복구했습니다.');
    else lost = keepCorruptSettings();
  }

  Object.assign(settings, {
    ...DEFAULT_SETTINGS,
    ...(loaded || {}),
    shortcuts: knownShortcuts(loaded),
    favorites: loaded && Array.isArray(loaded.favorites) ? loaded.favorites : [],
    viewOnlyNotes: loaded && Array.isArray(loaded.viewOnlyNotes) ? loaded.viewOnlyNotes : [],
    noteShortcuts:
      loaded && loaded.noteShortcuts && typeof loaded.noteShortcuts === 'object' ? loaded.noteShortcuts : {},
  });
  pruneMissing();

  // 깨진 파일을 그대로 두면 켤 때마다 복구를 거치게 된다. 지금 바로 성한 내용으로 되돌린다.
  if (recovered || lost) saveSettings();

  // 이번에 온전하게 읽어낸 설정을 백업해 둔다. 다음 번 손상 때 돌아올 지점이 된다.
  try {
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    /* 백업 실패가 실행을 막을 이유는 없다 */
  }

  return lost;
}

function saveSettings() {
  writeAtomic(SETTINGS_PATH, JSON.stringify(settings, null, 2), '설정 저장 실패');
}

// 탐색기에서 파일을 직접 지웠거나 동기화가 어긋난 경우, 실제로 없는 메모를 가리키는 항목을 걷어낸다.
function pruneMissing() {
  const files = listNoteFiles();
  // 폴더를 읽지 못했다면 아무것도 지우지 않는다. 메모가 없는 것과 못 본 것은 다르다.
  if (!files) return;

  const existing = new Set(files);
  settings.favorites = settings.favorites.filter((id) => existing.has(id));
  settings.viewOnlyNotes = settings.viewOnlyNotes.filter((id) => existing.has(id));
  for (const id of Object.keys(settings.noteShortcuts)) {
    if (!existing.has(id)) delete settings.noteShortcuts[id];
  }
  if (settings.lastNote && !existing.has(settings.lastNote)) settings.lastNote = null;
}

// 마지막으로 보던 메모는 바뀔 때만 기록한다. 저장할 때마다 설정 파일까지 건드릴 이유가 없다.
function rememberLastNote(id) {
  if (settings.lastNote === id) return;
  settings.lastNote = id;
  saveSettings();
}

module.exports = { settings, loadSettings, saveSettings, pruneMissing, rememberLastNote };
