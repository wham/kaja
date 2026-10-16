---
name: kaja-call-failures
description: Read the failed calls a Kaja run_script report lists. Read when a call failed and it is unclear whether to change the request, the credentials or nothing.
---

# Reading a failure

`run_script` reports each failed call with a kind, so you know what to change:

- `INVALID_REQUEST` — the service rejected what you sent. Fix the request.
- `UNAUTHORIZED` — credentials missing or refused. The app's configuration, not
  the request.
- `NOT_FOUND` — the identifier or route is wrong; the shape is fine.
- `RATE_LIMITED` — wait, retry the same request.
- `SERVER` — the service errored. Changing the request shape will not help.
- `TRANSPORT` — the exchange never completed (connection or codec). **Do not
  retry with different parameters**; nothing you send will change it.
- `UNSUPPORTED` — Kaja does not support this kind of method yet and refused the
  call before it went anywhere. `list_services` marks it `not supported yet`, and
  no request will change it.
