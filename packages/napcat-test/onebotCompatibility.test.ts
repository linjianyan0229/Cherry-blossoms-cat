// StreamBasic must be evaluated before the action base because of their circular import.
import '../napcat-onebot/action/stream/StreamBasic';
import { describe, expect, test, vi } from 'vitest';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { Value } from '@sinclair/typebox/value';
import { ChatType } from 'napcat-core';

import { createActionMap, getAllHandlers } from '../napcat-onebot/action';
import { AutoRegisterRouter } from '../napcat-onebot/action/auto-register';
import { ActionName } from '../napcat-onebot/action/router';
import {
  classifyActionProtocol,
  GO_CQHTTP_COMPATIBILITY_ACTIONS,
  ONEBOT11_STANDARD_ACTIONS,
} from '../napcat-onebot/action/protocol';
import SendPrivateMsg from '../napcat-onebot/action/msg/SendPrivateMsg';
import SendGroupMsg from '../napcat-onebot/action/group/SendGroupMsg';
import { normalize, SendMsgPayloadSchema, type SendMsgBase, type SendMsgPayload } from '../napcat-onebot/action/msg/SendMsg';
import { OB11MessageDataType, OB11PostSendMsgSchema } from '../napcat-onebot/types/message';

function createSendAction (Action: typeof SendPrivateMsg | typeof SendGroupMsg = SendPrivateMsg) {
  const getUidByUinV2 = vi.fn().mockResolvedValue('friend-uid');
  const isBuddy = vi.fn().mockResolvedValue(true);
  const sendElements = [{ elementType: 1, elementId: 'test-text' }];
  const deleteAfterSentFiles: string[] = [];
  const createSendElements = vi.fn().mockResolvedValue({ sendElements, deleteAfterSentFiles });
  const sendMsgWithOb11UniqueId = vi.fn().mockResolvedValue({ id: 24680 });
  const action = new Action({
    apis: { MsgApi: { createSendElements, sendMsgWithOb11UniqueId } },
  } as never, {
    context: { logger: { logError: vi.fn() } },
    apis: {
      UserApi: { getUidByUinV2 },
      FriendApi: { isBuddy },
    },
  } as never);
  return { action, getUidByUinV2, isBuddy, createSendElements, sendMsgWithOb11UniqueId, sendElements, deleteAfterSentFiles };
}

async function sendAction (action: SendMsgBase, payload: SendMsgPayload, transport: 'http' | 'websocket') {
  return transport === 'http'
    ? action.handle(payload, 'test-http', {} as never, undefined, 'onebot-echo')
    : action.websocketHandle(payload, 'onebot-echo', 'test-websocket', {} as never);
}

