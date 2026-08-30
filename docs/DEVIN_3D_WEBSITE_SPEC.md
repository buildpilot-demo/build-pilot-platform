# Five-Minute Cinematic 3D Website Handoff

This is the complete handoff for a single-page, three-section vegetarian restaurant website. The first section uses the supplied 300-frame image sequence; the second is a scroll-controlled horizontal products/services rail; the third is an enquiry form.

The experience must use native canvas, CSS, and browser APIs inside the repository’s existing framework. It must not recreate the food in real-time 3D or introduce a large animation library. This makes a polished five-minute Devin implementation achievable.

## Asset collection contract

Every business category owns one self-contained asset collection. Hero frames and product images for different categories must never be mixed.

```text
public/
  assets/
    restuarant/
      frames/
        ezgif-frame-001.jpg
        ...
        ezgif-frame-300.jpg
      products/
        REPLACE_ME_PRODUCT_FILES
    cafe/
      frames/
        REPLACE_ME_CAFE_FRAMES
      products/
        REPLACE_ME_CAFE_PRODUCT_FILES
```

The collection name is selected once in `src/site.config.ts`:

```ts
const assetCollection = "restuarant"; // or "cafe"
```

The spelling `restuarant` above matches the folder name supplied for this repository. Filesystem paths are exact and case-sensitive. If the folder is renamed to the conventional `restaurant`, update the single `assetCollection` value to match; do not hardcode the collection name elsewhere.

All runtime paths must derive from the selected root:

```text
Selected browser root: /assets/{assetCollection}
Hero frames:          /assets/{assetCollection}/frames
Product images:       /assets/{assetCollection}/products
Poster:               /assets/{assetCollection}/frames/ezgif-frame-001.jpg
```

For the selected restaurant collection, the hero sequence contract is:

```text
Filename pattern:   ezgif-frame-{number}.jpg
First frame:        ezgif-frame-001.jpg
Last frame:         ezgif-frame-300.jpg
Number padding:     3
First frame number: 1
Total frame count:  300
Frame dimensions:   1920 × 1080
```

Product config contains filenames only, never full paths. Replace these filenames before starting Devin:

```text
Signature platter: REPLACE_ME_SIGNATURE_IMAGE_FILENAME
Fresh mezze:       REPLACE_ME_MEZZE_IMAGE_FILENAME
Catering:          REPLACE_ME_CATERING_IMAGE_FILENAME
Events:            REPLACE_ME_EVENTS_IMAGE_FILENAME
Fresh juices:      REPLACE_ME_JUICES_IMAGE_FILENAME
```

Devin must read only the selected collection. It must not inspect sibling collections for fallback assets, reuse an image from another category, or search the wider repository for substitutes. If a selected product file is unavailable, remove that item instead of crossing collection boundaries, duplicating another image, or showing a broken placeholder.

---

## SITE_BRIEF.md

```md
# Gorkha Palace — Cinematic Vegetarian Dining Website

## Business

Gorkha Palace is a family-run restaurant in Al Quoz, Dubai, serving vibrant vegetarian plates, fresh mezze, charcoal-roasted vegetables, juices, and catering. The experience should feel premium, warm, inclusive, and cinematic.

## Primary goal

Convert visitors into dining, catering, event, and office-order enquiries. The primary CTA is “Send an enquiry”; the secondary CTA is “Explore our table”.

## Audience

- Vegetarian diners and mixed-diet groups
- Families meeting for lunch or dinner
- Office teams arranging meals
- Customers planning catered events and gatherings

## Creative direction

Build exactly one page with three visually connected sections:

1. A pinned cinematic hero driven by the supplied 300-frame food sequence
2. A pinned horizontal products/services showcase using separate static images
3. A normal-flow enquiry section that rises into view after the horizontal showcase finishes

The frames and food photography are the visual focus. Use minimal editorial UI, restrained motion, generous spacing, warm off-white text, thin dividers, subtle grain, and one ember-orange accent. Avoid generic cards, floating blobs, excessive gradients, excessive rounded corners, stock imagery, dashboard layouts, and large blocks of copy.

## Visual system

- Background: near-black charcoal (`#0B0A08`)
- Surface: warm black (`#15110D`)
- Primary text: warm ivory (`#F5EBDD`)
- Muted text: sand (`#B9AA96`)
- Accent: ember orange (`#E45A24`)
- Accent hover: flame (`#FF7540`)
- Display typography: use the repository’s existing premium serif; otherwise use Georgia
- UI typography: use the existing sans-serif; otherwise use Arial/Helvetica

