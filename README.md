# 웹툰·만화 이미지 번역기

업로드한 이미지(JPG/PNG/WebP)나 PDF에서 글자를 인식(OCR)한 뒤, 번역 API로 번역해서
원본 위에 겹쳐 보여주는 오픈소스 웹 앱입니다.

- **다른 웹사이트를 읽어오지 않습니다.** 사용자가 직접 올린 파일만 처리합니다.
- OCR은 브라우저 안에서 [Tesseract.js](https://github.com/naptha/tesseract.js)로 실행됩니다 (서버 비용 없음).
- 번역은 서버 API 라우트에서 실제 번역 서비스를 호출합니다. 기본값은 키가 필요 없는
  무료 [MyMemory](https://mymemory.translated.net/) API이고, `DEEPL_API_KEY`를
  설정하면 자동으로 [DeepL](https://www.deepl.com/pro-api)로 전환됩니다 (품질이 더 좋음).

## 시작하기

```bash
npm install
npm run dev
```

<http://localhost:3000>을 열고 이미지나 PDF 파일을 드래그해서 넣으면 바로 동작합니다.

## 환경변수

`.env.example`을 `.env.local`로 복사해서 사용하세요.

| 변수 | 필수 여부 | 설명 |
| --- | --- | --- |
| `DEEPL_API_KEY` | 선택 | 설정하면 DeepL로 번역 (더 좋은 품질, 유료/무료 티어 존재). 비워두면 MyMemory 사용 |
| `MYMEMORY_EMAIL` | 선택 | MyMemory 무료 API의 일일 한도를 늘리고 싶을 때 |

## 알려진 한계

- 무료 MyMemory API는 문맥이 짧은 문장에서 품질이 들쭉날쭉할 수 있습니다. 품질이
  중요하면 `DEEPL_API_KEY`를 설정하세요.
- Tesseract.js의 언어별 인식률은 언어마다 다르며, 특히 손글씨체나 특수 폰트가 많은
  웹툰/만화 말풍선에서는 정확도가 낮아질 수 있습니다.
- 베트남어(`vie`), 태국어(`tha`) 원문은 DeepL을 지원하지 않아 항상 MyMemory로 번역됩니다.

## 기술 스택

- [Next.js](https://nextjs.org) (App Router) + TypeScript
- [Tesseract.js](https://github.com/naptha/tesseract.js) — 브라우저 내 OCR
- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF 페이지를 이미지로 렌더링
- 번역: [MyMemory](https://mymemory.translated.net/) (기본) / [DeepL](https://www.deepl.com/pro-api) (선택)

## 배포

Vercel에 프로젝트를 연결하고 환경변수(`DEEPL_API_KEY`, `MYMEMORY_EMAIL`)를 설정하면
그대로 배포됩니다. 별도 서버나 데이터베이스가 필요하지 않습니다.

## 라이선스

MIT
