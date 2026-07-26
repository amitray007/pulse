# Example source: Web Vitals

A reference [source adapter](../../packages/core/src/source.ts) showing how to teach Pulse a new
kind of data. It turns a **Shopify App Bridge Web Vitals beacon** into generic Pulse events.

This is an **example**, not part of the Pulse core — Pulse itself is a generic telemetry platform and
knows nothing about web vitals. Use this as a template for your own adapter.

## What it does

One beacon (`{ app, shop, country, launch_id, metrics: [...] }`) explodes into one generic event per
metric:

| Beacon field                            | Generic event                               |
| --------------------------------------- | ------------------------------------------- |
| a metric `{ name: "LCP", value: 2772 }` | `name="LCP"`, `value_num=2772`, `unit="ms"` |
| `CLS` value                             | `value_num`, `unit="score"`                 |
| `metric.id`                             | `event_id` (dedup key)                      |
| `launch_id`                             | `group_id`                                  |
| `app` / `shop` / `country` / ...        | labels                                      |

## Using it

```ts
import { SourceRegistry } from "@pulse/core";
import { webVitalSource } from "@pulse/example-web-vital";

const registry = new SourceRegistry();
registry.register(webVitalSource);
// pass `registry` to buildServer(...) in the collector
```

Then POST a beacon to the collector with `"source_type": "web_vital"`.
