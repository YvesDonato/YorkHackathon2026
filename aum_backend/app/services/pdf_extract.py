from io import BytesIO


def extract_pdf_text(upload_file_bytes: bytes) -> tuple[str, list[str]]:
    warnings: list[str] = []
    text = ""

    try:
        import fitz  # type: ignore

        with fitz.open(stream=upload_file_bytes, filetype="pdf") as doc:
            chunks = [page.get_text("text") for page in doc]
        text = "\n".join(chunks).strip()
    except Exception:
        try:
            import pdfplumber  # type: ignore

            with pdfplumber.open(BytesIO(upload_file_bytes)) as pdf:
                chunks = [(page.extract_text() or "") for page in pdf.pages]
            text = "\n".join(chunks).strip()
        except Exception:
            warnings.append("Unable to extract PDF text: no compatible extractor available")
            return "", warnings

    if not text:
        warnings.append("Extracted PDF text is empty")
    elif len(text) < 200:
        warnings.append("Extracted PDF text is very short")

    return text, warnings
