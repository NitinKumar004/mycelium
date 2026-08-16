// Render a word to a luminance mask for image-mask seeding — used by the title
// sequence so the app's name resolves out of the agent field itself (§7).
export async function makeTextMask(text: string, size = 1024): Promise<ImageBitmap> {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Fit the word across ~86% of the width.
  let font = size * 0.2;
  ctx.font = `800 ${font}px "Helvetica Neue", Arial, sans-serif`;
  const target = size * 0.86;
  const w = ctx.measureText(text).width;
  font *= target / w;
  ctx.font = `800 ${font}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(text, size / 2, size / 2);
  return await createImageBitmap(c);
}
