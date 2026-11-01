# Instant Roof Estimate — launch checklist

Page: `roof-estimate.html` (live at `/roof-estimate/`).
Pricing: `estimator/pricing-config.js`, the only file to edit for prices and wording.
Satellite measuring: `netlify/functions/roof-measure.mjs`.

## Before going live

1. **Replace the placeholder prices** in `pricing-config.js` with Titan's real installed
   price per square for each material, then set `pricesConfirmed: true`.
   Until then, every result shows a "Draft pricing" banner and leads are tagged DRAFT.
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

## How the number is calculated

squares (roof sq ft / 100) × price per square × pitch × roof shape × stories,
with a ± range from the material's price spread and the measurement margin.
The page shows this breakdown to the homeowner under "How we got this number".

## Analytics

The page pushes `estimator_start`, `estimator_measured`, `estimator_result`,
`estimator_print` and `estimator_lead` events to `dataLayer` / `gtag` if
Google Analytics or Tag Manager is added to the site later.
