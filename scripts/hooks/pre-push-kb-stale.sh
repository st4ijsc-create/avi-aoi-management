#!/bin/sh
# doc11-kb-stale-check
# Warn (never block) if the AI knowledge base is older than its source material.
node scripts/ai-kb/check-kb-stale.mjs || true
