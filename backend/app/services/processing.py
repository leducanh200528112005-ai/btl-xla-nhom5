"""Decode, process and persist a genuine result independently of the original."""

from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from app.pipeline import check_output_size, prepare_steps, process_image
from app.services.image_storage import ValidatedImage


def create_result(original, steps, settings, result_storage):
    prepared = prepare_steps(steps)
    check_output_size(original.width, original.height, prepared, settings.max_result_pixels)
    with Image.open(original.path) as source:
        # Match browser EXIF orientation, retaining original bytes on disk.
        oriented = ImageOps.exif_transpose(source)
        rgba = oriented.convert("RGBA")
        alpha = np.asarray(rgba.getchannel("A")).copy() if "A" in source.getbands() or "transparency" in source.info else None
        rgb = np.asarray(rgba.convert("RGB"))
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    output = process_image(bgr, prepared, max_result_pixels=settings.max_result_pixels, model_dir=settings.colorization_model_dir)
    height, width = output.shape[:2]
    rgb_output = cv2.cvtColor(output, cv2.COLOR_BGR2RGB)
    encoded_image = Image.fromarray(rgb_output)
    if alpha is not None:
        if alpha.shape != (height, width):
            alpha = cv2.resize(alpha, (width, height), interpolation=cv2.INTER_LINEAR)
        encoded_image.putalpha(Image.fromarray(alpha))
    encoded = BytesIO()
    encoded_image.save(encoded, format="PNG")
    stored = result_storage.store(
        encoded.getvalue(),
        f"{Path(original.filename).stem}-ket-qua.png",
        ValidatedImage("PNG", "image/png", ".png", width, height),
        source_image_id=original.image_id,
    )
    return {
        "result_id": stored.image_id,
        "image_id": original.image_id,
        "filename": stored.filename,
        "content_type": stored.content_type,
        "size_bytes": stored.size_bytes,
        "width": width,
        "height": height,
        "url": f"/api/results/{stored.image_id}",
    }
