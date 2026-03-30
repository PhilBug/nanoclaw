#!/usr/bin/env python3
"""Analyze an image using OpenRouter's vision models.

Zero external dependencies — uses only Python stdlib.
Accepts local file paths (png, jpg, jpeg, webp, gif) or HTTP/HTTPS URLs.
"""

import sys
import os
import base64
import mimetypes
import json
import subprocess
import urllib.request
import urllib.error

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

DEFAULT_PROMPT = (
    "Describe the image and extract any important visible text, "
    "errors, UI elements, diagrams, or notable details."
)

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def die(msg):
    print(f"Error: {msg}", file=sys.stderr)
    sys.exit(1)


def encode_local_image(path):
    """Encode a local image file as a base64 data URL."""
    path = os.path.expanduser(path)
    if not os.path.isfile(path):
        die(f"file not found: {path}")

    ext = os.path.splitext(path)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        die(f"unsupported image format '{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}")

    mime_type = mimetypes.guess_type(path)[0]
    if not mime_type:
        mime_type = f"image/{ext.lstrip('.')}"

    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")

    return f"data:{mime_type};base64,{encoded}"


def resolve_model():
    """Resolve which vision model to use.

    Priority: OPENROUTER_VISION_MODEL env var > auto-discover via helper script.
    """
    model = os.getenv("OPENROUTER_VISION_MODEL")
    if model:
        return model

    script_dir = os.path.dirname(os.path.abspath(__file__))
    helper = os.path.join(script_dir, "find_free_models.mjs")

    if not os.path.isfile(helper):
        die(f"helper script not found: {helper}")

    try:
        result = subprocess.run(
            ["node", helper],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except FileNotFoundError:
        die("'node' not found in PATH. Install Node.js or set OPENROUTER_VISION_MODEL.")
    except subprocess.TimeoutExpired:
        die("model discovery timed out after 30s")

    if result.returncode != 0:
        die(f"model discovery failed: {result.stderr.strip()}")

    models = [line.strip() for line in result.stdout.strip().splitlines() if line.strip()]
    if not models:
        die(
            "no free vision-capable models found on OpenRouter. "
            "Set OPENROUTER_VISION_MODEL to specify one manually."
        )

    return models[0]


def analyze_image(image_ref, prompt, model):
    """Send image to OpenRouter for analysis, return plain text."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        die("OPENROUTER_API_KEY environment variable not set")

    # Build image content block
    if image_ref.startswith("http://") or image_ref.startswith("https://"):
        image_url = image_ref
    else:
        image_url = encode_local_image(image_ref)

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ],
        "max_tokens": 4096,
    }

    body = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        OPENROUTER_API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            response_data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")[:500]
        die(f"OpenRouter API returned {e.code}: {error_body}")
    except urllib.error.URLError as e:
        die(f"network error: {e.reason}")
    except Exception as e:
        die(f"request failed: {e}")

    try:
        return response_data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        die(f"unexpected API response: {json.dumps(response_data)[:500]}")


def main():
    if len(sys.argv) < 2:
        print(
            "Usage: analyze_image.py <image_path_or_url> [prompt]\n"
            "  image_path_or_url  local file path or http(s) URL\n"
            "  prompt             optional analysis instruction",
            file=sys.stderr,
        )
        sys.exit(1)

    image_ref = sys.argv[1]
    prompt = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else DEFAULT_PROMPT

    model = resolve_model()

    # Print model to stderr so stdout stays clean for programmatic consumers
    print(f"[using model: {model}]", file=sys.stderr)

    result = analyze_image(image_ref, prompt, model)
    print(result)


if __name__ == "__main__":
    main()
