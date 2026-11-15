# 내용 백업 · 복원 · 다른 PC로 옮기기

프로그램(코드)은 GitHub에 있고, 쌓이는 내용은 이 PC에만 있습니다. git은 내용을 지켜 주지 않으므로 이 문서의 백업이 내용의 유일한 보험입니다.

- 내용 = `data/` (DB `notes_db.sqlite3`, `insight-log.md` 등) + `assets/` (노트 이미지, 차트 패턴 이미지, 영상, 가격 데이터 파일)
- 백업 위치 = `C:\POCTraderBR_Backup` (프로그램은 `D:`의 HDD, 백업은 `C:`의 SSD — 서로 다른 디스크)

## 1. 평소 — 아무것도 안 해도 됩니다

- 서버가 켜져 있으면 **하루에 한 번** 자동으로 백업합니다. 켠 뒤 1분쯤에 처음 확인하고, 그 뒤로 한 시간마다 "마지막 백업이 24시간을 넘었는지" 봅니다. 실패하면 한 시간 뒤 다시 시도합니다.
- 내용이 그대로면 새 폴더를 만들지 않고 넘어갑니다.
- 화면 맨 위 탭 줄 오른쪽 끝의 **`● 백업 11/15 12:54`** 가 마지막으로 확인된 백업 시각입니다.
  - 초록: 정상
  - 주황: 백업이 없거나, 이틀 넘게 안 됐거나, 복사하지 못한 파일이 있음
  - 빨강 `백업 실패`: 마우스를 올리면 이유가 나옵니다
  - **누르면 그 자리에서 바로 백업**합니다 (큰 작업을 하기 전에 한 번 눌러 두면 됩니다)
- 자동 백업은 최근 30개만 남기고 오래된 것부터 지웁니다. 직접 만든 백업(`manual`)과 복원 직전 백업(`before-restore`)은 지우지 않습니다.

## 2. 백업 폴더의 모양

```
C:\POCTraderBR_Backup\
  2026-11-15_124357_manual\      ← 백업 하나 = 폴더 하나 (날짜_시각_종류)
    data\notes_db.sqlite3        ← DB (파일 하나로 정리된 사본)
    data\insight-log.md
    assets\...                   ← 이미지 · 영상 · 가격 파일
    manifest.json                ← 파일 목록, 크기, 해시, DB 테이블별 행 수
  2026-11-16_090000_auto\
  last_run.json                  ← 마지막 실행 결과
```

- 폴더 하나가 **그 자체로 완전한 사본**입니다. 탐색기로 열어 파일을 그냥 꺼내 써도 됩니다.
- 바뀌지 않은 파일은 이전 백업과 디스크 공간을 같이 씁니다(하드 링크). 그래서 백업이 여러 개여도 용량은 거의 한 벌 분량입니다. 폴더 하나를 지워도 다른 백업은 멀쩡합니다. 다만 백업 폴더 안의 파일을 **직접 고치지는 마세요** — 공유된 파일이라 다른 백업의 같은 파일도 함께 바뀝니다 (꺼내 쓸 때는 복사해서).
- 서버가 켜진 채로 백업해도 됩니다. DB는 SQLite의 백업 기능으로 떠서, 쓰는 중이어도 깨지지 않은 사본이 만들어집니다.

## 3. 직접 백업 · 검사

| 하고 싶은 것 | 방법 |
| --- | --- |
| 지금 백업 | 화면의 `● 백업 …` 누르기, 또는 [backup.bat](../backup.bat) 더블클릭 |
| 다른 곳(외장 디스크 등)에 백업 | `backup.bat --dest E:\POCTraderBR_Backup` |
| 백업 목록 | `backend\.venv\Scripts\python.exe backend\app\content_backup.py list` |
| 백업이 온전한지 검사 | `backend\.venv\Scripts\python.exe backend\app\content_backup.py verify` (가장 최근) 또는 `verify 2026-11-15_124357_manual` |

검사는 모든 파일의 해시와 DB 무결성 · 행 수를 백업할 때의 기록과 비교합니다.

## 4. 되돌리기 (이 PC에서)

실수로 지웠거나 DB가 망가졌을 때.

