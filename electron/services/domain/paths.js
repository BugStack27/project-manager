'use strict';

/** 路径查重口径：分隔符与末尾斜杠不敏感；Windows 下大小写不敏感 */
function samePath(a, b) {
  const norm = (p) => {
    const s = String(p || '').trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? s.toLowerCase() : s;
  };
  const x = norm(a);
  return !!x && x === norm(b);
}

/**
 * 把命令的工作目录从旧项目目录重定到新目录。
 * 命中「旧目录本身」或「旧目录下的子路径」时返回改写结果，否则返回 null。
 * 比较口径与 samePath 一致（分隔符 / 尾斜杠 / Windows 下大小写不敏感）；前缀必须落在分隔符边界上，
 * 所以 D:\a 不会命中兄弟目录 D:\ab。子路径保留用户原来的写法，只替换前缀。
 */
function rebaseCwd(cwd, from, to) {
  const raw = String(cwd || '').trim();
  const body = String(from || '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '');
  const dst = String(to || '')
    .trim()
    .replace(/[\\/]+$/, '');
  if (!raw || !body || !dst) return null;

  // 逐段转义再拼回分隔符通配：一段里既可能有正则元字符，也可能是盘符根（D: 退化成 "D:" 仍可用）
  const pattern = body
    .split('/')
    .map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\\\/]+');
  const hit = new RegExp('^' + pattern + '([\\\\/]+.*)?$', process.platform === 'win32' ? 'i' : '').exec(raw);
  if (!hit) return null;

  const rest = (hit[1] || '').replace(/^[\\/]+/, '');
  if (!rest) return dst;
  // 分隔符跟原 cwd 走：用户写 sub/dir 就还他 "sub/dir"，别混着反斜杠
  return dst + (hit[1].indexOf('\\') >= 0 ? '\\' : '/') + rest;
}

module.exports = { samePath, rebaseCwd };
