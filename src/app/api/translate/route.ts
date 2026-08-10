import { NextRequest, NextResponse } from "next/server";
import { translateBatch } from "@/lib/translate";

export async function POST(req: NextRequest) {
  let body: { texts?: unknown; sourceOcrCode?: unknown; targetTranslateCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const { texts, sourceOcrCode, targetTranslateCode } = body;

  if (!Array.isArray(texts) || texts.some((t) => typeof t !== "string")) {
    return NextResponse.json({ error: "texts는 문자열 배열이어야 합니다." }, { status: 400 });
  }
  if (typeof sourceOcrCode !== "string" || typeof targetTranslateCode !== "string") {
    return NextResponse.json({ error: "sourceOcrCode, targetTranslateCode가 필요합니다." }, { status: 400 });
  }
  if (texts.length === 0) {
    return NextResponse.json({ translations: [], provider: "mymemory" });
  }
  if (texts.length > 200) {
    return NextResponse.json({ error: "한 번에 번역할 수 있는 줄 수를 초과했습니다 (최대 200줄)." }, { status: 400 });
  }

  try {
    const result = await translateBatch(texts as string[], sourceOcrCode, targetTranslateCode);
    return NextResponse.json(result);
  } catch (err) {
    console.error("translate error", err);
    return NextResponse.json({ error: "번역 요청이 실패했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
  }
}
