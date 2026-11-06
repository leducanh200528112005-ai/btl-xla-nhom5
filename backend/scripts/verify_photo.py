"""Exercise every real algorithm through HTTP and save reviewable image outputs.

Run from backend: .venv/Scripts/python.exe scripts/verify_photo.py --image PATH
Outputs contain personal image data and default to gitignored .storage/verification.
"""
import argparse
from io import BytesIO
import json
from pathlib import Path
import sys
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings
from app.algorithms.scratches import detect_scratches


def step(name, **params):
    return {"algorithm": name, "params": params}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / ".storage" / "verification")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    original_bytes = args.image.read_bytes()
    cases = {name: [step(name)] for name in (
        "denoise_median", "denoise_bilateral", "adjust_gamma", "enhance_clahe",
        "sharpen_unsharp", "reduce_scratches", "remove_yellow_cast", "colorize_image", "upscale_image")}
    cases["adjust_gamma"] = [step("adjust_gamma", gamma=1.15)]
    cases["all_eight"] = [step("reduce_scratches", sensitivity=0.25), step("denoise_bilateral", diameter=7, sigma_color=50, sigma_space=50),
        step("remove_yellow_cast", strength=0.25), step("adjust_gamma", gamma=1.08), step("enhance_clahe", clip_limit=1.2),
        step("colorize_image", strength=0.35), step("sharpen_unsharp", amount=0.25), step("upscale_image", scale=2)]
    cases["recommended"] = [step("denoise_bilateral", diameter=9, sigma_color=65, sigma_space=50),
        step("adjust_gamma", gamma=1.08), step("enhance_clahe", clip_limit=1.1),
        step("sharpen_unsharp", amount=0.15), step("upscale_image", scale=2)]
    report = {"cases": {}}
    with TestClient(create_app(Settings(storage_dir=output / "api-storage"))) as client:
        response = client.post("/api/upload", files={"file": (args.image.name, original_bytes, "image/jpeg")})
        assert response.status_code == 201, response.text
        asset = response.json()
        report["input"] = asset
        with Image.open(BytesIO(original_bytes)) as source:
            rgb = ImageOps.exif_transpose(source).convert("RGB")
        original = np.asarray(rgb)
        bgr = cv2.cvtColor(original, cv2.COLOR_RGB2BGR)
        report["scratch_mask_fraction"] = float(np.count_nonzero(detect_scratches(bgr, {})) / original.shape[0] / original.shape[1])
        thumbs = [("Original", rgb.copy())]
        for name, steps in cases.items():
            start = perf_counter()
            response = client.post("/api/process", json={"image_id": asset["image_id"], "steps": steps})
            assert response.status_code == 200, (name, response.text)
            result = response.json()
            preview = client.get(result["url"])
            downloaded = client.get(f"/api/download/{result['result_id']}")
            assert preview.status_code == downloaded.status_code == 200
            assert preview.content == downloaded.content
            (output / f"{name}.png").write_bytes(preview.content)
            with Image.open(BytesIO(preview.content)) as img:
                assert img.size == (result["width"], result["height"])
                viewed = img.convert("RGB")
                resized = viewed.resize(rgb.size, Image.Resampling.LANCZOS)
                diff = np.abs(np.asarray(resized).astype(float) - original).mean()
                thumbs.append((name, viewed.copy()))
            report["cases"][name] = {"status": response.status_code, "seconds": round(perf_counter()-start, 3),
                "width": result["width"], "height": result["height"], "size_bytes": result["size_bytes"],
                "mean_absolute_change": round(float(diff), 3), "steps": steps, "preview_equals_download": True}
            print(name, report["cases"][name], flush=True)
        assert client.get(asset["url"]).content == original_bytes
        report["original_bytes_preserved"] = True
        response = client.post("/api/process", json={"image_id": asset["image_id"], "steps": [step("upscale_image", scale=4)]})
        expected_status = 422 if asset["width"]*asset["height"]*16 > 32_000_000 else 200
        assert response.status_code == expected_status, response.text
        report["upscale_4x_default_budget_status"] = response.status_code
    sheet = Image.new("RGB", (960, 6 * 205), (24, 29, 32))
    draw = ImageDraw.Draw(sheet)
    for index, (name, img) in enumerate(thumbs):
        img.thumbnail((472, 175))
        x, y = (index % 2)*480, (index // 2)*205
        draw.text((x+8, y+4), name, fill="white")
        sheet.paste(img, (x+4, y+25))
    sheet.save(output / "contact-sheet.jpg", quality=90)
    # Larger before/after crop exposes noise and facial detail for visual review.
    width, height = rgb.size
    box = (int(width*0.64), int(height*0.16), int(width*0.98), int(height*0.84))
    comparison = Image.new("RGB", (box[2]-box[0], 2*(box[3]-box[1])+48), (24, 29, 32))
    draw = ImageDraw.Draw(comparison)
    for index, (label, image) in enumerate([("Original", rgb), ("Recommended", Image.open(output / "recommended.png").convert("RGB").resize(rgb.size, Image.Resampling.LANCZOS))]):
        y = index*(box[3]-box[1]+24)
        draw.text((8, y+4), label, fill="white")
        comparison.paste(image.crop(box), (0, y+24))
    comparison.save(output / "detail-comparison.jpg", quality=94)
    (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print("Outputs:", output)


if __name__ == "__main__":
    main()
