# RoomOS Icon Crop Calibration

Upload `roomos-icon-crop-calibration-512.png` as the custom RoomOS icon without
resizing or editing it. Capture and return a full-resolution, uncropped endpoint
screenshot showing the icon beside native RoomOS icons.

The 512×512 target is fully opaque and has no padding. Its nested bands begin at
these source-image offsets from every edge:

| Offset | Color |
| ---: | --- |
| 0 px | White |
| 16 px | Black |
| 32 px | Red |
| 64 px | Orange |
| 96 px | Yellow |
| 128 px | Green |
| 160 px | Cyan |
| 192 px | Blue |
| 224 px | Magenta center |

Screenshot analysis can compare the observed band boundaries with these known
offsets to determine the rendered image size, centering, and any clipping on
each edge.

## Measured Companion Device result

The full-resolution endpoint screenshot captured on 2026-07-23 rendered the
complete 512×512 target into a 60×60 screen-pixel square:

- Screen bounds: `x=1455..1514`, `y=480..539`
- Scale: `60 / 512 = 0.1171875`
- Center: `x=1485`, `y=510`
- Cropping: 0 source pixels on the left, right, top, and bottom
- The outer 16-source-pixel white band remained visible as two screen pixels on
  every edge.

The production icon therefore retains 5% source-canvas padding as an intentional
artwork safety area; RoomOS does not add a hidden crop that must be compensated
for inside the uploaded image.