Do not download fonts or introduce external font dependencies.

## Section 1 — Cinematic hero

- Use a full-viewport sticky canvas inside a `600vh` scroll track.
- Use frames `ezgif-frame-001.jpg` through `ezgif-frame-300.jpg` from the selected collection’s `/frames` directory.
- Map normalized hero scroll progress deterministically from frame 1 to frame 300.
- Use the same sequence on desktop, tablet, and mobile.
- Draw frames with cover-style aspect-ratio preservation and a configurable focal point.
- Overlay a minimal transparent header containing the wordmark, “Our table”, “Services”, and “Enquire”.
- Keep text as accessible HTML above the decorative canvas.
- Use three restrained copy chapters; crossfade them based on hero progress.

Hero chapter copy:

1. `0%–24%`
   - Eyebrow: `Vegetarian dining · Al Quoz, Dubai`
   - Heading: `A table alive with flavour.`
   - Body: `Fresh mezze, crisp falafel, charcoal-roasted vegetables, and generous family hospitality.`
   - Show a subtle “Scroll to discover” cue.

2. `34%–60%`
   - Eyebrow: `Prepared fresh`
   - Heading: `Every ingredient has a place.`
   - Body: `Bright herbs, warm bread, silky hummus, and plates composed for sharing.`

3. `72%–100%`
   - Eyebrow: `Made for everyone`
   - Heading: `Gather around something good.`
   - Body: `Join us for lunch, dinner, office catering, or your next celebration.`
   - Primary CTA: `Send an enquiry`
   - Secondary CTA: `Explore our table`

The final frame must remain visible briefly at the end of the hero before the product section takes over. Do not crossfade to a blank background.

## Section 2 — Products and services horizontal showcase

- This section begins only after hero progress reaches 100% and the hero unpins naturally.
- Use another tall vertical track with a `100vh` sticky viewport.
- Convert the section’s vertical scroll progress into a horizontal rail translation from right to left.
- The rail starts with a short editorial title panel followed by the configured product/service panels.
- Each panel contains one supplied static image rendered as a fixed square card (`aspect-ratio` from `site.config.ts`'s `productsSection.imageAspectRatio`, e.g. `1 / 1`, with `object-fit: cover`), plus a category label, concise heading, short description, and optional enquiry anchor.
- Keep every panel's image card the same square size regardless of the source image's native dimensions; use large typography alongside it, and do not use small generic cards.
- Translate the rail only as far as needed for its final edge to align with the viewport. The last panel must be fully readable before the section releases.
- On screens below 768 px, panels may be 82–88vw wide but must still use the same scroll-controlled horizontal rail.
- With reduced motion, remove pinning and show the items as a normal vertical list.

Showcase items:

1. Signature Vegetarian Platter — a generous table centerpiece for sharing
2. Fresh Mezze — hummus, salads, herbs, vegetables, and warm bread
3. Office Catering — organised vegetarian meals and sharing spreads
4. Events and Gatherings — flexible menus for families and celebrations
5. Fresh Juices — bright drinks prepared to order

## Section 3 — Enquiry form

- After horizontal progress reaches 100%, release the products section and let the enquiry section enter through normal page scrolling.
- Use a subtle CSS-only reveal: opacity plus no more than `24px` upward movement.
- Do not pin the form.
- Use a split editorial layout on desktop and a single column on mobile.
- Left side: eyebrow, headline, short invitation, address, and hours.
- Right side: accessible enquiry form.

Required form fields:

- Full name — required
- Email — required, email type
- Phone — optional, tel type
- Enquiry type — required select: Table enquiry, Office catering, Event catering, General enquiry
- Number of guests — optional number, minimum 1
- Message — required textarea
- Consent checkbox — required
- Submit button: `Send enquiry`

Use the repository's existing working form component. Wire its `onSubmit` to the shared, multi-tenant Convex backend: call the `siteSubmissions:submitInquiry` mutation (via `makeFunctionReference<"mutation">("siteSubmissions:submitInquiry")` from `convex/server`, since this repo has no codegen against that backend's schema — see `convex/README.md`) with `{ siteId: VITE_SITE_ID, name, email, phone, enquiryType, message, consentAccepted }`, using the already-configured `convexUrl`/`siteId` from `src/lib/convex.ts`. If `VITE_CONVEX_URL`/`VITE_SITE_ID` are unset, or the mutation call fails, keep the form honest: validate fields client-side, prevent accidental navigation, and show “Form submission is not connected yet” rather than claiming the enquiry was sent. Never invent a different API endpoint.

