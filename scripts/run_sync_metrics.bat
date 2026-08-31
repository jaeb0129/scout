@echo off
rem 지표 동기화를 더블클릭 한 번으로 실행하기 위한 스크립트.
rem 이 파일이 있는 scripts 폴더의 상위(리포지토리 루트)로 이동한 뒤 실행합니다 -
rem .env / firebase-service-account.json 등 상대 경로가 리포지토리 루트 기준으로 맞춰져 있기 때문입니다.

cd /d "%~dp0\.."

echo === 지표 동기화 시작 ===
python scripts\sync_metrics.py

echo.
echo === 종료 (창을 닫으려면 아무 키나 누르세요) ===
pause