1. **서버를 끕니다.** (켜져 있으면 복원이 거절됩니다)
2. [restore.bat](../restore.bat) 더블클릭 → 가장 최근 백업의 내용을 보여 주고 `yes` 를 입력해야 진행합니다.
   - 특정 백업으로: `restore.bat 2026-11-15_124357_manual`
3. 서버를 다시 켭니다.

복원은 바꾸기 전에 **지금 있는 내용을 `…_before-restore` 백업으로 먼저 남깁니다.** 잘못 되돌렸으면 그 백업으로 한 번 더 복원하면 됩니다. 지금의 DB가 읽히지 않을 만큼 망가져 있으면 DB 파일을 `…_unreadable-db` 폴더로 그대로 옮겨 둡니다.

파일 하나만 필요하면 복원하지 말고 백업 폴더에서 그 파일만 복사하세요.

## 5. 다른 PC로 옮기기

**옛 PC에서**

1. `● 백업 …` 을 눌러 최신 백업을 만듭니다.
2. `C:\POCTraderBR_Backup` 에서 가장 최근 폴더 **하나**를 USB나 외장 디스크에 복사합니다 (지금 약 430 MB).

**새 PC에서**

1. Python 3.14, Node.js, Git 을 설치합니다.
2. 프로그램을 받습니다.
   ```powershell
   git clone https://github.com/brianrobo/POCTraderBR-Web.git
   cd POCTraderBR-Web
   cd backend
   py -3.14 -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   cd ..\frontend
   npm install
   npm run build
   cd ..
   ```
3. 내용을 넣습니다 (서버는 끈 상태).
   ```powershell
   .\restore.bat E:\2026-11-15_124357_manual
   ```
4. 서버를 켭니다 ([README](../README.md)의 "LAN 서버로 상시 구동").

`.venv` 없이 급하게 내용만 꺼내야 하면 파이썬만 있어도 됩니다: `py -3 backend\app\content_backup.py restore E:\…` (백업 모듈은 추가 패키지를 쓰지 않습니다). 파이썬조차 없으면 백업 폴더의 `data\` 와 `assets\` 를 프로그램 폴더에 그대로 복사해도 같은 결과입니다.

## 6. 보험의 범위

| 사고 | 대비 |
| --- | --- |
| 실수로 삭제 · 잘못 수정 · DB 손상 | 자동 백업 (하루 단위로 30일치) |
| `D:` 디스크 고장 | `C:` 의 백업 |
| `C:` 디스크 고장 | 원본이 `D:` 에 그대로 있음 → 새 위치로 다시 백업 |
| PC 자체를 잃음 (도난 · 화재 · 랜섬웨어) | **이 PC 안의 백업으로는 안 됩니다.** 가끔 `backup.bat --dest E:\POCTraderBR_Backup` 로 외장 디스크에도 떠 두거나, 백업 폴더 하나를 외장 디스크로 복사해 두세요. |

## 7. 설정 (필요할 때만)

`data\backup_config.json` 을 만들면 기본값을 바꿉니다. 없는 항목은 기본값입니다.

```json
{ "dest": "C:\\POCTraderBR_Backup", "keep": 30, "auto": true }
```

- `dest` 백업 위치 · `keep` 남겨 둘 자동 백업 개수 · `auto` 자동 백업 켜기/끄기
- 환경 변수 `POCTRADER_BACKUP_DIR`(위치), `POCTRADER_AUTO_BACKUP=0`(자동 끄기)가 있으면 그쪽이 우선합니다.
- 이 파일도 `data\` 안이라 백업 · 복원에 포함됩니다. 다른 PC로 옮긴 뒤 드라이브 구성이 다르면 `dest` 를 고치세요.

## 8. 구현 위치

- [backend/app/content_backup.py](../backend/app/content_backup.py) — 백업 · 검사 · 복원 · 자동 실행 · 명령줄
- [backend/app/routers/backup.py](../backend/app/routers/backup.py) — `GET /api/backup/status`, `POST /api/backup/run`
- [frontend/src/components/BackupStatus.tsx](../frontend/src/components/BackupStatus.tsx) — 탭 줄의 표시
- [tools/backup-tests/backup_test.py](../tools/backup-tests/backup_test.py) — 테스트 (임시 폴더만 사용): `backend\.venv\Scripts\python.exe -X utf8 tools\backup-tests\backup_test.py`
