"""Export Windows icon sizes from the supplied DooTTY branding.

Requires Pillow. The source artwork is kept unchanged. By default use the
square application asset; --source imports a supplied PNG and trims its empty
transparent margins and faint shadow pixels before making a square icon.
"""
import argparse
from pathlib import Path
from PIL import Image

project = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path)
parser.add_argument('--alpha-threshold', type=int, default=32,
                    help='Alpha cutoff for the crop bounds (0–254); ignores faint shadow margins.')
args = parser.parse_args()
if not 0 <= args.alpha_threshold <= 254:
    parser.error('--alpha-threshold must be between 0 and 254')
asset = project / 'assets' / 'branding' / 'app-icon.png'
if args.source:
    image = Image.open(args.source).convert('RGBA')
    box = image.getchannel('A').point(lambda value: 255 if value > args.alpha_threshold else 0).getbbox()
    if box is None:
        raise ValueError('The supplied icon is fully transparent')
    left, top, right, bottom = box
    image = image.crop((max(0, left - 4), max(0, top - 4), min(image.width, right + 4), min(image.height, bottom + 4)))
    side = max(image.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.alpha_composite(image, ((side - image.width) // 2, (side - image.height) // 2))
    image = square.resize((512, 512), Image.Resampling.LANCZOS)
    asset.parent.mkdir(parents=True, exist_ok=True)
    image.save(asset)
else:
    image = Image.open(asset).convert('RGBA')
root = project / 'src-tauri' / 'icons'
root.mkdir(parents=True, exist_ok=True)
for size in (32, 128):
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / f'{size}x{size}.png')
image.save(root / 'icon.ico', format='ICO', sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])
print('Exported the supplied DooTTY logo to the app asset and Windows icons.')
