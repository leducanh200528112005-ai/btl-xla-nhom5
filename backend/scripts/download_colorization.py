"""Download the ECCV16 CPU model explicitly, never during an HTTP request."""

import hashlib
import os
from pathlib import Path
import sys
import tempfile
import shutil
import subprocess
from urllib.request import urlopen
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Settings

# Model/prototxt SHA1 values are published by opencv_extra/testdata/dnn/download_models.py.
ASSETS = (
    ("colorization_deploy_v2.prototxt", "https://raw.githubusercontent.com/richzhang/colorization/caffe/models/colorization_deploy_v2.prototxt", "sha1", "f528334e386a69cbaaf237a7611d833bef8e5219"),
    ("colorization_release_v2.caffemodel", "https://dl.opencv.org/models/colorization_release_v2.caffemodel", "sha1", "21e61293a3fa6747308171c11b6dd18a68a26e7f"),
    ("pts_in_hull.npy", "https://raw.githubusercontent.com/richzhang/colorization/caffe/resources/pts_in_hull.npy", "sha256", "b5dec01315c34f43f1c8c089e84c45ae35d1838d8e77ed0e7ca930f79ffa450e"),
)
MODEL_MIRROR = "https://media.githubusercontent.com/media/hamzaelmassaoudy/AI-Image-Colorization-OpenCV/main/models/colorization_release_v2.caffemodel"


def open_asset(url, name):
    try:
        return urlopen(url, timeout=45)
    except URLError:
        if name != "colorization_release_v2.caffemodel":
            raise
        print("Primary source unavailable; using mirror with the same published checksum.", flush=True)
        return urlopen(MODEL_MIRROR, timeout=45)


def download(url, name, temporary):
    # curl handles Windows system networking reliably, including large responses.
    curl = shutil.which("curl.exe") or shutil.which("curl")
    if curl:
        urls = [url, MODEL_MIRROR] if name == "colorization_release_v2.caffemodel" else [url]
        for source in urls:
            result = subprocess.run([
                curl, "--fail", "--location", "--silent", "--show-error",
                "--connect-timeout", "15", "--max-time", "180",
                "--max-filesize", str(150 * 1024 * 1024),
                "--output", str(temporary), source,
            ], check=False, timeout=190)
            if result.returncode == 0:
                return
        raise RuntimeError(f"Could not download {name}")
    with temporary.open("wb") as output, open_asset(url, name) as response:
        count = 0
        while chunk := response.read(64 * 1024):
            count += len(chunk)
            if count > 150 * 1024 * 1024:
                raise ValueError("Model download exceeds the expected size limit")
            output.write(chunk)


def digest(path, algorithm):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, algorithm).hexdigest()


def main():
    root = Settings().colorization_model_dir
    root.mkdir(parents=True, exist_ok=True)
    for name, url, algorithm, expected in ASSETS:
        target = root / name
        if target.is_file() and digest(target, algorithm) == expected:
            print(f"Verified: {name}", flush=True)
            continue
        print(f"Downloading: {name}", flush=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix=".download-", dir=root)
        os.close(descriptor)
        temporary = Path(temporary_name)
        try:
            download(url, name, temporary)
            if digest(temporary, algorithm) != expected:
                raise ValueError(f"Checksum mismatch: {name}")
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    print("Colorization model ready.")


if __name__ == "__main__":
    main()
