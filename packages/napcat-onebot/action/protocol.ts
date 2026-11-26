import { ActionName } from './router';

/**
 * Protocol contract used by an exposed action.
 *
 * The OneBot adapter intentionally exposes more than the OneBot 11 core
 * contract. Keeping the provenance in one place prevents the OpenAPI
 * generator, tests, and maintenance documentation from drifting apart.
 */
export type ActionProtocol = 'onebot11' | 'go-cqhttp' | 'napcat';

/** Implemented actions defined by the OneBot 11 public and hidden API contracts. */
export const ONEBOT11_STANDARD_ACTIONS = [
  ActionName.SendPrivateMsg,
  ActionName.SendGroupMsg,
  ActionName.SendMsg,
  ActionName.DeleteMsg,
  ActionName.GetMsg,
  ActionName.GoCQHTTP_GetForwardMsg,
  ActionName.SendLike,
  ActionName.SetGroupKick,
  ActionName.SetGroupBan,
  ActionName.SetGroupWholeBan,
  ActionName.SetGroupAdmin,
  ActionName.SetGroupCard,
  ActionName.SetGroupName,
  ActionName.SetGroupLeave,
  ActionName.SetSpecialTitle,
  ActionName.SetFriendAddRequest,
  ActionName.SetGroupAddRequest,
  ActionName.GetLoginInfo,
  ActionName.GoCQHTTP_GetStrangerInfo,
  ActionName.GetFriendList,
  ActionName.GetGroupInfo,
  ActionName.GetGroupList,
  ActionName.GetGroupMemberInfo,
  ActionName.GetGroupMemberList,
  ActionName.GetGroupHonorInfo,
  ActionName.GetCookies,
  ActionName.GetCSRF,
  ActionName.GetCredentials,
  ActionName.GetRecord,
  ActionName.GetImage,
  ActionName.CanSendImage,
  ActionName.CanSendRecord,
  ActionName.GetStatus,
  ActionName.GetVersionInfo,
  ActionName.Reboot,
  ActionName.CleanCache,
  ActionName.GoCQHTTP_HandleQuickAction,
] as const;

/** Actions retained for the legacy ecosystem compatibility surface. */
export const GO_CQHTTP_COMPATIBILITY_ACTIONS = [
  ActionName.SetQQProfile,
  ActionName.GoCQHTTP_GetModelShow,
  ActionName.GoCQHTTP_SetModelShow,
  ActionName.GetOnlineClient,
  ActionName.GetUnidirectionalFriendList,
  ActionName.GoCQHTTP_DeleteFriend,
  ActionName.GoCQHTTP_MarkMsgAsRead,
  ActionName.GoCQHTTP_SendGroupForwardMsg,
  ActionName.GoCQHTTP_SendPrivateForwardMsg,
  ActionName.GoCQHTTP_GetGroupMsgHistory,
  ActionName.OCRImage,
  ActionName.IOCRImage,
  ActionName.GetGroupSystemMsg,
  ActionName.GoCQHTTP_GetEssenceMsg,
  ActionName.GoCQHTTP_GetGroupAtAllRemain,
  ActionName.SetGroupPortrait,
  ActionName.SetEssenceMsg,
  ActionName.DelEssenceMsg,
  ActionName.GoCQHTTP_SendGroupNotice,
  ActionName.GoCQHTTP_GetGroupNotice,
  ActionName.DelGroupNotice,
  ActionName.GoCQHTTP_UploadGroupFile,
  ActionName.GOCQHTTP_DeleteGroupFile,
  ActionName.GoCQHTTP_CreateGroupFileFolder,
  ActionName.GoCQHTTP_DeleteGroupFileFolder,
  ActionName.GoCQHTTP_GetGroupFileSystemInfo,
  ActionName.GoCQHTTP_GetGroupRootFiles,
  ActionName.GoCQHTTP_GetGroupFilesByFolder,
  ActionName.GOCQHTTP_GetGroupFileUrl,
  ActionName.GOCQHTTP_UploadPrivateFile,
  ActionName.GoCQHTTP_DownloadFile,
  ActionName.GoCQHTTP_CheckUrlSafely,
  ActionName.GoCQHTTP_SendForwardMsg,
  ActionName.SendGroupSign,
  ActionName.GetGuildList,
  ActionName.GetGuildProfile,
] as const;

const onebot11Actions = new Set<string>(ONEBOT11_STANDARD_ACTIONS);
const goCqHttpActions = new Set<string>(GO_CQHTTP_COMPATIBILITY_ACTIONS);

export function classifyActionProtocol (actionName: string): ActionProtocol {
  const baseActionName = actionName.replace(/_(?:async|rate_limited)$/, '');
  if (onebot11Actions.has(baseActionName)) return 'onebot11';
  if (goCqHttpActions.has(baseActionName)) return 'go-cqhttp';
  return 'napcat';
}
