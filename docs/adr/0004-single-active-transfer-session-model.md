# ADR 0004: Allow only one active transfer per WhatsApp chat

## Status
Accepted

## Context
The product uses WhatsApp as the primary customer interface. Chat-based transfer workflows become confusing quickly when multiple transfer intents overlap in the same conversation.

## Decision
Each WhatsApp chat may have exactly one active transfer at a time. If the user starts a second transfer while one is active, the bot blocks it and asks the user to finish or cancel the active transfer first.

## Consequences
- The conversational state machine stays simple.
- Duplicate or overlapping transfer intent is reduced.
- Support and recovery are easier to reason about.
- Users cannot run multiple transfers in parallel from one chat.

## Alternatives Considered
- Allow multiple concurrent transfers in one chat.
- Queue additional transfers behind the active one.

