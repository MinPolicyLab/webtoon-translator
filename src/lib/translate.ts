import { findSourceLanguage, findTargetLanguage } from "./languages";

async function translateWithDeepL(
  texts: string[],
  sourceOcrCode: string,
  targetTranslateCode: string,
  apiKey: string
): Promise<string[]> {
  const source = findSourceLanguage(sourceOcrCode);
  const target = findTargetLanguage(targetTranslateCode);
  const endpoint = apiKey.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";

  const params = new URLSearchParams();
  for (const t of texts) params.append("text", t);
  params.append("source_lang", source.translateCode.toUpperCase());
  params.append("target_lang", target.deeplCode);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`DeepL API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { translations: { text: string }[] };
  return data.translations.map((t) => t.text);
}

async function translateOneWithMyMemory(
  text: string,
  sourceTranslateCode: string,
  targetTranslateCode: string
): Promise<string> {
  const email = process.env.MYMEMORY_EMAIL;
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text.slice(0, 480));
  url.searchParams.set("langpair", `${sourceTranslateCode}|${targetTranslateCode}`);
  if (email) url.searchParams.set("de", email);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`MyMemory API error: ${res.status}`);
  }
  const data = (await res.json()) as {
    responseData: { translatedText: string };
    responseStatus: number | string;
  };
  return data.responseData?.translatedText ?? text;
}

async function translateWithMyMemory(
  texts: string[],
  sourceOcrCode: string,
  targetTranslateCode: string
): Promise<string[]> {
  const source = findSourceLanguage(sourceOcrCode);
  const results: string[] = [];
  // MyMemory has no batch endpoint and a modest free rate limit, so lines
  // are translated a few at a time rather than all in parallel.
  const CONCURRENCY = 3;
  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const chunk = texts.slice(i, i + CONCURRENCY);
    const translated = await Promise.all(
      chunk.map((t) => translateOneWithMyMemory(t, source.translateCode, targetTranslateCode))
    );
    results.push(...translated);
  }
  return results;
}

export interface TranslateResult {
  translations: string[];
  provider: "deepl" | "mymemory";
}

export async function translateBatch(
  texts: string[],
  sourceOcrCode: string,
  targetTranslateCode: string
): Promise<TranslateResult> {
  const deeplKey = process.env.DEEPL_API_KEY;
  const source = findSourceLanguage(sourceOcrCode);

  if (deeplKey && source.deeplSupported) {
    const translations = await translateWithDeepL(texts, sourceOcrCode, targetTranslateCode, deeplKey);
    return { translations, provider: "deepl" };
  }

  const translations = await translateWithMyMemory(texts, sourceOcrCode, targetTranslateCode);
  return { translations, provider: "mymemory" };
}
