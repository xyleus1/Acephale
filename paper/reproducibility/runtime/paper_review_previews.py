"""Compact review images from an already-rendered PDF; no report/statistical changes."""
import base64
import hashlib
import json
import re
from pathlib import Path
import fitz


def write_review_previews(pdf_path, output_directory):
    pdf_path = Path(pdf_path)
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=False)
    document = fitz.open(pdf_path)
    images = []

    def emit(page, name, width):
        while True:
            scale = width / page.rect.width
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale),
                                    colorspace=fitz.csRGB, alpha=False)
            for quality in (75, 65, 55, 45, 35, 25):
                jpeg = pixmap.tobytes("jpeg", jpg_quality=quality)
                encoded = base64.b64encode(jpeg)
                if len(encoded) < 145000:
                    break
            if len(encoded) < 145000:
                break
            width = int(width * 0.85)
            if width < 400:
                raise ValueError("Review image cannot fit the requested byte bound")
        image = output / (name + ".jpg")
        text = output / (name + ".jpg.b64")
        image.write_bytes(jpeg)
        text.write_bytes(encoded)
        row = {"name": name, "jpeg": image.name, "asciiBase64": text.name,
               "jpegBytes": len(jpeg), "asciiBase64Bytes": len(encoded),
               "jpegSha256": hashlib.sha256(jpeg).hexdigest(),
               "asciiSha256": hashlib.sha256(encoded).hexdigest(),
               "width": pixmap.width, "height": pixmap.height, "quality": quality}
        images.append(row)
        return row

    texts = [page.get_text() for page in document]
    heldout_start = next((i for i, text in enumerate(texts)
                         if re.search(r"5\.3\s+Held-out evaluation", text)), None)
    heldout_end = None
    if heldout_start is not None:
        heldout_end = next((i for i in range(heldout_start, len(texts))
                           if re.search(r"6\.\s+Limitations", texts[i])), len(texts)-1)
    key = {n-1 for n in (1, 2, 5, 6, 7, 8) if n <= len(document)}
    if heldout_start is not None:
        key.update(range(heldout_start, heldout_end+1))
    for i in sorted(key):
        emit(document[i], "review-page-%02d" % (i+1), 900)["page"] = i+1

    sheets = []
    for offset in range(0, len(document), 9):
        contact = fitz.open()
        sheet = contact.new_page(width=960, height=1335)
        included = list(range(offset, min(offset+9, len(document))))
        for ordinal, index in enumerate(included):
            x, y = (ordinal % 3)*320, (ordinal // 3)*445
            sheet.insert_text((x+12, y+14), "Page %d" % (index+1), fontsize=10)
            sheet.show_pdf_page(fitz.Rect(x+5, y+22, x+315, y+437), document, index,
                               keep_proportion=True)
        row = emit(sheet, "all-pages-%02d" % (offset//9+1), 960)
        row["pages"] = [i+1 for i in included]
        sheets.append(row["name"])
        contact.close()
    manifest = {"kind": "actual-pdf-review-images-v1",
                "sourcePdfSha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
                "pages": len(document), "allPagesRepresented": True,
                "keyPages": [i+1 for i in sorted(key)],
                "heldoutSectionPages": [] if heldout_start is None else
                    list(range(heldout_start+1, heldout_end+2)),
                "contactSheets": sheets, "images": images,
                "scientificContentChanged": False, "visualReviewPerformed": False}
    (output/"manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
    document.close()
    return manifest
