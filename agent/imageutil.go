package main

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
)

// encodeScreenshot downscales to at most maxWidth pixels wide and encodes as JPEG, keeping uploads small.
func encodeScreenshot(img image.Image, maxWidth, quality int) ([]byte, error) {
	b := img.Bounds()
	if b.Dx() > maxWidth {
		img = downscale(img, maxWidth, b.Dy()*maxWidth/b.Dx())
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// downscale is a box filter: each output pixel averages the source pixels it covers (legible text, no dependencies).
func downscale(src image.Image, w, h int) image.Image {
	if h < 1 {
		h = 1
	}
	sb := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		y0 := sb.Min.Y + y*sb.Dy()/h
		y1 := sb.Min.Y + (y+1)*sb.Dy()/h
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for x := 0; x < w; x++ {
			x0 := sb.Min.X + x*sb.Dx()/w
			x1 := sb.Min.X + (x+1)*sb.Dx()/w
			if x1 <= x0 {
				x1 = x0 + 1
			}
			var r, g, bl, n uint32
			for yy := y0; yy < y1; yy++ {
				for xx := x0; xx < x1; xx++ {
					cr, cg, cb, _ := src.At(xx, yy).RGBA()
					r, g, bl, n = r+cr, g+cg, bl+cb, n+1
				}
			}
			dst.SetRGBA(x, y, color.RGBA{uint8(r / n >> 8), uint8(g / n >> 8), uint8(bl / n >> 8), 255})
		}
	}
	return dst
}
