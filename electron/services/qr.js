'use strict';

const qrcode = require('qrcode-generator');

/**
 * 连接信息 → 二维码 SVG（内联进设置弹窗，不落地文件、不调外部接口）。
 * 内容由调用方决定（mobile-protocol.connectPayload），这里只管画。
 */
function svg(text, opts) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text || ''));
  qr.make();
  const o = opts || {};
  return qr.createSvgTag({
    cellSize: o.cellSize || 4,
    margin: o.margin === undefined ? 4 : o.margin,
    scalable: true
  });
}

module.exports = { svg };
