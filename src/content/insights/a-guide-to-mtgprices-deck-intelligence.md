---
slug: a-guide-to-mtgprices-deck-intelligence
title: A Guide to MTGPrices Deck Intelligence
description: A tour of the deck features on MTGPrices, from the Deck Builder to Test Your Deck to the AI Analyse and Improve tools, and how they fit together.
author: MTGPrices
category: Deckbuilding
publishedAt: 2026-09-17
---

MTGPrices is a market and catalogue site, but it is also a home for your decks. This article is a short tour of the deck features, in the order you would use them.

## Building a deck

New decks start on the [Deck Builder](/decks/new). Pick a format and give the deck a name. Everything below then respects the format you chose, including legality on card searches and colour identity in Commander.

The builder is manual by design. Every card you add is one you decided to add. The **Card Finder** search panel on the right lets you filter by capabilities (draw, removal, ramp, tokens), colour, mana value and price. Every result already respects the format you are building for.

If you are signed in, the **owned vs missing** view sits next to the list. When you own a printing of a card, MTGPrices already knows which finish and condition, so the deck value calculation uses what you actually own for that entry and falls back to the cheapest available printing for the rest.

## Testing a deck

Every deck page has a **Test Your Deck** flow. The important surfaces are:

- **Opening hands** with a London mulligan model. Draw a hand, keep or mulligan, see what you got.
- **Draw odds** so you can quantify how often a specific card shows up in your first N draws.
- **Mana analysis** that flags whether your untapped coloured sources match your curve.
- A **manual goldfish** sandbox for when you want to try the first few turns by hand. This is a sandbox and does not enforce game rules.

None of the Test Your Deck features use AI. They are deterministic calculations on the deck list you built, so the numbers you see are numbers you can reproduce.

## Analyse and Improve

The two AI actions on the deck page are **Analyse** and **Improve**. Both live under the same rate limit, six operations per day per user.

- **Analyse** takes your current list and returns a short read on the plan, key cards and the deck's shape (curve, capability mix, ownership).
- **Improve** returns three to five specific swap or add suggestions. Every suggestion cites the reason and is validated against your format and (for Commander) your colour identity before it is shown. The AI cannot invent a card that MTGPrices does not know about.

Both actions are grounded in the live MTGPrices catalogue. If a suggestion is not in the tool result the model saw, it is rejected. This is what stops the classic AI failure mode of a plausible sounding but nonexistent card.

## Where to start

If you are new to the deck features, the shortest useful path is:

1. Build a rough manual list of the deck you already play.
2. Open Test Your Deck and look at a couple of opening hands.
3. Ask Improve for three suggestions.
4. Apply the ones you like and rerun Test Your Deck.

You will end up with a version of the deck that reflects the market view, your own collection and, if you want it, an AI second opinion on the composition. Nothing there is a black box.
