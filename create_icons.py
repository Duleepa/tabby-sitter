#!/usr/bin/env python3
"""Convert tabby-sitter.png into Chrome extension icon set — resize as-is, no crop, no transparency."""
from PIL import Image
import os

SRC = '/Users/dups/Downloads/tabby-sitter.png'
OUT_DIR = '/Users/dups/Source/tabby-sitter/public/icons'
SIZES = [16, 32, 48, 128]

def main():
    img = Image.open(SRC).convert('RGBA')

    for size in SIZES:
        icon = img.resize((size, size), Image.Resampling.LANCZOS)
        icon_path = os.path.join(OUT_DIR, f'icon{size}.png')
        icon.save(icon_path)
        print(f"Saved {icon_path}")

if __name__ == '__main__':
    main()
