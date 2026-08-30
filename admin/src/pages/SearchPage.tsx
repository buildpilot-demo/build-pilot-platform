import { useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { adminApi } from "../lib/api";
import { formatDate } from "../lib/format";
import { SearchIcon } from "../components/Icons";
import { Loading, EmptyState } from "../components/Loading";

// Discovery results table page size — see convex/businesses.ts::listBusinesses.
const PAGE_SIZE = 10;

// Business categories offered in the discovery search form.
const BUSINESS_CATEGORIES = ["Restaurant", "Medical", "Ecommerce", "Travel & Tours", "Real Estate"];

export function SearchPage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const searchBusinesses = useAction(adminApi.searchBusinesses);
  const selectBusiness = useMutation(adminApi.selectBusiness);
  const [city, setCity] = useState("Dubai");
  const [area, setArea] = useState("");
  const [category, setCategory] = useState("Restaurant");
  const [radius, setRadius] = useState("10");
  // Final, LLM-extracted lead count — context.dev fetches a larger raw pool
  // (50 snippets by default) under the hood regardless of this value; the
  // LLM extracts that pool down to at most this many leads, with or without
  // their own website. See convex/businesses.ts::searchBusinesses.
  const [maxResults, setMaxResults] = useState("50");
  // No longer operator-editable in the UI — every call uses the admin app's
  // configured default number.
  const callPhone = import.meta.env.VITE_DEFAULT_CALL_PHONE?.trim() ?? "";
  const [submitted, setSubmitted] = useState<{ city: string; area?: string; category: string }>();
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState<string>();
  const [message, setMessage] = useState<string>();
  // Hides businesses that already have a lead/project underway or finished
  // (see convex/businesses.ts::listBusinesses's excludeWithProject) — an
  // operator-facing filter, independent of the search form above.
  const [hideWithProject, setHideWithProject] = useState(false);
  // Cursor stack for a classic Prev/Next pager on top of Convex's forward-only
  // cursor pagination: stack[0] is always the first page (cursor null); each
  // "Next" push the page we're leaving's continueCursor, "Previous" pops back
  // to the cursor before it. Reset to the first page whenever the search
  // filters change.
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const pageIndex = cursorStack.length - 1;
  const page = useQuery(adminApi.businesses, {
    ...(submitted ?? {}),
    ...(hideWithProject ? { excludeWithProject: true } : {}),
    paginationOpts: { numItems: PAGE_SIZE, cursor: cursorStack[pageIndex] },
  });

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    if (!city.trim() || !category.trim()) return;
    setBusy(true);
    setMessage(undefined);
    const filters = { city: city.trim(), ...(area.trim() ? { area: area.trim() } : {}), category: category.trim() };
    const parsedRadius = Number(radius);
    const parsedMaxResults = Number(maxResults);
    try {
      const result = await searchBusinesses({
        ...filters,
        ...(Number.isFinite(parsedRadius) && parsedRadius > 0 ? { radius: parsedRadius } : {}),
        maxResults: Number.isFinite(parsedMaxResults) && parsedMaxResults > 0 ? parsedMaxResults : 50,
      });
      setSubmitted(filters);
      setCursorStack([null]);
      setMessage(`${result.count} businesses loaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Business search failed");
    } finally {
      setBusy(false);
    }
  }

  // Kicks off the call: creates the Lead/Project/WorkflowRun and schedules
  // voiceCalls:startCall (see projects.ts:selectBusiness), then jumps
  // straight to that project's detail page so the admin can follow its
  // activity timeline live instead of hunting for it back on this list.
  async function handleCall(business: { _id: string; name: string }) {
    setSelecting(business._id);
    setMessage(undefined);
    try {
      const result = await selectBusiness({ businessId: business._id, ...(callPhone.trim() ? { overridePhone: callPhone.trim() } : {}) });
      navigate(`/projects/${result.projectId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Business selection failed");
      setSelecting(undefined);
    }
  }

  return <div className="page-stack">
    <section className="page-heading"><div><p className="eyebrow">Business discovery</p><h1>Start a new website workflow</h1></div></section>
    <section className="panel search-panel">
      <form className="search-controls" onSubmit={handleSearch}>
        <label className="search-input"><span className="sr-only">City</span><SearchIcon /><input required value={city} onChange={(event) => setCity(event.target.value)} placeholder="City" /></label>
        <label className="search-input"><span className="sr-only">Area</span><input value={area} onChange={(event) => setArea(event.target.value)} placeholder="Area (optional)" /></label>
        <label className="search-input search-input--category">
          <span className="sr-only">Category</span>
          <select required value={category} onChange={(event) => setCategory(event.target.value)}>
            {BUSINESS_CATEGORIES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="search-input search-input--narrow"><span className="sr-only">Radius (km)</span><input type="number" min="1" value={radius} onChange={(event) => setRadius(event.target.value)} placeholder="Radius (km)" /></label>
        <label className="search-input search-input--narrow"><span className="sr-only">Max results</span><input type="number" min="1" max="100" value={maxResults} onChange={(event) => setMaxResults(event.target.value)} placeholder="Max results" /></label>
        <button className="button button--primary" disabled={busy}>{busy ? "Searching…" : "Search businesses"}</button>
      </form>
      {message && <p className="form-status" role="status">{message}</p>}
    </section>
    <section className="panel">
      <div className="panel__header">
        <div><p className="eyebrow">Discovery results</p><h2>Businesses</h2></div>
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={hideWithProject}
            onChange={(event) => {
              setHideWithProject(event.target.checked);
              setCursorStack([null]);
            }}
          />
          Hide businesses with a started or completed project
        </label>
      </div>
      {page === undefined ? <Loading label="Loading businesses" /> : page.page.length === 0 ? <EmptyState title="No businesses found" body="Try another city, area, or category." /> : <div className="service-list">{page.page.map((business, index) => {
        const hasProject = Boolean(business.projectId);
        // A business row always opens the business detail view (one
        // business -> many projects, see convex/businesses.ts::getBusinessDetails)
        // which shows the latest project's pipeline/timeline and the full
        // project history — not a single project directly, since a business
        // may have zero or several past projects.
        const openBusiness = () => navigate(`/businesses/${business._id}`);
        return <motion.article
          className="service-row service-row--clickable"
          key={business._id}
          onClick={openBusiness}
          role="button"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1], delay: reduceMotion ? 0 : Math.min(index, 10) * 0.03 }}
        >
          <div className="service-icon service-icon--success">{business.name.slice(0, 2).toUpperCase()}</div>
          <div className="service-row__body">
            <strong>{business.name}</strong>
            <p>
              {[business.category, business.area, business.city, business.normalizedPhone || business.phone, business.email].filter(Boolean).join(" · ")}
              <span className="service-row__discovered"> · Discovered {formatDate(business.discoveredAt)}</span>
            </p>
          </div>
          {hasProject && (
            <button
              className="button"
              onClick={(event) => {
                event.stopPropagation();
                openBusiness();
              }}
            >
              View business
            </button>
          )}
          {/* Always available, even after a previous call — each click starts an
              independent Lead/Project/WorkflowRun (see selectBusiness) so the
              same business can be re-tested through the full voice-call flow
              as many times as needed. */}
          <button
            className="button button--dark"
            disabled={selecting === business._id}
            onClick={(event) => {
              event.stopPropagation();
              void handleCall(business);
            }}
          >
            {selecting === business._id ? "Calling…" : "Call"}
          </button>
        </motion.article>;
      })}</div>}
      {page && page.page.length > 0 && (
        <div className="pager">
          <span className="pager__label">Page {pageIndex + 1}</span>
          <div className="pager__controls">
            <button className="button" disabled={pageIndex === 0} onClick={() => setCursorStack((stack) => stack.slice(0, -1))}>Previous</button>
            <button
              className="button"
              disabled={page.isDone}
              onClick={() => setCursorStack((stack) => [...stack, page.continueCursor])}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  </div>;
}
