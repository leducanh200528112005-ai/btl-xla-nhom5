"""Member 3: Zhang et al. ECCV16 colorization using OpenCV's CPU DNN runtime.

Model source: https://github.com/richzhang/colorization/tree/caffe
No network access occurs during inference; install weights with the setup script.
"""

from pathlib import Path
from threading import Lock

import cv2
import numpy as np

from app.algorithms.types import ImageArray, StrengthParams
from app.algorithms.validation import validate_input
from app.config import Settings
from app.errors import ApiError

_lock = Lock()
_network = None
_network_key = None
MODEL_FILES = ("colorization_deploy_v2.prototxt", "colorization_release_v2.caffemodel", "pts_in_hull.npy")


def _load_network(model_dir: Path):
    global _network, _network_key
    paths = [model_dir / name for name in MODEL_FILES]
    try:
        key = tuple((str(path.resolve()), path.stat().st_mtime_ns, path.stat().st_size) for path in paths)
        if _network is not None and _network_key == key:
            return _network
        centers = np.load(paths[2], allow_pickle=False)
        if centers.shape != (313, 2) or not np.isfinite(centers).all():
            raise ValueError("Invalid color centers")
        network = cv2.dnn.readNetFromCaffe(str(paths[0]), str(paths[1]))
        network.getLayer(network.getLayerId("class8_ab")).blobs = [centers.T.reshape(2, 313, 1, 1).astype(np.float32)]
        network.getLayer(network.getLayerId("conv8_313_rh")).blobs = [np.full((1, 313), 2.606, np.float32)]
        network.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        network.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
    except (OSError, ValueError, cv2.error) as exc:
        raise ApiError(503, "MODEL_UNAVAILABLE", "Mô hình tô màu chưa sẵn sàng. Hãy chạy scripts/download_colorization.py trong backend rồi thử lại.") from exc
    _network, _network_key = network, key
    return network


def colorize_image(image: ImageArray, params: StrengthParams, *, model_dir: Path | None = None) -> ImageArray:
    """Predict a*/b* from lightness, retain source L*, then blend in BGR.

    Strength zero returns an independent exact copy and needs no model. Predicted
    colors are plausible estimates, not a recovery of historical ground truth.
    The lock covers setInput/forward because a cached DNN is mutable.
    """
    strength = validate_input(image, "colorize_image", params)["strength"]
    if strength == 0:
        return image.copy()
    floating = image.astype(np.float32) / 255
    lightness = cv2.cvtColor(floating, cv2.COLOR_BGR2Lab)[:, :, 0]
    network_input = cv2.cvtColor(cv2.resize(floating, (224, 224)), cv2.COLOR_BGR2Lab)[:, :, 0] - 50
    with _lock:
        network = _load_network(model_dir if model_dir is not None else Settings().colorization_model_dir)
        network.setInput(cv2.dnn.blobFromImage(network_input))
        chroma = network.forward()[0].transpose(1, 2, 0).copy()
    chroma = cv2.resize(chroma, (image.shape[1], image.shape[0]))
    lab = np.dstack((lightness, chroma)).astype(np.float32)
    predicted = np.clip(cv2.cvtColor(lab, cv2.COLOR_Lab2BGR), 0, 1)
    return np.rint(np.clip((floating * (1 - strength) + predicted * strength) * 255, 0, 255)).astype(np.uint8)