describe('OneBot compatibility contract', () => {
  test.each([123456789, '123456789'])('accepts %s user IDs for send_private_msg', (userId) => {
    const payload = {
      message_type: 'private' as const,
      user_id: userId,
      message: 'hello',
    };

    for (const schema of [OB11PostSendMsgSchema, SendMsgPayloadSchema]) {
      const parsed = Value.Parse(schema, structuredClone(payload));
      expect(TypeCompiler.Compile(schema).Check(parsed)).toBe(true);
    }

    const action = new SendPrivateMsg(null as never, null as never);
    expect(TypeCompiler.Compile(action.payloadSchema!).Check(payload)).toBe(true);
  });

  test('normalizes numeric group IDs through the common send-message schema', () => {
    const payload = {
      message_type: 'group' as const,
      group_id: 987654321,
      message: [{ type: 'text', data: { text: 'hello' } }],
    };

    const parsed = Value.Parse(SendMsgPayloadSchema, payload);
    expect(TypeCompiler.Compile(SendMsgPayloadSchema).Check(parsed)).toBe(true);
    expect(String((parsed as { group_id: string | number }).group_id)).toBe('987654321');
  });

  test('supports plain text, CQ Code, and message segments', () => {
    expect(normalize('hello', true)).toEqual([
      { type: 'text', data: { text: 'hello' } },
    ]);
    expect(normalize('[CQ:at,qq=123456] hello')).toEqual([
      { type: 'at', data: { qq: '123456' } },
      { type: 'text', data: { text: ' hello' } },
    ]);
    expect(normalize({ type: OB11MessageDataType.text, data: { text: 'segment' } })).toEqual([
      { type: 'text', data: { text: 'segment' } },
    ]);
  });

  test('keeps protocol provenance explicit for standard, compatibility, and extension actions', () => {
    expect(ONEBOT11_STANDARD_ACTIONS).toContain(ActionName.SendPrivateMsg);
    expect(ONEBOT11_STANDARD_ACTIONS).toContain(ActionName.GoCQHTTP_HandleQuickAction);
    expect(GO_CQHTTP_COMPATIBILITY_ACTIONS).toContain(ActionName.SetQQProfile);
    expect(classifyActionProtocol(ActionName.SendPrivateMsg)).toBe('onebot11');
    expect(classifyActionProtocol('.handle_quick_operation')).toBe('onebot11');
    expect(classifyActionProtocol(ActionName.SetQQProfile)).toBe('go-cqhttp');
    expect(classifyActionProtocol('napcat_custom_action')).toBe('napcat');
  });

  test('keeps protocol catalogues unique and mutually exclusive', () => {
    const standard = new Set<string>(ONEBOT11_STANDARD_ACTIONS);
    const compatibility = new Set<string>(GO_CQHTTP_COMPATIBILITY_ACTIONS);
    expect(standard.size).toBe(ONEBOT11_STANDARD_ACTIONS.length);
    expect(compatibility.size).toBe(GO_CQHTTP_COMPATIBILITY_ACTIONS.length);
    expect([...compatibility].filter(actionName => standard.has(actionName))).toEqual([]);
  });

  test.each([
    '.ocr_image',
    'get_unidirectional_friend_list',
    'send_group_sign',
    '_del_group_notice',
    'get_guild_list',
    'get_guild_service_profile',
  ])('classifies %s as an ecosystem compatibility action', (actionName) => {
    expect(GO_CQHTTP_COMPATIBILITY_ACTIONS).toContain(actionName);
    expect(classifyActionProtocol(actionName)).toBe('go-cqhttp');
  });

  test('keeps standard provenance for action suffix aliases', () => {
    for (const actionName of ONEBOT11_STANDARD_ACTIONS) {
      expect(classifyActionProtocol(`${actionName}_async`)).toBe('onebot11');
      expect(classifyActionProtocol(`${actionName}_rate_limited`)).toBe('onebot11');
    }
  });

  test('keeps compatibility provenance for action suffix aliases', () => {
    for (const actionName of GO_CQHTTP_COMPATIBILITY_ACTIONS) {
      expect(classifyActionProtocol(`${actionName}_async`)).toBe('go-cqhttp');
      expect(classifyActionProtocol(`${actionName}_rate_limited`)).toBe('go-cqhttp');
    }
  });

  test('registers every action in the standard and compatibility catalogues', () => {
    const actions = createActionMap(null as never, null as never);
    type RegisteredActionName = Parameters<typeof actions.get>[0];

    for (const actionName of [...ONEBOT11_STANDARD_ACTIONS, ...GO_CQHTTP_COMPATIBILITY_ACTIONS]) {
      const action = actions.get(actionName as RegisteredActionName);
      expect(action, actionName).toBeDefined();
      expect(action?.actionName).toBe(actionName);
    }
  });

  test('registers suffix aliases for every registered action', () => {
    const actions = createActionMap(null as never, null as never);
    const handlers = [
      ...getAllHandlers(null as never, null as never),
      ...AutoRegisterRouter.map(Action => new Action(null as never, null as never)),
    ];
    type RegisteredActionName = Parameters<typeof actions.get>[0];

    expect(handlers.length).toBeGreaterThan(0);
    for (const { actionName } of handlers) {
      const action = actions.get(actionName as RegisteredActionName);
      expect(action, actionName).toBeDefined();
      expect(actions.get(`${actionName}_async` as RegisteredActionName), `${actionName}_async`).toBe(action);
      expect(actions.get(`${actionName}_rate_limited` as RegisteredActionName), `${actionName}_rate_limited`).toBe(action);
    }
  });
});

