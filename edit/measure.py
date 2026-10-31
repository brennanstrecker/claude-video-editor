#!/usr/bin/env python3
"""
measure.py: how wide each line of text is in the caption font, so build.mjs
can size the headline by rule 26 instead of by eye.

  python3 measure.py <font.ttf> "<line>" ["<line>" ...]

Prints JSON: {"unitsPerEm": 1000, "cellUnits": 1360, "capUnits": 705,
"lines": [8006, 7700]}. Line widths are in font units (advance widths).
libass sizes a font by its full cell (Windows ascent + descent), so on screen:
width_px = units * fontsize / cellUnits and cap_px = capUnits * fontsize /
cellUnits.
"""
import json
import sys

from fontTools.ttLib import TTFont


def main() -> int:
    font = TTFont(sys.argv[1])
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    os2 = font["OS/2"]
    space = cmap.get(ord(" "))

    def width(line: str) -> int:
        return sum(hmtx[cmap.get(ord(c), space)][0] for c in line)

    json.dump({
        "unitsPerEm": font["head"].unitsPerEm,
        "cellUnits": os2.usWinAscent + os2.usWinDescent,
        "capUnits": os2.sCapHeight,
        "lines": [width(l) for l in sys.argv[2:]],
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
