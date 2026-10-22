import sys
import subprocess
from PIL import Image, ImageDraw, ImageFont

print("Testing Pillow & FFmpeg pipe...")
width, height = 1080, 1920
fps = 30
duration_sec = 2

cmd = [
    "ffmpeg", "-y",
    "-f", "image2pipe",
    "-vcodec", "png",
    "-r", str(fps),
    "-i", "-",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "ultrafast",
    "C:/Users/Dhrubo/Desktop/ex video/test.mp4"
]

proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

for f in range(fps * duration_sec):
    img = Image.new("RGB", (width, height), (15, 23, 42))
    draw = ImageDraw.Draw(img)
    draw.rectangle([50, 50, 1030, 1870], outline=(234, 88, 12), width=4)
    draw.text((100, 200), f"Test Frame {f}", fill=(255, 255, 255))
    img.save(proc.stdin, "PNG")

proc.stdin.close()
proc.wait()
print("Test video created successfully!")
