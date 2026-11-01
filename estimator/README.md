# Instant Roof Estimate — launch checklist

Page: `roof-estimate.html` (live at `/roof-estimate/`).
Pricing: `estimator/pricing-config.js`, the only file to edit for prices and wording.
Satellite measuring: `netlify/functions/roof-measure.mjs`.

## Before going live

1. **Confirm pricing** in `pricing-config.js`. The tiers, Houston market ranges and
   multipliers come from the Titan Instant Estimate prototype (Chandler's "fair for Titan"
   positioning). Check them against Titan's real completed-job cost per square, and confirm
   whether the per-square price applies to measured roof area or to ordered squares
   including waste. Then set `pricesConfirmed: true`. Until then every result shows a
   "Draft pricing" banner and leads are tagged DRAFT. Also confirm: decking (5 sheets
   included, $85/sheet after), second layer (+$32/SQ), very-steep pitch multiplier (1.25,
   extrapolated), and the workmanship warranty wording.
2. **Turn on satellite measuring** (optional but recommended; without it the tool asks
   for home size instead and the range is wider):
   - Google Cloud console: create a project, enable **Geocoding API**, **Solar API**
     and **Maps Static API**, create an API key.
   - Restrict the key to those three APIs. Set a daily quota cap on each API
     (for example 300 requests/day) so bots can't run up a bill.
   - Netlify: Site configuration > Environment variables > add
     `GOOGLE_MAPS_API_KEY` = the key. Redeploy.
   - Each estimate uses 1 geocode + 1 Solar lookup + 1 map image. Google's free
     monthly allowance should cover a contractor's volume; confirm current pricing
     in the Google Maps Platform pricing page.
3. **Send a test lead** from the live site and confirm it lands in
   info@titanroofingtx.com (sent via FormSubmit, same as the contact forms).
4. Have Titan sign off on the page copy, especially "Our promise about this estimate".
5. **Phone number**: the tool uses Colin (936) 827-1550 (`contact` in pricing-config.js and
   the page's top bar / CTA). The prototype handoff said (936) 827-9644; pick one.
6. **Quick legal look** at the competitor-upload feature (estimates are read in the
   browser and not stored; competitor figures are shown as user-provided).
7. **FormSubmit activation**: the first submission from a new form triggers an
   activation email to info@titanroofingtx.com. Click it, or leads won't arrive.

## Test cases

- Upload the prototype's `sample-competitor-estimate.pdf` (28.5 SQ, $19,750, 2 stories,
  6/12): expect Titan $14,550–$18,750, "You could save $1,000–$5,200".
- Paste text containing `28.50 SQ` and `Total: $21,450.00`.

## How the number is calculated

squares × tier price per square (low/high) × stories × roof shape × pitch,
rounded to $50. Typical Houston pricing uses the same multipliers on the market range.
Pitch comes from the satellite measurement, the competitor's estimate, or the homeowner.
The page shows this breakdown to the homeowner under "How we got this number".

## Analytics

The page pushes `estimator_start`, `estimator_measured`, `estimator_result`,
`estimator_print` and `estimator_lead` events to `dataLayer` / `gtag` if
Google Analytics or Tag Manager is added to the site later.
