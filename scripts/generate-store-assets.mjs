import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const width = 1024;
const height = 500;
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "release/store-assets/fridge-menu-feature-graphic-1024x500.png");
const pixels = Buffer.alloc(width * height * 4);
const palette = {
  cream: [251, 248, 239, 255], green: [23, 63, 53, 255], leaf: [47, 125, 99, 255],
  gold: [231, 166, 75, 255], lime: [233, 244, 106, 255], ink: [23, 63, 53, 255],
};

function set(x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = (y * width + x) * 4;
  pixels.set(color, index);
}
function rect(x, y, w, h, color) {
  for (let row = y; row < y + h; row += 1) for (let column = x; column < x + w; column += 1) set(column, row, color);
}
function circle(cx, cy, radius, color) {
  for (let y = cy - radius; y <= cy + radius; y += 1) for (let x = cx - radius; x <= cx + radius; x += 1) if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) set(x, y, color);
}
function ellipse(cx, cy, rx, ry, color) {
  for (let y = cy - ry; y <= cy + ry; y += 1) for (let x = cx - rx; x <= cx + rx; x += 1) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(x, y, color);
}
const glyphs = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"], B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"], E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"], G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"], M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"], R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"], S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"], T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"], U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
};
function text(value, x, y, scale, color) {
  for (const letter of value) {
    if (letter === " ") { x += 3 * scale; continue; }
    const glyph = glyphs[letter];
    for (let row = 0; row < glyph.length; row += 1) for (let column = 0; column < glyph[row].length; column += 1) if (glyph[row][column] === "1") rect(x + column * scale, y + row * scale, scale, scale, color);
    x += 6 * scale;
  }
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

rect(0, 0, width, height, palette.cream);
rect(630, 0, 394, height, palette.green);
circle(830, 245, 162, palette.gold);
ellipse(830, 298, 146, 97, palette.cream);
ellipse(830, 190, 112, 65, palette.leaf);
ellipse(855, 160, 57, 31, palette.lime);
text("FRIDGE", 72, 112, 13, palette.ink);
text("MENU", 72, 230, 21, palette.green);
rect(72, 401, 424, 12, palette.gold);
text("USE FIRST", 72, 438, 7, palette.green);

const raw = Buffer.alloc((width * 4 + 1) * height);
for (let y = 0; y < height; y += 1) { raw[y * (width * 4 + 1)] = 0; pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
await mkdir(resolve(root, "release/store-assets"), { recursive: true });
await writeFile(output, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
console.log(`STORE_ASSET_OK path=${output} width=${width} height=${height}`);
