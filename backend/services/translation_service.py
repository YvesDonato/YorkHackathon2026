import os
from json import JSONDecodeError, loads
import re

from snowflake import connector


class TranslationError(Exception):
    """Raised when Snowflake translation fails."""


SUPPORTED_LANGUAGES = {"en", "fr", "es", "hi", "ar", "ur"}
LANGUAGE_NAMES = {
    "fr": "French",
    "es": "Spanish",
    "hi": "Hindi",
    "ar": "Arabic",
    "ur": "Urdu",
}

def _get_required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise TranslationError(f"Missing required environment variable: {name}")
    return value


def _extract_completion_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return ""
        try:
            parsed = loads(text)
        except JSONDecodeError:
            return text
        return _extract_completion_text(parsed)
    if isinstance(value, dict):
        choices = value.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                for key in ("text", "message", "messages", "content"):
                    candidate = first.get(key)
                    if isinstance(candidate, str) and candidate.strip():
                        return candidate.strip()
                    if isinstance(candidate, list):
                        merged = " ".join(
                            item.get("text", "").strip()
                            for item in candidate
                            if isinstance(item, dict)
                        ).strip()
                        if merged:
                            return merged
        for key in ("text", "message", "content"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        return ""
    return str(value).strip()


def _extract_technical_terms(summary: str) -> list[str]:
    terms: set[str] = set()

    acronym_pattern = re.compile(r"\b[A-Z]{2,}(?:[-_][A-Z0-9]+)*\b")
    model_pattern = re.compile(r"\b[A-Za-z]+(?:[-_][A-Za-z0-9]+)+\b")
    mixed_pattern = re.compile(r"\b[A-Za-z]*\d+[A-Za-z0-9-]*\b")
    camel_pattern = re.compile(r"\b[A-Za-z]*[a-z][A-Z][A-Za-z0-9]*\b")

    for pattern in (acronym_pattern, model_pattern, mixed_pattern, camel_pattern):
        for match in pattern.findall(summary):
            token = match.strip()
            if len(token) >= 3:
                terms.add(token)

    return sorted(terms)[:200]


def _translate_with_snowflake(cursor: object, summary: str, lang: str) -> str:
    cursor.execute(
        "SELECT AI_TRANSLATE(%s, 'en', %s) AS translated_text",
        (summary, lang),
    )
    row = cursor.fetchone()
    if not row or not row[0]:
        raise TranslationError("Snowflake translation returned empty output")
    return str(row[0]).strip()


def _simplify_with_snowflake(
    cursor: object, original_summary: str, translated_text: str, lang: str
) -> str:
    language_name = LANGUAGE_NAMES.get(lang, lang)
    technical_terms = _extract_technical_terms(original_summary)
    terms_line = ", ".join(technical_terms) if technical_terms else "None detected"
    prompt = f"""
Rewrite the following text in easy spoken {language_name} using a light code-mixed style ({language_name} + English).
Rules:
- Preserve meaning exactly. Do not change facts, claims, numbers, names, or conclusions.
- Do not summarize. Keep roughly the same level of detail and similar length.
- Use shorter, clearer sentences and common words.
- Keep all technical terms, model names, abbreviations, dataset names, and proper nouns from the original English in English exactly as written.
- Do not replace those terms with translated equivalents.
- Keep a natural code-mix: mostly {language_name}, but include common English words that people typically use in tech conversations.
- Target roughly 15-35% English words in each paragraph while keeping the text natural and easy to follow.
- When unsure whether to translate a technical phrase, prefer keeping the English phrase.
- If a technical term may be hard for general listeners, add a brief plain-language explanation in {language_name} in parentheses on first mention, but keep the original English term.
- Return only the rewritten text.

Original English text:
{original_summary}

Detected technical terms from original English (keep these in English):
{terms_line}

Text:
{translated_text}
""".strip()

    attempts = [
        ("SELECT AI_COMPLETE(%s) AS simplified_text", (prompt,)),
        ("SELECT AI_COMPLETE('snowflake-arctic', %s) AS simplified_text", (prompt,)),
        (
            "SELECT SNOWFLAKE.CORTEX.COMPLETE('snowflake-arctic', %s) AS simplified_text",
            (prompt,),
        ),
    ]

    for query, params in attempts:
        try:
            cursor.execute(query, params)
            row = cursor.fetchone()
            candidate = _extract_completion_text(row[0] if row else "")
            if candidate:
                return candidate
        except Exception:
            continue

    raise TranslationError("Snowflake simplification failed")


def translate_summary(summary: str, lang: str) -> str:
    normalized_summary = summary.strip()
    if not normalized_summary:
        raise TranslationError("Summary text is required")

    normalized_lang = lang.strip().lower()
    if normalized_lang not in SUPPORTED_LANGUAGES:
        raise TranslationError(f"Unsupported language code: {normalized_lang}")

    if normalized_lang == "en":
        return normalized_summary

    connection = None
    cursor = None
    try:
        connection = connector.connect(
            account=_get_required_env("SNOWFLAKE_ACCOUNT"),
            user=_get_required_env("SNOWFLAKE_USER"),
            password=_get_required_env("SNOWFLAKE_PASSWORD"),
            role=_get_required_env("SNOWFLAKE_ROLE"),
            warehouse=_get_required_env("SNOWFLAKE_WAREHOUSE"),
            database=_get_required_env("SNOWFLAKE_DATABASE"),
            schema=_get_required_env("SNOWFLAKE_SCHEMA"),
        )
        cursor = connection.cursor()
        translated_text = _translate_with_snowflake(
            cursor, normalized_summary, normalized_lang
        )
        simplified_text = _simplify_with_snowflake(
            cursor, normalized_summary, translated_text, normalized_lang
        )
    except TranslationError:
        raise
    except Exception as exc:
        raise TranslationError("Snowflake translation failed") from exc
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None:
            connection.close()

    final_text = simplified_text.strip()
    if not final_text:
        raise TranslationError("Snowflake simplification returned empty output")
    return final_text
