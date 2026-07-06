# 📤 GitHub에 올리기 (push) 안내

저장소: **https://github.com/rico890705/liar-draw**
이미 `git init` 을 끝낸 상태 기준입니다.

---

## 1단계. node_modules 제외 설정

용량이 크고 배포 시 자동 설치되므로 올리지 않습니다.
프로젝트 폴더에 `.gitignore` 파일이 있는지 확인하세요. (이 안내와 함께 만들어 뒀습니다)
없다면 터미널에서:

```bash
echo "node_modules/" > .gitignore
```

---

## 2단계. 파일 담고 커밋하기

프로젝트 폴더 안에서 순서대로 실행합니다.

```bash
git add .
git commit -m "라이어 그림 게임 초기 커밋"
```

> `git add .` 은 현재 폴더의 모든 파일을 담는다는 뜻이고,
> `commit` 은 "이 상태를 기록"하는 저장 지점입니다.

---

## 3단계. 원격 저장소(GitHub) 연결

한 번만 하면 됩니다. (이미 연결했다면 건너뛰세요 — 아래 4단계로)

```bash
git remote add origin https://github.com/rico890705/liar-draw.git
```

> 이미 연결돼 "remote origin already exists" 오류가 나면 무시하고 다음으로 넘어가면 됩니다.
> 주소를 바꾸고 싶을 땐 `git remote set-url origin <주소>` 를 씁니다.

---

## 4단계. 브랜치 이름 맞추고 올리기

```bash
git branch -M main
git push -u origin main
```

성공하면 GitHub 저장소 페이지를 새로고침했을 때 파일들이 보입니다. 🎉
이후에는 코드를 고칠 때마다 `git add .` → `git commit -m "설명"` → `git push` 세 줄이면 됩니다.

---

## ⚠️ 자주 만나는 문제

### (1) 비밀번호를 물어보는데 로그인이 안 돼요
GitHub는 이제 **계정 비밀번호로 push할 수 없습니다.** 두 가지 방법 중 하나를 쓰세요.

**방법 A — Personal Access Token (가장 쉬움)**
1. GitHub → 우측 상단 프로필 → **Settings**
2. 맨 아래 **Developer settings → Personal access tokens → Tokens (classic)**
3. **Generate new token (classic)** → `repo` 항목 체크 → 토큰 생성
4. 생성된 토큰 문자열을 복사 (다시 못 보니 잘 보관)
5. push할 때 비밀번호 자리에 **이 토큰을 붙여넣기**

**방법 B — GitHub CLI**
```bash
# gh 설치 후
gh auth login
```
브라우저 안내를 따라 로그인하면 이후 push가 자동 인증됩니다.

### (2) "Updates were rejected" / "failed to push" 오류
GitHub에서 저장소를 만들 때 README나 라이선스를 체크했다면, 원격에 내 로컬에 없는 파일이 있어서 충돌한 것입니다. 먼저 원격 내용을 합친 뒤 다시 올립니다.

```bash
git pull origin main --rebase
git push -u origin main
```

### (3) node_modules가 잘못 올라간 경우
`.gitignore` 를 나중에 추가했다면 이미 추적 중인 폴더는 자동으로 빠지지 않습니다.

```bash
git rm -r --cached node_modules
git commit -m "node_modules 제외"
git push
```

---

## 다음 단계: 바로 배포하기

GitHub 업로드가 끝났다면, [Render](https://render.com) 에서
**New → Web Service → 이 저장소 연결** →
Build `npm install` / Start `npm start` / Free 플랜으로 배포하면
친구들에게 공유할 실제 주소가 나옵니다. (README.md 2번 항목 참고)
