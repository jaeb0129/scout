// 로그인 허용 계정 목록.
// 여기 없는 구글 계정은 로그인 팝업에서 계정을 선택해도 App.jsx가 바로 signOut 시키고
// 안내 메시지만 보여줍니다 - 화면 UX 처리일 뿐이고, 진짜 접근 통제는 firestore.rules의
// isAllowedUser()에 있는 동일한 목록입니다. 계정을 추가/제거할 땐 반드시 두 곳(이 파일 +
// firestore.rules)을 같이 바꾸고 firestore.rules는 배포(firebase deploy --only firestore:rules)
// 까지 해야 실제로 반영됩니다.
export const ALLOWED_EMAILS = [
  "doosanbearsdata@gmail.com",
  "jaeb129@gmail.com",
];
