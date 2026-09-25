# Advisory routing

| Role | Default product/model alias | Suitable work |
| --- | --- | --- |
| Architect | ChatGPT Sol Extra High | Requirements, architecture, permissions |
| Builder | WorkBuddy HY4 | UI, dashboards, workflow UX, multifile changes |
| Builder/reviewer | WorkBuddy DeepSeek V4.1 Flash | Bugs, state, edge cases, automation |
| Integrator | Codex Terra | Integration, bounded blocking fixes, tests |
| Final reviewer | ChatGPT Sol Extra High | Read-only acceptance review |

HY4 builds -> DeepSeek reviews; DeepSeek builds -> HY4 reviews.
Codex builds -> HY4 or DeepSeek reviews. Routing is advisory; availability and
quotas are confirmed in each product. V1 neither selects a paid API nor promises
model access. Keep final review independent and read-only.
