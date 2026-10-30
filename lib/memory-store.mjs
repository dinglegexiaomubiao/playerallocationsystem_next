/**
 * 照片落盘与读取。
 *
 * 为什么把文件放在**代码目录之外**：
 *   1. deploy.sh 每次部署都会把新源码解压进 /www/wwwroot/laroja，
 *      上传文件放 public/ 下面能活下来，但会混进源码目录、被算进备份包、被 git 当脏文件；
 *   2. 独立目录（/www/wwwroot/laroja-uploads）可以直接被 Nginx 挂成静态目录，
 *      以后要迁 OSS 也只改这里；
 *   3. 备份/迁移时「代码」和「内容」是两件事，分开才敢单独清空其中一边。
 *
 * 为什么走 base64 而不是 multipart：小程序端没有 FormData 的 File 对象，
 * 网页端也已经在 canvas 里压缩过一遍了，两边统一传 dataURL 最省事，
 * 服务端只需要解码 + 认一下文件头，不用引入 multer/formidable 这类依赖。
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/** 生产默认目录（与代码目录同级），本地开发落到项目下的 .uploads */
const DEFAULT_DIR =
  process.env.NODE_ENV === 'production'
    ? '/www/wwwroot/laroja-uploads'
    : path.join(process.cwd(), '.uploads');

export const uploadRoot = () => process.env.UPLOAD_DIR || DEFAULT_DIR;

const EXT_OF = { jpg: 'jpg', png: 'png', webp: 'webp' };
const MIME_OF = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/**
 * 用文件头认格式，**不信** dataURL 里声明的 MIME。
 * 客户端可以随便写 `data:image/png;base64,<任意内容>`，只按声明存盘等于允许上传任意文件。
 */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/** 每张图要落的相对路径：memories/YYYY/MM/<uuid>.<ext>，月份按服务器本地时间。 */
function relPathFor(ext) {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `memories/${y}/${m}/${crypto.randomUUID()}.${EXT_OF[ext]}`;
}

/**
 * 保存一张 base64 图片，返回数据库要存的 { p, w, h }。
 * 返回 null 表示「不是图片 / 太大 / 格式不对」，由调用方给用户报错。
 */
export async function saveDataUrl(dataUrl, { maxBytes = 4 * 1024 * 1024 } = {}) {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  if (!s.startsWith('data:') || comma < 0) return { ok: false, error: '这不是一张图片' };

  let buf;
  try {
    buf = Buffer.from(s.slice(comma + 1), 'base64');
  } catch {
    return { ok: false, error: '图片数据不完整，重传一次试试' };
  }
  if (!buf.length) return { ok: false, error: '图片是空的' };
  if (buf.length > maxBytes) {
    return { ok: false, error: `单张照片不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB` };
  }

  const ext = sniff(buf);
  if (!ext) return { ok: false, error: '只支持 JPG / PNG / WebP 图片' };

  const rel = relPathFor(ext);
  const abs = path.join(uploadRoot(), rel);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  // wx：目标已存在就报错，绝不覆盖别人的文件（uuid 撞了也不至于静默覆盖）
  await fs.promises.writeFile(abs, buf, { flag: 'wx', mode: 0o644 });

  return { ok: true, p: rel };
}

/** 读取已存的文件。path 必须已经过 isPhotoPath 校验（由调用方做）。 */
export function openStored(rel) {
  const abs = path.join(uploadRoot(), rel);
  const ext = path.extname(abs).slice(1).toLowerCase();
  return {
    abs,
    mime: MIME_OF[ext] || 'application/octet-stream',
    exists: fs.existsSync(abs),
  };
}

/** 本地开发目录是否已存在（自检脚本会用到） */
export const uploadRootExists = () => fs.existsSync(uploadRoot());
