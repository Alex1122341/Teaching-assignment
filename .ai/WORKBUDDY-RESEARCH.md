# Product integration and cost research

Checked 2026-09-21. Supported V1 path: **Manual WorkBuddy handoff**.

Official sources:
- [WorkBuddy Open API](https://open.workbuddy.cn/docs/openapi)
- [WorkBuddy third-party applications](https://open.workbuddy.cn/docs/third-party-app)
- [WorkBuddy credits](https://www.codebuddy.cn/docs/workbuddy/Credits)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)

WorkBuddy documents OAuth-based third-party access and product credits. The
reviewed sources did not establish that this owner's particular promotional
HY4/DeepSeek entitlement carries over to automated third-party inference.
That billing question remains unverified. V1 therefore implements no WorkBuddy
API adapter. Owner copies generated prompts into the official product.

Codex documentation distinguishes ChatGPT sign-in from API-key billing. Owner
uses their existing Codex entitlement and checks its remaining quota. No
OpenAI API key, Tencent TokenHub key, DeepSeek key or model endpoint is used.

The scripts themselves consume local CPU/disk and optionally GitHub REST.
GitHub Actions/artifact retention consume the account's applicable allowance;
they are not unconditionally free. Product chats consume existing subscription
or promotional limits. V1 produces NO new model API charges. It does not buy
credits or promise unlimited product use.

Future V2: only after officially verifying authorization, entitlement and billing,
an optional adapter could consume the same task schema and return evidence.
Do not implement speculative adapters or automate product web interfaces.
