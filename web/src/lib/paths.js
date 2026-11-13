/* 路径比较：分隔符与末尾斜杠不敏感；Windows 下大小写不敏感。 */

export function samePath(a, b) {
  const norm = (p) => {
    const s = String(p || '').trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '');
    return window.pm && window.pm.platform === 'win32' ? s.toLowerCase() : s;
  };
  const x = norm(a);
  return !!x && x === norm(b);
}