Include the compact footer inside the bottom of this third section so the page still has exactly three primary sections.

## Motion choreography

```text
Normal vertical scroll
        ↓
Section 1 pins: scroll drives frames 001 → 300
        ↓ hero releases at final frame
Section 2 pins: scroll drives horizontal rail right → left
        ↓ rail releases after final panel is fully shown
Section 3 enters in normal document flow with a subtle reveal
```

- Never hijack wheel/touch input or implement custom smooth scrolling.
- Use native sticky positioning and normalized document scroll progress.
- Use `requestAnimationFrame` for canvas and horizontal transform updates.
- Chapter transitions use opacity and at most `20px` translation.
- Keep all sequencing deterministic; the end state of each section must be reachable.
- The browser Back/Forward cache and refresh at a scrolled position must not break layout.

## Hero frame performance

The 300 source JPGs total approximately 21.7 MB, but decoding all 300 at 1920×1080 simultaneously can consume roughly 2.5 GB. Do not retain every decoded frame indefinitely.

- Paint frame 001 immediately as the poster/fallback.
- Load frame 300 and evenly spaced keyframes early.
- Maintain a bounded cache of approximately 36–48 `HTMLImageElement` frames around the current target frame.
- Prioritize frames ahead of the current scroll direction and nearby frames behind it.
- Evict far-away entries from the application cache; allow normal browser HTTP caching to handle repeat requests.
- Use bounded loading concurrency of approximately 6.
- If the exact target is unavailable, draw the nearest loaded frame without clearing the canvas.
- Never show a blocking loading screen or wait for all 300 images before rendering the page.
- Use canvas cover drawing, preserve aspect ratio, cap DPR at 2, and resize on viewport changes.
- Do not update React state on every scroll tick.

## Responsive behavior

- Use the single 1920×1080 frame set at every breakpoint.
- Resolve frames and product images exclusively below the one selected asset root; never fall back to a sibling business collection.
- Landscape frames will crop horizontally on portrait screens; use the configured narrow focal point and clamp source cropping to image bounds.
- Hero and horizontal panels must have no horizontal page overflow.
- Product rail movement must be calculated from `rail.scrollWidth - viewportWidth`, not hardcoded pixels.
- The form must remain comfortable and readable at 320 px width.

## Accessibility

- Semantic headings and landmarks
- Keyboard-accessible navigation, links, controls, and form
- Visible focus states and WCAG AA contrast
- Canvas marked decorative; all meaning duplicated in HTML
- Useful image alt text for product/service images
- Form inputs have visible labels and associated error messages
- `aria-live` for form status
- Under `prefers-reduced-motion: reduce`, show static frame 001, all hero copy without animation, a vertical product list, and the form in normal flow

## Build constraints

- Reuse the current framework, router, build tooling, styles, components, and form primitives.
- Do not migrate frameworks or replace package configuration.
- Do not generate, rename, move, or convert frames or product assets inside any collection.
- Read only the collection selected by `site.config.ts`; do not scan or mix sibling collection assets.
- Do not use Three.js, React Three Fiber, WebGL shaders, GSAP, Lenis, locomotive-scroll, or carousel libraries.
- Avoid new dependencies.
- Do not create extra pages or routes.
- `npm ci` and `npm run build` must succeed.
- No credentials or private keys may enter the browser bundle.
- Do not use Playwright or any other browser-automation tool to screenshot or visually inspect the built sections — this template is entirely config-driven against an already-validated layout, so a successful build is sufficient verification.
```

---

## src/site.config.ts

Select one asset collection, replace the five `REPLACE_ME` product filenames, and add real contact values before starting Devin. Remove any product whose image is unavailable inside the selected collection.

```ts
// This is the only category switch. Every asset path derives from it.
// It must exactly match one directory directly under public/assets.
const assetCollection = "restuarant" as const; // change to "cafe" when requested
const assetRoot = `/assets/${assetCollection}`;

