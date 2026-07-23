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
