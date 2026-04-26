import zlib
import struct
import os

def make_png(width, height, rgb):
    def png_chunk(chunk_type, data):
        chunk = chunk_type + data
        crc = zlib.crc32(chunk) & 0xffffffff
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', crc)
    
    raw = b''.join(b'\x00' + bytes(rgb) * width for _ in range(height))
    compressed = zlib.compress(raw)
    
    idat = png_chunk(b'IDAT', compressed)
    ihdr = png_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    iend = png_chunk(b'IEND', b'')
    
    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend

os.makedirs('public/icons', exist_ok=True)
for size in [16, 48, 128]:
    with open(f'public/icons/icon{size}.png', 'wb') as f:
        f.write(make_png(size, size, (0x1a, 0x73, 0xe8)))  # blue-ish

print("Icons generated in public/icons")