export const siteConfig = {
  businessName: "Gorkha Palace Restaurant",
  purpose:
    "A cinematic vegetarian dining and catering website for a family-run restaurant in Al Quoz, Dubai.",
  targetAudience:
    "Vegetarian diners, families, mixed-diet groups, office teams, and event catering clients.",
  contact: {
    address: "Al Quoz, Dubai",
    hours: "Open every day, 12:00 noon–12:00 midnight",
    phone: "",
    email: "",
  },
  palette: {
    background: "#0B0A08",
    surface: "#15110D",
    text: "#F5EBDD",
    muted: "#B9AA96",
    accent: "#E45A24",
    accentHover: "#FF7540",
  },
  navigation: [
    { label: "Our table", href: "#products" },
    { label: "Services", href: "#products" },
    { label: "Enquire", href: "#enquiry" },
  ],
  assets: {
    collection: assetCollection,
    root: assetRoot,
    framesDirectory: `${assetRoot}/frames`,
    productsDirectory: `${assetRoot}/products`,
  },
  hero: {
    directory: `${assetRoot}/frames`,
    poster: `${assetRoot}/frames/ezgif-frame-001.jpg`,
    filePrefix: "ezgif-frame-",
    fileExtension: "jpg",
    framePadding: 3,
    firstFrame: 1,
    frameCount: 300,
    width: 1920,
    height: 1080,
    scrollHeightVh: 600,
    maxDevicePixelRatio: 2,
    maxCachedFrames: 48,
    loadConcurrency: 6,
    narrowViewportBreakpoint: 768,
    focalPoint: {
      wide: { x: 0.5, y: 0.5 },
      narrow: { x: 0.62, y: 0.5 },
    },
    chapters: [
      {
        id: "opening",
        from: 0,
        to: 0.24,
        align: "left" as const,
        eyebrow: "Vegetarian dining · Al Quoz, Dubai",
        heading: "A table alive with flavour.",
        body: "Fresh mezze, crisp falafel, charcoal-roasted vegetables, and generous family hospitality.",
        showScrollCue: true,
      },
      {
        id: "ingredients",
        from: 0.34,
        to: 0.6,
        align: "right" as const,
        eyebrow: "Prepared fresh",
        heading: "Every ingredient has a place.",
        body: "Bright herbs, warm bread, silky hummus, and plates composed for sharing.",
      },
      {
        id: "gather",
        from: 0.72,
        to: 1,
        align: "left" as const,
        eyebrow: "Made for everyone",
        heading: "Gather around something good.",
        body: "Join us for lunch, dinner, office catering, or your next celebration.",
        primaryCta: { label: "Send an enquiry", href: "#enquiry" },
        secondaryCta: { label: "Explore our table", href: "#products" },
      },
    ],
  },
  productsSection: {
    id: "products",
    eyebrow: "Our table and services",
    heading: "Freshly made. Generously shared.",
    body: "From everyday dining to office lunches and celebrations, we build vibrant vegetarian tables around the way you gather.",
    scrollHeightVh: 500,
    // Product/service images render as fixed square cards (CSS
    // `aspect-ratio: 1 / 1` + `object-fit: cover`) instead of full-height
    // panels, so every photo is a uniform size regardless of its source
    // dimensions.
    imageAspectRatio: "1:1",
    items: [
      {
        category: "Dine",
        name: "Signature Vegetarian Platter",
        description: "A generous table centerpiece composed for sharing.",
        image: "REPLACE_ME_SIGNATURE_IMAGE_FILENAME",
        alt: "Signature vegetarian sharing platter",
      },
      {
        category: "Dine",
        name: "Fresh Mezze",
        description: "Hummus, salads, herbs, vegetables, and warm bread.",
        image: "REPLACE_ME_MEZZE_IMAGE_FILENAME",
        alt: "Selection of fresh vegetarian mezze",
      },
      {
        category: "Cater",
        name: "Office Catering",
        description: "Organised vegetarian meals and sharing spreads for teams.",
        image: "REPLACE_ME_CATERING_IMAGE_FILENAME",
        alt: "Vegetarian office catering spread",
      },
      {
        category: "Gather",
        name: "Events and Gatherings",
        description: "Flexible menus for families, celebrations, and special days.",
        image: "REPLACE_ME_EVENTS_IMAGE_FILENAME",
        alt: "Vegetarian food prepared for a gathering",
      },
      {
        category: "Refresh",
        name: "Fresh Juices",
        description: "Bright drinks squeezed and prepared to order.",
        image: "REPLACE_ME_JUICES_IMAGE_FILENAME",
        alt: "Freshly prepared fruit juices",
      },
    ],
  },
  enquirySection: {
    id: "enquiry",
    eyebrow: "Start a conversation",
    heading: "Tell us what you’re planning.",
    body: "A table for tonight, lunch for the office, or a celebration—we’ll help you shape it.",
    submitLabel: "Send enquiry",
    enquiryTypes: [
      "Table enquiry",
      "Office catering",
      "Event catering",
      "General enquiry",
    ],
    disconnectedMessage: "Form submission is not connected yet.",
    consentLabel:
      "I agree to be contacted about this enquiry and understand that my details will only be used to respond.",
  },
} as const;

