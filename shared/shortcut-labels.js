// 전역 단축키의 이름.
//
// 설정 창(단축키를 받아내는 팝업 제목)과 메인 프로세스(중복·등록 실패 안내)가 같은 이름을
// 불러야 한다. 따로 적어 두면 한쪽만 고쳐져 같은 단축키가 화면마다 다른 이름으로 불린다.
//
// 이 파일은 메인과 화면 양쪽에서 읽힌다. 메인은 CommonJS로 그대로 읽고, 화면 쪽은
// esbuild가 번들에 넣어 준다.

// 이름은 설정 창에 보이는 대로 적는다. renderer/settings.html의 .field-label과 같은 글자여야
// 필드 이름과 그 필드를 눌렀을 때 뜨는 팝업 제목이 어긋나지 않는다.
// 새 메모는 전역 단축키로 내주지 않는다. 메모 창 안의 Ctrl+N이 그 일을 하고,
// 창이 없을 때는 트레이 메뉴에 있다(src/main/tray.js).
const SHORTCUT_LABELS = {
  toggleWindow: '창 보이기 / 숨기기',
};

module.exports = { SHORTCUT_LABELS };
