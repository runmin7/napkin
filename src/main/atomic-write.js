// 파일을 통째로 갈아 끼우는 쓰기.
//
// 임시 파일에 먼저 쓰고 rename으로 바꿔 놓는다. 쓰는 도중 전원이 끊겨도 원래 파일은
// 잘리지 않고 온전한 상태로 남는다. 설정과 메모가 같은 방식으로 지켜진다.

const fs = require('fs');

// 성공하면 null, 실패하면 알릴 말을 돌려준다.
// label은 콘솔에 남길 이름이다. 설정과 메모 중 어느 쪽이 실패했는지 로그에서 구분된다.
function writeAtomic(target, text, label) {
  const temp = `${target}.tmp`;
  try {
    fs.writeFileSync(temp, text, 'utf8');
    fs.renameSync(temp, target);
    return null;
  } catch (err) {
    console.error(`${label}:`, err);
    try {
      fs.unlinkSync(temp);
    } catch {
      /* 남은 임시 파일은 다음 저장에서 덮인다 */
    }
    return String(err.message || err);
  }
}

module.exports = { writeAtomic };