export type SiteConfig = typeof siteConfig;
```

The product renderer must resolve each item as `${siteConfig.assets.productsDirectory}/${item.image}`. Treat `item.image` strictly as a filename: reject or omit values containing `/`, `\\`, or `..` so a product cannot escape the selected collection. Render every resolved image inside a fixed square card using `productsSection.imageAspectRatio` (CSS `aspect-ratio` + `object-fit: cover`) rather than a variable-height panel.

If the starter repository already has a different `SiteConfig` type, preserve existing consumers and export this page configuration separately from the same file. Do not refactor unrelated schema code during the time box.

---

## DEVIN_PROMPT

Replace the repository URL, starting commit, five product image filenames, and real contact details before sending this prompt. The selected asset collection must come only from `site.config.ts`; do not repeat it manually in the prompt.

```text
Build and ship the single-page customer website in REPLACE_ME_REPOSITORY_URL, starting from commit REPLACE_ME_STARTING_COMMIT.

TIME BOX: Deliver a compiled, polished implementation within five minutes. Work directly on main, pull its latest changes first, and push the final commit to main. Do not create another branch. The last commit message must be "FINAL: build three-section cinematic vegetarian website". Return its SHA.

SOURCE OF TRUTH:
1. Read SITE_BRIEF.md for the exact three-section structure, motion, performance, accessibility, and constraints.
2. Read src/site.config.ts for all content, assets, timing, and styling values.
3. Read siteConfig.assets.collection once and use only public/assets/{that collection}. Do not scan, import, or fall back to any sibling collection.

SELECTED ASSET COLLECTION:
- Selected collection: read siteConfig.assets.collection
- Repository root: public/assets/{siteConfig.assets.collection}
- Browser root: siteConfig.assets.root
- Hero directory: siteConfig.assets.framesDirectory
- Products directory: siteConfig.assets.productsDirectory
- Pattern: ezgif-frame-{3-digit-number}.jpg
- Range: ezgif-frame-001.jpg through ezgif-frame-300.jpg
- Count: 300 sequential frames
- Dimensions: 1920x1080
- Poster/fallback: siteConfig.hero.poster
- Use this one sequence at every breakpoint.
- This selected root is a hard isolation boundary. Do not inspect or use assets from another folder under public/assets.

FIRST: Spend no more than 30 seconds inspecting package.json, the page entry point, global styles, existing components, and any existing form submission path. Then implement within the current framework. Do not migrate frameworks, replace tooling, rewrite unrelated code, or install animation/3D/scroll libraries.

THE PAGE MUST HAVE EXACTLY THREE PRIMARY SECTIONS:

1. HERO
- A 600vh track with a 100vh sticky canvas.
- Vertical scroll deterministically scrubs frames 001 through 300.
- Use cover-style canvas drawing with the configured focal point and capped DPR.
- Render the three timed branding chapters as semantic HTML above the canvas.
- Keep frame 300 visible at the end before the hero releases.

2. PRODUCTS AND SERVICES
- A tall track with a 100vh sticky viewport.
- A wide rail containing an intro panel and every configured item.
- Map vertical section progress to horizontal translateX from 0 to exactly -(rail.scrollWidth - viewportWidth).
- The rail moves right to left and fully exposes the last item before releasing.
- Use the supplied static images, large editorial panels, and no generic card grid.

3. ENQUIRY
- Enter in normal document flow after section 2 releases; do not pin it.
- Add a restrained CSS reveal of opacity and at most 24px upward movement.
- Reuse the existing working form path if present. Otherwise implement honest client validation and show the configured disconnected message without pretending to submit.
- Include the compact footer inside this section.

