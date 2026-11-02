# Supplier Dashboard visual refinement

Scope: supplier header image, KPI presentation, and delivery status pills. Existing font family, font sizes, source status values, APIs, forms, search, and View/Create ASN actions are preserved. Other modules and sidebar behavior are unchanged.

The supplied `KaizenAssets Supplier Dashboard.png` was an annotated full UI reference, not a standalone image. The clean hero was reconstructed using the built-in image generation tool and saved as `src/assets/supplier-warehouse-hero.png`. It is a reference-derived image, not a pixel-identical crop.

## Image prompt

Create a clean wide panoramic background asset by extracting/reconstructing ONLY the warehouse exterior and blue delivery truck photo in the top hero of this reference dashboard. The reference file is an annotated screenshot: remove ALL blue pen annotations, all dashboard UI, all text overlays, buttons, navigation, KPI cards and table. Output only the photorealistic blue truck parked in front of modern pale grey warehouse loading bays, boxes and pale blue sky. Match the subject, colors and camera angle of the hero photo exactly as closely as possible; building on right, blue truck near middle-right. Wide 3:1 composition, left third mostly pale sky and softly faded empty space for HTML heading. No drawn outlines, no UI, no border, no illustration, no added text. This is a background asset for an existing application, not a screenshot or mockup.

## Charts and status

KPI mini charts show the last seven local calendar days, using the existing ASN records and existing metric definitions. No artificial growth percentages or made-up values are introduced. Zero counts are represented by faint baseline marks.

Status presentation uses amber waiting, blue active, grey-blue submitted, red rejected/cancelled, and green completed. Actual status strings are unchanged.

## Verification

Two Supplier Dashboard component tests check status presentation, View details, search, chart accessibility, and Create ASN routing. The generated image was visually inspected. A live browser visual check was unavailable because this session had no connected browser.
