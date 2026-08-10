export type OcrLangCode = "kor" | "jpn" | "chi_sim" | "eng" | "vie" | "tha";

export interface LanguageOption {
  ocrCode: OcrLangCode;
  translateCode: string;
  label: string;
  deeplSupported: boolean;
}

export const SOURCE_LANGUAGES: LanguageOption[] = [
  { ocrCode: "jpn", translateCode: "ja", label: "일본어 (만화)", deeplSupported: true },
  { ocrCode: "kor", translateCode: "ko", label: "한국어 (웹툰)", deeplSupported: true },
  { ocrCode: "chi_sim", translateCode: "zh", label: "중국어 간체", deeplSupported: true },
  { ocrCode: "eng", translateCode: "en", label: "영어", deeplSupported: true },
  { ocrCode: "vie", translateCode: "vi", label: "베트남어", deeplSupported: false },
  { ocrCode: "tha", translateCode: "th", label: "태국어", deeplSupported: false },
];

export interface TargetLanguageOption {
  translateCode: string;
  deeplCode: string;
  label: string;
}

export const TARGET_LANGUAGES: TargetLanguageOption[] = [
  { translateCode: "ko", deeplCode: "KO", label: "한국어" },
  { translateCode: "en", deeplCode: "EN-US", label: "영어" },
  { translateCode: "ja", deeplCode: "JA", label: "일본어" },
  { translateCode: "zh", deeplCode: "ZH", label: "중국어 간체" },
];

export function findSourceLanguage(ocrCode: string): LanguageOption {
  return SOURCE_LANGUAGES.find((l) => l.ocrCode === ocrCode) ?? SOURCE_LANGUAGES[0];
}

export function findTargetLanguage(translateCode: string): TargetLanguageOption {
  return TARGET_LANGUAGES.find((l) => l.translateCode === translateCode) ?? TARGET_LANGUAGES[0];
}
