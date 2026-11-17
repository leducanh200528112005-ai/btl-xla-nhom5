"""OpenCV Caffe loading must not rely on Windows narrow-character file paths."""
from types import SimpleNamespace

import numpy as np

from app.algorithms import colorize


def test_caffe_loader_receives_buffers_for_unicode_paths(tmp_path, monkeypatch):
    root = tmp_path / "Ảnh cũ"
    root.mkdir()
    (root / colorize.MODEL_FILES[0]).write_bytes(b"prototxt")
    (root / colorize.MODEL_FILES[1]).write_bytes(b"weights")
    np.save(root / colorize.MODEL_FILES[2], np.zeros((313, 2), dtype=np.float32))
    monkeypatch.setattr(colorize, "_network", None)
    monkeypatch.setattr(colorize, "_network_key", None)
    layers = {}
    network = SimpleNamespace(
        getLayerId=lambda name: name,
        getLayer=lambda name: layers.setdefault(name, SimpleNamespace(blobs=[])),
        setPreferableBackend=lambda value: None,
        setPreferableTarget=lambda value: None,
    )
    def read_caffe(proto, weights):
        assert isinstance(proto, np.ndarray) and proto.dtype == np.uint8
        assert isinstance(weights, np.ndarray) and weights.dtype == np.uint8
        assert proto.tobytes() == b"prototxt"
        assert weights.tobytes() == b"weights"
        return network
    monkeypatch.setattr(colorize.cv2.dnn, "readNetFromCaffe", read_caffe)
    assert colorize._load_network(root) is network
