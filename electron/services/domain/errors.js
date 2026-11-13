'use strict';

function fail(message, code, status) {
  const e = new Error(message);
  e.code = code || 'bad_request';
  e.status = status || 400;
  throw e;
}

function notFound(what) {
  fail(what + '不存在', 'not_found', 404);
}

/** 认领冲突：409 并把当前认领者透给调用方（/claim、/complete 共用同一口径） */
function claimConflict(claim, message) {
  const e = new Error(message);
  e.status = 409;
  e.code = 'claim_conflict';
  e.claim = { agent: claim.agent, at: claim.at };
  throw e;
}

module.exports = { fail, notFound, claimConflict };
