'use strict';

const store = require('../store');

/**
 * 一条需求上可以同时挂多条提问：每条有自己的 questionId、自己的等待与超时、自己的回答。
 * 本模块只做纯数据操作（读取 / 追加 / 取走 / 清空 / 上限），不写事件、不落库、不碰等待器：
 * - 视图渲染（agentName、skills、expiresAt）在 views.js；
 * - 等待与唤醒在 ask-waiter.js；
 * - 提问 / 回答的流程与校验在 requirements.js。
 * 这样三处读的是同一份数据结构，不会各自维护一套「有没有待回答」的判据。
 */

/** 同一条需求上同时挂着的提问上限：再多就不是「问一句」，该整理成一段说明了 */
const MAX_QUESTIONS = 5;

/**
 * 读取提问列表。
 * 老数据只有单条 `question`：读到时迁进数组并删掉旧字段，避免两处各存一份。
 */
function listQuestions(r) {
  if (!r) return [];
  if (!Array.isArray(r.questions)) {
    const legacy = r.question;
    r.questions = legacy ? [{ ...legacy, id: legacy.id || store.uid('q') }] : [];
    delete r.question;
  }
  return r.questions;
}

function countQuestions(r) {
  return listQuestions(r).length;
}

/** 追加一条提问（调用方负责校验与事件） */
function addQuestion(r, q) {
  listQuestions(r).push(q);
  return q;
}

/** 取走一条提问；不存在返回 null（可能已被回答或超时清掉） */
function takeQuestion(r, qid) {
  const list = listQuestions(r);
  const i = list.findIndex((q) => q.id === qid);
  if (i < 0) return null;
  return list.splice(i, 1)[0];
}

/** 清空全部提问，返回被清掉的那些（调用方据此补「作废」消息、唤醒等待者） */
function clearQuestions(r) {
  const list = listQuestions(r);
  if (!list.length) return [];
  r.questions = [];
  return list;
}

module.exports = {
  MAX_QUESTIONS,
  listQuestions,
  countQuestions,
  addQuestion,
  takeQuestion,
  clearQuestions
};
