# OneBot API compatibility map

NapCat exposes a OneBot 11 adapter with three kinds of actions.

1. **OneBot 11 standard** actions follow the public and hidden action contracts shared with OneBot clients.
2. **Go-CQHTTP compatibility** actions retain legacy names and fields for existing bot frameworks.
3. **NapCat extensions** expose QQ/NTQQ capabilities outside the two contracts above.

The classification source of truth is [packages/napcat-onebot/action/protocol.ts](packages/napcat-onebot/action/protocol.ts). It is consumed by the OpenAPI generator, which adds the `x-napcat-protocol` operation field and a protocol tag to every generated action path. The action names themselves remain defined in [packages/napcat-onebot/action/router.ts](packages/napcat-onebot/action/router.ts).

## Implemented OneBot 11 standard actions

The adapter implements these 36 actions from the OneBot 11 public API contract.

```text
send_private_msg
send_group_msg
send_msg
delete_msg
get_msg
get_forward_msg
send_like
set_group_kick
set_group_ban
set_group_whole_ban
set_group_admin
set_group_card
set_group_name
set_group_leave
set_group_special_title
set_friend_add_request
set_group_add_request
get_login_info
get_stranger_info
get_friend_list
get_group_info
get_group_list
get_group_member_info
get_group_member_list
get_group_honor_info
get_cookies
get_csrf_token
get_credentials
get_record
get_image
can_send_image
can_send_record
get_status
get_version_info
set_restart
clean_cache
```

The OneBot 11 hidden API action `.handle_quick_operation` is also implemented and classified as `onebot11`. The public actions `set_group_anonymous_ban` and `set_group_anonymous` are currently unimplemented. The classification records the source of each action contract. Individual request fields, responses, and execution semantics still require compatibility checks.

An action's directory does not determine its protocol classification. For example, `get_forward_msg`, `get_stranger_info`, and `.handle_quick_operation` are standard actions implemented in the `go-cqhttp` directory.

The compatibility list includes legacy aliases and documented actions such as `.ocr_image`, `get_unidirectional_friend_list`, `send_group_sign`, `_del_group_notice`, `get_guild_list`, and `get_guild_service_profile`.

The catalogues contain registered actions. The legacy `.get_word_slices` name is declared in `router.ts` but has no registered implementation, so it is excluded from the compatibility list.

## Compatibility and extension rules

- The send-message request schemas accept `user_id` and `group_id` as JSON numbers or strings. The implementation converts them to strings before resolving QQ peers. IDs exceeding JavaScript's safe integer range must arrive as strings to preserve their digits. Other action schemas retain their individual ID contracts.
- Standard message input accepts a plain string, one message segment, or an array of segments. CQ Code is decoded only when `auto_escape` is false.
- All registered actions also have `_async` and `_rate_limited` aliases and inherit the base action's protocol classification. They currently share the base handler and execution path. Their registration does not provide a separate asynchronous queue or rate limiter. Registration and shared-handler behavior are tested in `packages/napcat-test/onebotCompatibility.test.ts`.
- `status`, `retcode`, `data`, `message`, and `echo` are the common response fields. `wording` and `stream` are compatibility/streaming fields added by NapCat's response wrapper.
- `napcat-protocol` is a separate, opt-in private adapter. It is not part of the OneBot 11 action map described here.

## Maintenance procedure

Follow these steps when the upstream OneBot 11 specification changes.

1. Compare the upstream action list with `ONEBOT11_STANDARD_ACTIONS` in `action/protocol.ts`.
2. Update the action implementation and its TypeBox payload/return schema.
3. Update this document if the public action list changes.
4. Add or update a compatibility case in `onebotCompatibility.test.ts`.
5. Regenerate OpenAPI with `pnpm build:openapi` in the designated remote test container and verify the action's `x-napcat-protocol` value.

The OpenAPI generator documents canonical HTTP POST paths. Its protocol tags and `x-napcat-protocol` fields apply to those paths. GET transport and action suffix aliases are handled by the adapter and are described here rather than emitted as additional OpenAPI operations.

## Specification sources

- [OneBot 11 public API](https://github.com/botuniverse/onebot-11/blob/master/api/public.md)
- [OneBot 11 hidden API](https://github.com/botuniverse/onebot-11/blob/master/api/hidden.md)
- [OneBot 11 action suffixes](https://github.com/botuniverse/onebot-11/blob/master/api/README.md)
- [go-cqhttp API reference](https://docs.go-cqhttp.org/api/)
- [go-cqhttp guild API](https://github.com/Mrs4s/go-cqhttp/blob/master/docs/guild.md)
- [go-cqhttp v1.0.0-rc4 release notes](https://github.com/Mrs4s/go-cqhttp/releases/tag/v1.0.0-rc4)

The repository does not import an official OneBot SDK or machine-readable schema. The adapter therefore treats the official action/event contract as the external compatibility boundary, while NapCatCore, QQ native services, protobuf, and packet APIs provide the internal implementation.
