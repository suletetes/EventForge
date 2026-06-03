# Architecture diagrams

These are generated from `generate_architecture_diagram.py`. The script is the source of truth, not the images. If the architecture changes, update the script and re-run it.

## The three views

### 1. Request flow

How requests get from users to the API to EventBridge.

![Request Flow](eventforge-1-request-flow.png)

### 2. Order workflow

The Step Functions saga. This is where the interesting error handling lives.

![Order Workflow](eventforge-2-order-workflow.png)

### 3. Background processing

SQS queues, Lambda processors, dead letter queues, and the monitoring setup.

![Background Processing](eventforge-3-background-processing.png)

## Edge colors

| Color | Meaning |
|-------|---------|
| Blue | Synchronous call |
| Orange | Async message/event |
| Green | Data access |
| Red dashed | Failure or compensation path |
| Grey dashed | Observability |

## Regenerating

```bash
pip install diagrams
python docs/generate_architecture_diagram.py
```

Needs Graphviz on the system. The script auto-detects the Windows install path. Outputs both PNG and SVG. The SVGs have icons embedded as base64 so they render anywhere.
