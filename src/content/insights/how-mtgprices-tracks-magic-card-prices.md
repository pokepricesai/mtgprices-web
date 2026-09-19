---
slug: how-mtgprices-tracks-magic-card-prices
title: How MTGPrices Tracks Magic Card Prices
description: A short guide to the data providers, currencies and price types behind every number on MTGPrices, and why we never silently convert between them.
author: MTGPrices
category: Market
publishedAt: 2026-09-15
---

If you have looked at a Magic card page on MTGPrices and wondered where the number in the corner came from, this is the short version.

## The basis: provider, currency, market and price type

Every price on MTGPrices is stored with four attributes that describe exactly what it means:

- **Provider.** Where the observation came from. Today MTGPrices tracks TCGplayer, Card Kingdom, Cardmarket, ManaPool and Cardhoarder.
- **Currency.** USD or EUR. We keep them apart, always.
- **Market.** Paper or MTGO.
- **Price type.** Retail (what a buyer pays) or buylist (what a dealer offers).

Together those four make up what we call the **valuation basis**. Every collection value, deck value, mover chip and card page headline number is computed against one and only one basis. When you compare two prices on MTGPrices, they are always the same basis, so a rise or a delta means what you expect it to mean.

## Why we do not blend currencies

A common shortcut in price aggregators is to convert everything into a single currency at a spot rate. MTGPrices does not do that. Foreign exchange between USD and EUR moves for reasons that have nothing to do with the value of a Magic card, and silently mixing the two rates into a portfolio figure would make it very hard to spot a real market move.

If you shop in EUR, pick Cardmarket EUR retail as your default basis on the Settings page. Everything on MTGPrices then denominates in euros. If you shop in USD, pick TCGplayer USD retail. The point is that the number you see is always the number for your basis, never a mix.

## Freshness

Prices are refreshed daily where the provider allows it. Card pages show the exact observation date under the headline price. The 7 day, 30 day and 90 day chart windows on a card page are computed from actual observation history, not extrapolated from a single snapshot.

## What we do not track

MTGPrices does not track completed eBay sale prices, private trades or auction house results. If you rely on those for high-end collectibles, treat MTGPrices as one input in your view of the market, not the only one.
