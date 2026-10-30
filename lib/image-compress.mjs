/**
 * 浏览器端把选中的图片压到「够看又不占地」的尺寸，再交给上传接口。
 *
 * 为什么不在服务端压：服务器上没有 sharp（多一个原生依赖，部署要多一步），
 * 而且原图（手机拍的 4~8MB）上传本身就要占满弱网的带宽 —— 先压再传更快。
 *
 * 1600px 长边 + q0.82 的 JPEG，实测一张 3~400KB，在手机上看着和原图没差别，
 * 九宫格里也不会糊。
 */

const MAX_EDGE = 1600;
const QUALITY = 0.82;

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这张图打不开'));
    };
    img.src = url;
  });
}

/**
 * @param {File} file
 * @returns {Promise<{data: string, w: number, h: number, size: number}>} data 是 dataURL
 */
export async function compressImage(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('只能选图片');

  let src;
  if (typeof createImageBitmap === 'function') {
    try {
      // 手机竖拍的照片带 EXIF 方向，不指定 from-image 会躺倒
      src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      src = await loadViaImg(file);
    }
  } else {
    src = await loadViaImg(file);
  }

  const sw = src.width || 1;
  const sh = src.height || 1;
  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // PNG 的透明区域转 JPEG 会变黑，先铺白底
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();

  const data = canvas.toDataURL('image/jpeg', QUALITY);
  return { data, w, h, size: Math.round((data.length * 3) / 4) };
}