describe.each(['http', 'websocket'] as const)('%s send-message handling', (transport) => {
  test.each([123456789, '123456789', '9007199254740993'])('sends private messages with the exact %s user ID', async (userId) => {
    const { action, getUidByUinV2, isBuddy, createSendElements, sendMsgWithOb11UniqueId, sendElements, deleteAfterSentFiles } = createSendAction();
    const response = await sendAction(action, { user_id: userId, message: 'hello' }, transport);
    const peer = { chatType: ChatType.KCHATTYPEC2C, peerUid: 'friend-uid', guildId: '' };

    expect(response).toMatchObject({ status: 'ok', retcode: 0, data: { message_id: 24680 }, echo: 'onebot-echo' });
    expect(getUidByUinV2).toHaveBeenCalledExactlyOnceWith(String(userId));
    expect(isBuddy).toHaveBeenCalledExactlyOnceWith('friend-uid');
    expect(createSendElements).toHaveBeenCalledExactlyOnceWith([{ type: 'text', data: { text: 'hello' } }], peer);
    expect(sendMsgWithOb11UniqueId).toHaveBeenCalledExactlyOnceWith(peer, sendElements, deleteAfterSentFiles, undefined);
  });

  test.each([987654321, '987654321'])('sends group messages with the exact %s group ID', async (groupId) => {
    const { action, getUidByUinV2, isBuddy, createSendElements, sendMsgWithOb11UniqueId, sendElements, deleteAfterSentFiles } = createSendAction(SendGroupMsg);
    const message = [{ type: OB11MessageDataType.text as const, data: { text: 'group hello' } }];
    const response = await sendAction(action, { group_id: groupId, message }, transport);
    const peer = { chatType: ChatType.KCHATTYPEGROUP, peerUid: String(groupId) };

    expect(response).toMatchObject({ status: 'ok', retcode: 0, data: { message_id: 24680 }, echo: 'onebot-echo' });
    expect(getUidByUinV2).not.toHaveBeenCalled();
    expect(isBuddy).not.toHaveBeenCalled();
    expect(createSendElements).toHaveBeenCalledExactlyOnceWith(message, peer);
    expect(sendMsgWithOb11UniqueId).toHaveBeenCalledExactlyOnceWith(peer, sendElements, deleteAfterSentFiles, undefined);
  });

  test.each([true, 'true'])('sends CQ node text literally when auto_escape is %s', async (autoEscape) => {
    const { action, createSendElements, sendMsgWithOb11UniqueId } = createSendAction();
    const message = '[CQ:node,id=123] text';
    const response = await sendAction(action, { user_id: '123456789', message, auto_escape: autoEscape }, transport);

    expect(response).toMatchObject({ status: 'ok', retcode: 0, data: { message_id: 24680 }, echo: 'onebot-echo' });
    expect(createSendElements).toHaveBeenCalledExactlyOnceWith(
      [{ type: 'text', data: { text: message } }],
      { chatType: ChatType.KCHATTYPEC2C, peerUid: 'friend-uid', guildId: '' }
    );
    expect(sendMsgWithOb11UniqueId).toHaveBeenCalledOnce();
  });

  test.each([false, 'false'])('rejects mixed CQ nodes and text when auto_escape is %s', async (autoEscape) => {
    const { action, getUidByUinV2, createSendElements, sendMsgWithOb11UniqueId } = createSendAction();
    const response = await sendAction(action, {
      user_id: '123456789',
      message: '[CQ:node,id=123] text',
      auto_escape: autoEscape,
    }, transport);

    expect(response).toMatchObject({
      status: 'failed',
      retcode: transport === 'http' ? 400 : 1400,
      data: null,
    });
    expect(getUidByUinV2).not.toHaveBeenCalled();
    expect(createSendElements).not.toHaveBeenCalled();
    expect(sendMsgWithOb11UniqueId).not.toHaveBeenCalled();
  });
});