P0 — MUST SHIP BEFORE ANY POLISH:
- Correct three-section DOM order and anchor navigation.
- Working hero sequence from the exact selected collection and filenames.
- Product images resolved as selected products directory + configured filename; never accept a full path from a product item.
- Bounded 36–48 frame cache and loading concurrency near 6; do not retain all 300 decoded frames.
- Sticky horizontal product rail with correct measured travel distance.
- Accessible enquiry form with all configured fields and honest submission status.
- Responsive behavior, reduced-motion fallbacks, and npm run build success.

P1 — ONLY AFTER P0 WORKS:
- Chapter fades, header backdrop, scroll cue, subtle grain, product text transitions, and form reveal using CSS/native APIs only.
- Refine spacing, typography, focus states, and narrow-screen crop.

SKIP IF TIME IS SHORT:
- Custom cursor, route transitions, extra pages, elaborate loaders, nonessential decorations, or test infrastructure.

TECHNICAL RULES:
- Use native sticky positioning, passive scroll/resize listeners, requestAnimationFrame, ResizeObserver if already supported, and canvas 2D.
- Never intercept wheel/touch events and never implement custom smooth scrolling.
- Do not use Three.js, React Three Fiber, WebGL shaders, GSAP, Lenis, locomotive-scroll, or carousel libraries.
- Avoid React state updates per scroll frame; use refs for hot animation values.
- Draw the nearest loaded image when a target frame is unavailable and never clear a valid frame while loading.
- Preload frame 001, frame 300, and spaced keyframes; then maintain a direction-aware window around the current target.
- Product travel must be measured from actual rail width, not hardcoded.
- Resolve all assets below siteConfig.assets.root. Product item values are filenames only; omit unsafe names containing path separators or `..`.
- Do not list, scan, import, or use any sibling directory under public/assets, even when an asset is missing from the selected collection.
- On prefers-reduced-motion: show frame 001 as a static hero, show all essential hero copy, render products as a vertical list, and show the form normally.
- Hide or remove missing-image product entries. Never borrow from another collection or render REPLACE_ME filenames or broken images.
- Never invent prices, testimonials, awards, contact values, API endpoints, or success responses.
- Use existing dependencies and local fonts only.

VISUAL ACCEPTANCE:
- Hero fills the viewport without stretching, white flashes, broken frames, or visible canvas clearing.
- Branding copy stays legible and does not obscure the food focal point.
- Hero releases only after the final frame is reachable.
- Product rail moves right to left, has no page-level horizontal overflow, and reveals its final panel completely.
- The enquiry section follows naturally after horizontal scrolling and does not overlap the rail.
- Mobile uses the same sequence with focal-point-aware cropping and remains usable at 320px.
- The overall result feels like one cinematic narrative, not three unrelated templates.

VALIDATION:
Run npm ci only if node_modules is absent or the lockfile requires it. Run npm run build, fix errors, commit, push, and return the final SHA. Do not spend the time box adding tests or documentation, or on Playwright/browser-automation screenshot verification — this template is config-driven against an already-validated layout, so a successful build is sufficient.
```

## Five-minute readiness checklist

- [ ] Set `assetCollection` to the exact requested folder name, such as `restuarant` or `cafe`.
- [ ] Verify the selected collection contains exactly 300 sequential hero frames from `001` to `300`.
- [ ] Verify the selected frames are 1920×1080 JPG files and frame `001` can act as the poster.
- [ ] Replace all five `REPLACE_ME_*_IMAGE_FILENAME` values with filenames that exist under the selected `/products` folder, or remove unavailable products.
- [ ] Verify each selected product image URL loads and no product filename contains a path separator.
- [ ] Confirm nothing in the config points at a sibling asset collection.
- [ ] Fill real contact details or deliberately leave them empty.
- [ ] Place the extracted brief at repository-root `SITE_BRIEF.md`.
- [ ] Place the extracted config at `src/site.config.ts`.
- [ ] Replace repository URL and starting commit in `DEVIN_PROMPT`.
- [ ] Confirm the starter repository builds before Devin starts.

The five-minute target assumes the selected collection is complete, the two extracted files are already in place, and the starter repository compiles before Devin begins. Asset discovery and cross-category fallback are intentionally outside Devin’s task.
