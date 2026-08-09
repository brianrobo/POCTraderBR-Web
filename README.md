# POCTraderBR Web

트레이딩 차트 노트 앱의 웹 버전 (MVP). 폴더/아이템 네비게이터 + 페이지별 리치텍스트 메모 + 차트 이미지(A/B) 업로드 + 이미지 위 자유 드로잉 주석.

집 안 네트워크(LAN)에서 한 PC가 서버 역할을 하고, 다른 PC/기기는 브라우저로 접속해서 씁니다.

## 구조

```
backend/    FastAPI (Python) — REST API, JSON 파일 저장소, 정적 파일 서빙
frontend/   React + TypeScript + Vite — 트리 네비게이터, 리치텍스트 메모, 차트 캔버스
data/       notes_db.json (실 데이터, git에 커밋 안 함)
assets/     업로드된 차트 이미지 (실 데이터, git에 커밋 안 함)
```

## 로컬 개발 (Dev mode)

두 프로세스를 각각 띄웁니다.

```powershell
# 1) 백엔드 (최초 1회 venv 생성 + 패키지 설치)
cd backend
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# 2) 프론트엔드 (다른 터미널에서)
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속. Vite dev server가 `/api`, `/uploads` 요청을 8000번 백엔드로 프록시합니다.

## LAN 서버로 상시 구동 (Production mode)

프론트엔드를 빌드해서 백엔드가 같은 포트로 함께 서빙하도록 합니다 (프로세스 1개, 포트 1개).

```powershell
cd frontend
npm run build

cd ..\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

이 PC의 LAN IP를 확인하고 (`ipconfig`, 예: `192.168.0.10`), 같은 네트워크의 다른 PC/휴대폰 브라우저에서:

```
http://<이 PC의 LAN IP>:8000
```

**Windows 방화벽**: 처음 실행 시 "Windows Defender 방화벽에서 일부 기능 차단" 알림이 뜨면 "개인 네트워크"에 대해 허용해야 다른 기기에서 접속할 수 있습니다.

## MVP 범위

포함: 폴더/아이템/페이지 네비게이터, 리치텍스트 메모, 차트 이미지 A/B 업로드·표시·확대축소, 이미지 위 자유 드로잉 주석(벡터 저장).

다음 단계 (미포함): 매매 체크리스트, 옵션 만기일 바, 보유 주식 정보, 글로벌 아이디어/관심종목, 메모 템플릿, 백업/복구 UI, 가져오기/내보내기, 로그인/인증.
